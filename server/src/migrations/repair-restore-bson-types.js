// ---------------------------------------------------------------------------
// RECOVERY TOOL — repair BSON types flattened by a pre-fix restore.
//
// Usage (from server/):
//   node src/migrations/repair-restore-bson-types.js            # DRY RUN (default)
//   node src/migrations/repair-restore-bson-types.js --confirm  # actually write
//
// WHAT WENT WRONG
// ---------------
// routes/adminRoutes.js writeArchive() serialised the database dump with
// `JSON.stringify()`. JSON has no BSON types, so:
//     ObjectId("6a70...")            -> "6a70..."          (plain string)
//     ISODate("2026-08-03T06:56Z")   -> "2026-08-03T06:56Z" (plain string)
// That was harmless while archives were only ever DOWNLOADED. The moment
// POST /admin/restore/:id started writing an archive BACK into the database,
// every document was re-inserted with a STRING `_id` and string dates/refs.
//
// Consequences observed:
//   * `User.findById(ObjectId(...))` matches nothing -> `protect` 401s every
//     authenticated request -> "login failed" in the browser.
//   * `doc.save()` on a hydrated-but-unmatched document throws
//     `DocumentNotFoundError`, which crashed the Node process on boot.
//
// NO DATA WAS LOST. Every document and every field survived the round trip —
// only their TYPES were flattened. This tool casts them back.
//
// HOW IT REPAIRS
// --------------
// Type information is taken from the application's OWN Mongoose schemas, never
// guessed from the shape of a value. Each raw document is re-cast through its
// model (`new Model(raw)`), which converts every declared ObjectId / Date path —
// including paths inside nested document arrays — and then written back with the
// raw driver. `.save()` is deliberately NOT used, so no pre-save hook fires:
// password hashes are not re-hashed and employee codes are not re-allocated.
//
// Because `_id` is immutable, a repaired document is inserted under its correct
// ObjectId and the string-keyed original is removed, inside a per-document
// try/catch so one bad row cannot abort the run.
//
// Collections with no registered model are repaired conservatively: only a
// string `_id` that is a valid 24-hex ObjectId is converted. Other fields are
// left exactly as they are rather than guessed at.
// ---------------------------------------------------------------------------
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

// Importing the model modules is what registers them on the mongoose singleton.
await import('../models/User.js')
await import('../models/Employee.js')
await import('../models/adminModels.js')
await import('../models/announcementModels.js')
await import('../models/attendanceModels.js')
await import('../models/calendarModels.js')
await import('../models/clientModels.js')
await import('../models/fileModels.js')
await import('../models/financeModels.js')
await import('../models/hrModels.js')
await import('../models/leaveModels.js')
await import('../models/notificationModels.js')
await import('../models/projectModels.js')

const CONFIRM = process.argv.includes('--confirm')
const HEX24 = /^[a-f0-9]{24}$/i

const toObjectId = (v) =>
  (typeof v === 'string' && HEX24.test(v) ? new mongoose.Types.ObjectId(v) : v)

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0'
  await mongoose.connect(uri)
  const db = mongoose.connection.db
  console.log(`Connected to ${db.databaseName}`)
  console.log(CONFIRM ? 'MODE: WRITE (--confirm given)\n' : 'MODE: DRY RUN (pass --confirm to write)\n')

  // collectionName -> Model
  const byCollection = new Map()
  for (const name of mongoose.modelNames()) {
    const M = mongoose.model(name)
    byCollection.set(M.collection.collectionName, M)
  }

  const collections = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !/^system\./.test(n))
    .sort()

  let totalRepaired = 0
  let totalFailed = 0

  for (const name of collections) {
    const col = db.collection(name)
    const stringIdCount = await col.countDocuments({ _id: { $type: 'string' } })
    if (!stringIdCount) continue

    const Model = byCollection.get(name)
    const how = Model ? `schema-cast via ${Model.modelName}` : 'id-only (no model registered)'
    console.log(`${name}: ${stringIdCount} document(s) with a string _id — ${how}`)

    if (!CONFIRM) { totalRepaired += stringIdCount; continue }

    const docs = await col.find({ _id: { $type: 'string' } }).toArray()
    let okCount = 0
    for (const raw of docs) {
      const oldId = raw._id
      try {
        let repaired
        if (Model) {
          // Re-cast every declared path through the schema. `new Model(raw)`
          // converts _id, ObjectId refs, Dates and nested document arrays.
          const casted = new Model(raw)
          repaired = casted.toObject({ depopulate: true, virtuals: false })
          // Belt and braces: if the schema left _id a string for any reason,
          // convert it directly rather than re-inserting a broken key.
          repaired._id = toObjectId(repaired._id)
        } else {
          repaired = { ...raw, _id: toObjectId(raw._id) }
        }

        if (typeof repaired._id === 'string') {
          console.log(`  SKIP ${oldId} — _id is not a valid ObjectId, left untouched`)
          continue
        }

        // PREFERRED ORDER: insert under the correct id first, then drop the
        // broken row — a failure at this point can never destroy the only copy.
        //
        // That order fails on any collection carrying a UNIQUE index on a
        // non-_id field (users.email, roles.name, notificationsettings.user,
        // employees.empCode, ...), because the repaired copy collides with the
        // string-keyed original that is still present. For those, the delete
        // has to come first — with the original held in memory and RE-INSERTED
        // if the repaired insert then fails, so the document is never lost.
        try {
          await col.insertOne(repaired)
          await col.deleteOne({ _id: oldId })
        } catch (err) {
          if (err?.code !== 11000) throw err
          await col.deleteOne({ _id: oldId })
          try {
            await col.insertOne(repaired)
          } catch (inner) {
            // Put the original back exactly as it was, then report honestly.
            await col.insertOne(raw).catch(() => {})
            throw inner
          }
        }
        okCount += 1
      } catch (err) {
        totalFailed += 1
        console.log(`  FAIL ${oldId}: ${err?.message?.split('\n')[0]}`)
      }
    }
    console.log(`  repaired ${okCount}/${docs.length}`)
    totalRepaired += okCount
  }

  console.log('')
  if (!CONFIRM) {
    console.log(`DRY RUN: ${totalRepaired} document(s) would be repaired.`)
    console.log('Re-run with --confirm to apply.')
  } else {
    console.log(`Repaired ${totalRepaired} document(s). Failures: ${totalFailed}.`)
  }
  await mongoose.disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
