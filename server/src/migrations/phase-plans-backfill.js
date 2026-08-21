// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 7) — Plan catalogue backfill.
//
//   node src/migrations/phase-plans-backfill.js              # DRY RUN (default, no writes)
//   node src/migrations/phase-plans-backfill.js --confirm    # actually insert
//
// TAKE A BACKUP FIRST:  mongodump --uri "$MONGO_URI"
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Before this phase the Client "Plan" dropdown was a hardcoded frontend array
// (['Enterprise','Professional','Business','Starter']) and `Client.plan` was a
// free-form String that the backend never validated. The dropdown is now fed
// from the new `plans` collection instead — which starts EMPTY.
//
// Without a backfill the immediate consequences would be:
//   * the Plan dropdown is empty until an admin manually adds plans, and
//   * every existing client's stored plan (the seed writes 'Business',
//     'Enterprise' and 'Pro' — note 'Pro' was never even in the hardcoded list)
//     would render as "no longer offered".
//
// This script makes the catalogue reflect reality on day one. It inserts:
//   1. every DISTINCT non-empty `plan` value already present on Client
//      documents — so no existing client is left on an unknown plan, and
//   2. the four names the hardcoded dropdown used to offer — so nothing an admin
//      could previously select disappears.
//
// SAFETY
//   * It only INSERTS into `plans`. It never reads-modify-writes, renames or
//     deletes anything, and it does not touch the `clients` collection at all —
//     `Client.plan` remains exactly the free-form String it has always been, so
//     historical plan information cannot be lost by running (or not running)
//     this.
//   * It is IDEMPOTENT: an existing plan with the same name (compared
//     case-insensitively, matching the unique collation index on Plan.name) is
//     skipped, so re-running inserts nothing.
//   * It is OPTIONAL. Skipping it simply means an admin populates
//     Admin → Plans by hand.
// ---------------------------------------------------------------------------

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { Client, Plan } from '../models/clientModels.js'

dotenv.config()

const CONFIRM = process.argv.includes('--confirm')

// The names the retired hardcoded dropdown offered, so an admin loses no option
// that used to be selectable.
const LEGACY_HARDCODED_PLANS = ['Enterprise', 'Professional', 'Business', 'Starter']

// A short, stable code derived from the name (e.g. 'Professional' -> 'PROF').
// Purely cosmetic — `code` is optional on the model.
const codeFor = (name) => String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI is not set. Aborting.')
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log(`Connected: ${uri}`)
  console.log(CONFIRM ? 'MODE: --confirm (WILL WRITE)' : 'MODE: dry run (no writes)\n')

  // 1. What plans do real client documents already reference?
  const inUse = (await Client.distinct('plan'))
    .map((p) => String(p || '').trim())
    .filter(Boolean)

  // 2. Union with the legacy hardcoded list, de-duplicated case-insensitively.
  const wanted = []
  const seen = new Set()
  for (const name of [...inUse, ...LEGACY_HARDCODED_PLANS]) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    wanted.push(name)
  }

  console.log(`Plans referenced by existing clients : ${inUse.length ? inUse.join(', ') : '(none)'}`)
  console.log(`Legacy hardcoded dropdown options    : ${LEGACY_HARDCODED_PLANS.join(', ')}`)
  console.log(`Candidate catalogue entries          : ${wanted.join(', ')}\n`)

  let created = 0
  let skipped = 0

  for (const name of wanted) {
    // Case-insensitive existence check, matching the unique index's collation.
    const exists = await Plan.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).lean()

    if (exists) {
      console.log(`  skip   "${name}" — already in the catalogue as "${exists.name}"`)
      skipped += 1
      continue
    }

    if (!CONFIRM) {
      console.log(`  would insert "${name}" (code ${codeFor(name)}, status Active)`)
      created += 1
      continue
    }

    await Plan.create({
      name,
      code: codeFor(name),
      description: `Backfilled from existing client data on ${new Date().toISOString().slice(0, 10)}.`,
      price: 0,
      status: 'Active',
    })
    console.log(`  insert "${name}"`)
    created += 1
  }

  console.log(`\n${CONFIRM ? 'Inserted' : 'Would insert'}: ${created}   Skipped (already present): ${skipped}`)
  if (!CONFIRM) {
    console.log('Nothing was written. Re-run with --confirm to apply.')
  }

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
