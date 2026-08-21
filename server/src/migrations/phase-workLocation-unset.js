// PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2) — OPTIONAL storage clean-up.
//
//   node src/migrations/phase-workLocation-unset.js              # DRY RUN (default, no writes)
//   node src/migrations/phase-workLocation-unset.js --confirm    # actually $unset
//
// TAKE A BACKUP FIRST:  mongodump --uri "$MONGO_URI"
//
// ---------------------------------------------------------------------------
// THIS SCRIPT IS NOT REQUIRED, AND IT HAS NOT BEEN RUN.
//
// Retiring "Work Location" needed NO migration:
//   * `workLocation` was removed from the User and Employee Mongoose schemas,
//     so the application can no longer write it (Mongoose is strict by default,
//     which was verified against the live database — an explicit write of
//     `workLocation` is silently discarded).
//   * `userController.sanitizePatch` additionally drops the key from any update
//     body, so a stale cached frontend bundle cannot re-add it.
//   * The read paths (employeeRepository's exclusion projection and
//     userController's USER_PROJECTION) stop the API EMITTING the value that
//     pre-existing documents still carry, because those reads use `.lean()` and
//     would otherwise pass the raw stored key straight through to the client.
//
// The stored key is therefore inert: nothing reads it, nothing writes it and
// nothing displays it. It is left in place ON PURPOSE — leaving inert data is
// reversible, deleting it is not.
//
// Run this ONLY if you additionally want the bytes gone from the collections.
// `$unset` removes exactly one field and touches nothing else; it cannot affect
// any other column, document or collection.
// ---------------------------------------------------------------------------

import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const CONFIRM = process.argv.includes('--confirm')

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI is not set. Aborting.')
    process.exit(1)
  }

  await mongoose.connect(uri)
  const db = mongoose.connection.db
  console.log(`Connected: ${uri}`)
  console.log(CONFIRM ? 'MODE: --confirm (WILL WRITE)' : 'MODE: dry run (no writes)\n')

  for (const name of ['employees', 'users']) {
    const col = db.collection(name)
    const affected = await col.countDocuments({ workLocation: { $exists: true } })
    console.log(`${name}: ${affected} document(s) still store \`workLocation\``)

    if (!affected) continue
    if (!CONFIRM) {
      console.log(`  dry run — would run: db.${name}.updateMany({ workLocation: { $exists: true } }, { $unset: { workLocation: "" } })`)
      continue
    }
    const res = await col.updateMany(
      { workLocation: { $exists: true } },
      { $unset: { workLocation: '' } },
    )
    console.log(`  $unset applied to ${res.modifiedCount} document(s)`)
  }

  if (!CONFIRM) {
    console.log('\nNothing was written. Re-run with --confirm to apply.')
  }

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
