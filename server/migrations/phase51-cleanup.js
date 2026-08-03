// Phase 5.1 (Task 5) — SAFE database cleanup.
//
//   node src/migrations/phase51-cleanup.js              # DRY RUN (default, no writes)
//   node src/migrations/phase51-cleanup.js --confirm    # actually delete
//   node src/migrations/phase51-cleanup.js --confirm --keep-users
//
// TAKE A BACKUP FIRST:  mongodump --uri "$MONGO_URI"
//
// DESIGN: this script is DRY RUN BY DEFAULT. It refuses to write anything
// unless --confirm is passed explicitly. A destructive script that deletes on
// its first accidental run is a production incident waiting to happen, so the
// safe path is the default path.
//
// It clears BUSINESS / DEMO data while leaving AUTHENTICATION, RBAC and MASTER
// data completely untouched.
//
// ---------------------------------------------------------------------------
// NEVER TOUCHED (not referenced by any delete below):
//   Role, Permission, Setting            -> RBAC + system configuration
//   LeaveType                            -> leave catalogue (incl. gender rules)
//   Shift, Holiday                       -> shift + holiday configuration
//   Department, Designation              -> HR master data
//   FinanceCategory                      -> finance categories
//   ApiKey                               -> integration credentials
//   User password hashes                 -> never rewritten by this script
// ---------------------------------------------------------------------------

import mongoose from 'mongoose'
import dotenv from 'dotenv'

import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { Attendance } from '../models/attendanceModels.js'
import { LeaveRequest, LeaveBalance } from '../models/leaveModels.js'
import { Notification, NotificationSettings } from '../models/notificationModels.js'
import { Activity, AuditLog, SystemLog, Backup } from '../models/adminModels.js'
import {
  Project, Sprint, ProjectTask, Milestone, ProjectComment, ProjectFile, ProjectActivity,
} from '../models/projectModels.js'
import { Transaction, Budget, Invoice, Payment } from '../models/financeModels.js'
import {
  Client, ClientProject, ClientAnnouncement, ClientMessage, ClientNotification,
} from '../models/clientModels.js'
import { Folder, FileItem } from '../models/fileModels.js'
import { Post } from '../models/announcementModels.js'
import { CalendarEvent } from '../models/calendarModels.js'
import {
  JobOpening, Candidate, Interview, Offer, Onboarding, Payroll, Review, Movement,
} from '../models/hrModels.js'

dotenv.config()

const CONFIRM = process.argv.includes('--confirm')
const KEEP_USERS = process.argv.includes('--keep-users')
const say = (msg) => console.log(msg)

// The login accounts to preserve. Override without editing this file:
//   CLEANUP_KEEP_EMAILS="a@x.com,b@x.com" node src/migrations/phase51-cleanup.js
// Defaults to the canonical one-per-role logins created by the seed.
const DEFAULT_KEEP = [
  'admin@skew.com',
  'hr@skew.com',
  'manager@skew.com',
  'employee@skew.com',
  'client@skew.com',
]
const KEEP_EMAILS = (process.env.CLEANUP_KEEP_EMAILS
  ? process.env.CLEANUP_KEEP_EMAILS.split(',')
  : DEFAULT_KEEP
).map((e) => e.trim().toLowerCase()).filter(Boolean)

// Business/transactional collections wiped in full. Master data is absent here
// by design — see the header block.
const PURGE = [
  ['Attendance history', Attendance],
  ['Leave requests', LeaveRequest],
  ['Leave balances', LeaveBalance],
  ['Notifications', Notification],
  ['Projects', Project],
  ['Sprints', Sprint],
  ['Project tasks', ProjectTask],
  ['Milestones', Milestone],
  ['Project comments', ProjectComment],
  ['Project files', ProjectFile],
  ['Project activity', ProjectActivity],
  ['Finance transactions', Transaction],
  ['Finance budgets', Budget],
  ['Invoices', Invoice],
  ['Payments', Payment],
  ['Client business records', ClientProject],
  // Phase 6.9 (Task 17): ClientMeeting was removed - meetings now live on
  // the shared CalendarEvent collection, which is already covered by the
  // 'Calendar events' cleanup entry elsewhere in this list.
  ['Client announcements', ClientAnnouncement],
  ['Client messages', ClientMessage],
  ['Client notifications', ClientNotification],
  ['File folders', Folder],
  ['File items', FileItem],
  ['Announcement posts', Post],
  ['Calendar events', CalendarEvent],
  ['Job openings', JobOpening],
  ['Candidates', Candidate],
  ['Interviews', Interview],
  ['Offers', Offer],
  ['Onboarding records', Onboarding],
  ['Payroll records', Payroll],
  ['Performance reviews', Review],
  ['Employee movements', Movement],
  ['User sessions / activity', Activity],
  ['Audit log', AuditLog],
  ['System log', SystemLog],
  ['Backup records', Backup],
]

async function purgeCollections() {
  say('\n[1/4] Business data')
  let total = 0
  for (const [label, Model] of PURGE) {
    const n = await Model.countDocuments({})
    total += n
    if (n && CONFIRM) await Model.deleteMany({})
    say(`      ${String(n).padStart(6)}  ${label}`)
  }
  say(`      ${String(total).padStart(6)}  TOTAL documents ${CONFIRM ? 'deleted' : 'that WOULD be deleted'}`)
  return total
}

// Demo/test staff. Accounts in KEEP_EMAILS are preserved with their password
// hashes untouched; everything else is removed together with its linked
// Employee profile and per-user notification preferences, so no orphans remain.
async function purgeUsers() {
  say('\n[2/4] Login accounts + Employee profiles')
  if (KEEP_USERS) {
    say('      --keep-users passed: every User and Employee is preserved.')
    return 0
  }

  const keepUsers = await User.find({ email: { $in: KEEP_EMAILS } }).select('email role').lean()
  const foundEmails = keepUsers.map((u) => u.email.toLowerCase())
  const missing = KEEP_EMAILS.filter((e) => !foundEmails.includes(e))

  say('      preserving:')
  for (const u of keepUsers) say(`        KEEP  ${u.email}  (${u.role})`)
  if (missing.length) {
    say('      WARNING: these preserve-list accounts do not exist in this database:')
    for (const m of missing) say(`        MISSING  ${m}`)
    say('      Aborting: refusing to delete users when the preserve list is incomplete.')
    say('      Fix CLEANUP_KEEP_EMAILS (or seed the accounts) and re-run.')
    return -1
  }

  const doomed = await User.find({ email: { $nin: KEEP_EMAILS } }).select('email role').lean()
  const doomedEmails = doomed.map((u) => u.email)
  say(`      ${doomed.length} user account(s) ${CONFIRM ? 'deleted' : 'would be deleted'}`)
  for (const u of doomed.slice(0, 25)) say(`        DELETE  ${u.email}  (${u.role})`)
  if (doomed.length > 25) say(`        ... and ${doomed.length - 25} more`)

  // Employees are matched by email so a profile with no login is cleaned too.
  const empDoomed = await Employee.countDocuments({ email: { $nin: KEEP_EMAILS } })
  say(`      ${empDoomed} employee profile(s) ${CONFIRM ? 'deleted' : 'would be deleted'}`)

  if (CONFIRM) {
    await Employee.deleteMany({ email: { $nin: KEEP_EMAILS } })
    await User.deleteMany({ email: { $nin: KEEP_EMAILS } })
    await NotificationSettings.deleteMany({ user: { $in: doomedEmails } })
  }
  return doomed.length
}

// Client records are master-ish (a Client is a real customer) but the demo set
// is business data. Only clients with no surviving portal login are removed, so
// a preserved Client login can never be left pointing at a deleted company.
async function purgeClients() {
  say('\n[3/4] Client records')
  const liveClientIds = (await User.find({ role: 'Client' }).select('clientId').lean())
    .map((u) => u.clientId).filter(Boolean)
  const filter = { clientId: { $nin: liveClientIds } }
  const n = await Client.countDocuments(filter)
  say(`      ${liveClientIds.length} client profile(s) still referenced by a portal login (preserved)`)
  say(`      ${n} unreferenced client profile(s) ${CONFIRM ? 'deleted' : 'would be deleted'}`)
  if (n && CONFIRM) await Client.deleteMany(filter)
  return n
}

// Re-provision notification preferences for the accounts we kept, because the
// purge above may have removed a preserved user's settings document if it was
// keyed by an old address.
async function reprovision() {
  say('\n[4/4] Re-provision preserved accounts')
  if (!CONFIRM) { say('      (dry run — nothing to re-provision)'); return }
  const kept = await User.find({}).select('email').lean()
  for (const u of kept) {
    await NotificationSettings.updateOne(
      { user: u.email }, { $setOnInsert: { user: u.email } }, { upsert: true },
    )
  }
  say(`      ${kept.length} account(s) have notification preferences`)
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGO_URI is not set. Aborting without changes.')
    process.exit(1)
  }
  await mongoose.connect(uri)
  say(`Connected. Mode: ${CONFIRM ? 'APPLY (DESTRUCTIVE)' : 'DRY RUN (no writes)'}`)
  if (!CONFIRM) say('Re-run with --confirm to actually delete. Take a mongodump first.')

  await purgeCollections()
  const users = await purgeUsers()
  if (users === -1) {
    await mongoose.disconnect()
    process.exit(1)
  }
  await purgeClients()
  await reprovision()

  say('\nPreserved (untouched by this script):')
  say('  Roles, Permissions, Settings, LeaveTypes, Shifts, Holidays,')
  say('  Departments, Designations, FinanceCategories,')
  say('  API keys, and every password hash on the preserved accounts.')

  await mongoose.disconnect()
  say(`\nDone. ${CONFIRM ? 'Changes applied.' : 'No changes were made (dry run).'}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
