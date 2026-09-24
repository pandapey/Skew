import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

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
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI is required (set it in server/.env)')
  await mongoose.connect(uri)
  const db = mongoose.connection.db
  console.log(`Connected to ${db.databaseName}`)
  console.log(CONFIRM ? 'MODE: WRITE (--confirm given)\n' : 'MODE: DRY RUN (pass --confirm to write)\n')

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
          const casted = new Model(raw)
          repaired = casted.toObject({ depopulate: true, virtuals: false })
          repaired._id = toObjectId(repaired._id)
        } else {
          repaired = { ...raw, _id: toObjectId(raw._id) }
        }

        if (typeof repaired._id === 'string') {
          console.log(`  SKIP ${oldId} — _id is not a valid ObjectId, left untouched`)
          continue
        }
        try {
          await col.insertOne(repaired)
          await col.deleteOne({ _id: oldId })
        } catch (err) {
          if (err?.code !== 11000) throw err
          await col.deleteOne({ _id: oldId })
          try {
            await col.insertOne(repaired)
          } catch (inner) {
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
