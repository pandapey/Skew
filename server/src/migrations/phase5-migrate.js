// Phase 5 data migration — run ONCE against an existing database.
//
//   node src/migrations/phase5-migrate.js            # apply
//   node src/migrations/phase5-migrate.js --dry-run  # report only, no writes
//
// TAKE A BACKUP FIRST (mongodump). This rewrites roles and leave statuses.
//
// What it does (all idempotent — safe to re-run):
//   1. ROLES:  Inventory -> HR on the users collection, plus the Role
//              catalogue and permission matrix used by the admin screens.
//              Permissions are UNIONED into HR (never a downgrade), so the
//              access former Inventory staff had is preserved.
//   2. GENDER: reconciles User.gender <-> Employee.gender. Copies whichever
//              record already knows the answer onto the one that does not.
//              It NEVER invents a gender — accounts where neither record has
//              one are reported and left null for HR to fill in.
//   3. LEAVE TYPES: sets genderRestriction on the standard Maternity /
//              Paternity types (matched by CODE first, name second) so Task 2
//              filtering works on an existing database. Only touches types
//              still on the 'Any' default, so a manual override is respected.
//   4. LEAVE REQUESTS: backfills expiresAt on pending requests and expires any
//              that are already past their deadline, so the new Expired status
//              is correct for the existing backlog from the first boot.
//
// It does NOT delete any leave type, and it does NOT alter historical
// Approved/Rejected requests.

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { User, GENDERS } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { LeaveType, LeaveRequest } from '../models/leaveModels.js'
import {
  loadShiftContext, resolveShiftStart, buildExpiryInstant,
} from '../utils/leaveExpiry.js'

dotenv.config()

const DRY = process.argv.includes('--dry-run')
const out = []
const say = (msg) => { out.push(msg); console.log(msg) }

// The role retired in this phase and the role that absorbs it.
const RETIRED_ROLE = 'Inventory'
const ABSORBED_BY = 'HR'

// Permission strength, so a union can never downgrade an existing grant.
const RANK = { Deny: 0, View: 1, Full: 2 }

async function migrateUserRoles() {
  say('\n[1/4] User roles \u2014 Inventory -> HR')
  const count = await User.countDocuments({ role: RETIRED_ROLE })
  if (!count) {
    say(`      no users hold the ${RETIRED_ROLE} role`)
  } else {
    if (!DRY) await User.updateMany({ role: RETIRED_ROLE }, { $set: { role: ABSORBED_BY } })
    say(`      ${count} user(s) migrated ${RETIRED_ROLE} -> ${ABSORBED_BY}`)
    say('      ACTION REQUIRED: review these accounts. HR is a broader role than')
    say('      Inventory was, so this is a privilege INCREASE for those users.')
  }

  const db = mongoose.connection.db

  // Role catalogue.
  const roleCols = await db.listCollections({ name: 'roles' }).toArray()
  if (roleCols.length) {
    const n = await db.collection('roles').countDocuments({ name: RETIRED_ROLE })
    if (n && !DRY) await db.collection('roles').deleteMany({ name: RETIRED_ROLE })
    say(n ? `      removed retired role record: ${RETIRED_ROLE} (${n})` : '      role catalogue already clean')
  } else {
    say('      no `roles` collection present \u2014 skipped')
  }

  // Permission matrix: fold Inventory's row into HR, then drop it.
  const permCols = await db.listCollections({ name: 'permissions' }).toArray()
  if (!permCols.length) {
    say('      no `permissions` collection present \u2014 skipped')
    return
  }
  const doc = await db.collection('permissions').findOne({ key: 'default' })
  const matrix = doc?.matrix
  if (!matrix || !matrix[RETIRED_ROLE]) {
    say('      permission matrix has no Inventory row \u2014 nothing to fold')
    return
  }
  const target = { ...(matrix[ABSORBED_BY] || {}) }
  let upgrades = 0
  for (const [mod, level] of Object.entries(matrix[RETIRED_ROLE])) {
    const currentRank = RANK[target[mod]] ?? -1
    if ((RANK[level] ?? 0) > currentRank) { target[mod] = level; upgrades += 1 }
  }
  const next = { ...matrix, [ABSORBED_BY]: target }
  delete next[RETIRED_ROLE]
  if (!DRY) {
    await db.collection('permissions').updateOne({ key: 'default' }, { $set: { matrix: next } })
  }
  say(`      folded Inventory permissions into HR (${upgrades} module(s) upgraded), removed orphan row`)
}

async function migrateGender() {
  say('\n[2/4] Gender reconciliation (User <-> Employee)')

  // Employee -> User: the HR profile already had a gender field before Phase 5,
  // so it is the most likely place a real value already exists.
  const emps = await Employee.find({ gender: { $in: GENDERS } }).select('name email gender userId').lean()
  let toUser = 0
  for (const e of emps) {
    const q = e.userId ? { _id: e.userId } : { email: e.email }
    const u = await User.findOne({ ...q, $or: [{ gender: null }, { gender: { $exists: false } }] })
    if (!u) continue
    if (!DRY) { u.gender = e.gender; await u.save() }
    toUser += 1
  }
  say(`      Employee -> User : ${toUser} account(s) backfilled`)

  // User -> Employee, for the reverse case.
  const usersWithGender = await User.find({ gender: { $in: GENDERS } }).select('name email gender').lean()
  let toEmp = 0
  for (const u of usersWithGender) {
    const res = await (DRY
      ? Employee.countDocuments({ email: u.email, $or: [{ gender: null }, { gender: '' }, { gender: { $exists: false } }] })
      : Employee.updateMany(
        { email: u.email, $or: [{ gender: null }, { gender: '' }, { gender: { $exists: false } }] },
        { $set: { gender: u.gender } },
      ).then((r) => r.modifiedCount))
    toEmp += res || 0
  }
  say(`      User -> Employee : ${toEmp} profile(s) backfilled`)

  // Report what is still unknown. Deliberately NOT guessed.
  const unknown = await User.countDocuments({
    role: { $ne: 'Client' },
    $or: [{ gender: null }, { gender: { $exists: false } }],
  })
  say(`      ${unknown} staff account(s) still have no gender.`)
  if (unknown) {
    say('      These keep working normally, but will NOT see gender-restricted')
    say('      leave types until an Admin/HR sets the value. No value is guessed.')
  }

  // Legacy 'Other' on Employee is preserved, but flagged: it has no counterpart
  // in the User enum, so those accounts behave like "unknown" for leave.
  const other = await Employee.countDocuments({ gender: 'Other' })
  if (other) {
    say(`      NOTE: ${other} Employee profile(s) use the legacy 'Other' value.`)
    say("      Retained as-is (no data destroyed). 'Other' is not in the User")
    say('      enum, so those users see unrestricted leave types only.')
  }
}

async function migrateLeaveTypes() {
  say('\n[3/4] Leave type gender restrictions')
  // Match by CODE first (stable), then by name, and only when the type is still
  // on the 'Any' default so a deliberate admin override is never overwritten.
  const targets = [
    { code: 'ML', name: /maternity/i, restriction: 'Female' },
    { code: 'PL', name: /paternity/i, restriction: 'Male' },
  ]
  const all = await LeaveType.find().lean()
  for (const t of targets) {
    const match = all.find((x) => x.code === t.code) || all.find((x) => t.name.test(x.name || ''))
    if (!match) { say(`      no leave type found for ${t.restriction} restriction (${t.code})`); continue }
    const current = match.genderRestriction || 'Any'
    if (current !== 'Any') {
      say(`      ${match.name}: already set to '${current}' \u2014 left untouched`)
      continue
    }
    if (!DRY) await LeaveType.updateOne({ _id: match._id }, { $set: { genderRestriction: t.restriction } })
    say(`      ${match.name} -> visible to ${t.restriction} only`)
  }
  say('      (no leave type was deleted \u2014 restriction is display/apply filtering)')
}

async function migrateLeaveRequests() {
  say('\n[4/4] Leave request expiry backfill')
  const pending = await LeaveRequest.find({ status: 'Pending' }).select('_id employee from expiresAt').lean()
  if (!pending.length) { say('      no pending requests'); return }

  const ctx = await loadShiftContext()
  const empRows = await Employee.find({ name: { $in: pending.map((r) => r.employee) } }).select('name shift').lean()
  const shiftByName = new Map(empRows.map((e) => [e.name, e.shift]))

  const now = new Date()
  let stamped = 0
  let expired = 0
  for (const r of pending) {
    const at = r.expiresAt ? new Date(r.expiresAt) : buildExpiryInstant(r.from, resolveShiftStart(shiftByName.get(r.employee), ctx))
    if (!at) continue
    if (!r.expiresAt) {
      if (!DRY) await LeaveRequest.updateOne({ _id: r._id }, { $set: { expiresAt: at } })
      stamped += 1
    }
    if (at <= now) {
      if (!DRY) {
        await LeaveRequest.updateOne({ _id: r._id, status: 'Pending' }, {
          $set: { status: 'Expired', expiredAt: now },
          $push: {
            workflow: {
              stage: 'Expired',
              by: 'System',
              at: now,
              note: 'Expired during the Phase 5 migration \u2014 the shift start time on the first day of leave had already passed with no decision recorded',
            },
          },
        })
      }
      expired += 1
    }
  }
  say(`      stamped expiresAt on ${stamped} pending request(s)`)
  say(`      expired ${expired} request(s) whose deadline had already passed`)
  say('      (expired requests remain fully visible in reports)')
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGO_URI is not set. Aborting without changes.')
    process.exit(1)
  }
  await mongoose.connect(uri)
  say(`Connected. Mode: ${DRY ? 'DRY RUN (no writes)' : 'APPLY'}`)

  await migrateUserRoles()
  await migrateGender()
  await migrateLeaveTypes()
  await migrateLeaveRequests()

  // Post-migration assertions.
  const leftoverRole = await User.countDocuments({ role: RETIRED_ROLE })
  const badGender = await User.countDocuments({ gender: { $nin: [...GENDERS, null] } })
  say(`\nVerification:`)
  say(`  users still holding the ${RETIRED_ROLE} role : ${leftoverRole} (expected 0${DRY ? ' after apply' : ''})`)
  say(`  users with an invalid gender value        : ${badGender} (expected 0)`)

  await mongoose.disconnect()
  say('Done.')
}

main().catch((err) => { console.error(err); process.exit(1) })
