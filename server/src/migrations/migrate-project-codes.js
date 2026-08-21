import mongoose from 'mongoose'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Project ID standardisation: backfill business-facing Project codes as
// PRJ001, PRJ002, … so every project has a stable, sequential, unique code.
// Generated codes are assigned in createdAt order; existing codes that already
// follow the PRJ<digits> pattern are left untouched. The script ends by
// building the sparse unique index that the Project model now declares, so a
// duplicate or empty code surfaces HERE (with the data right there to fix)
// instead of failing the server's own index build on next boot.
dns.setServers(['8.8.8.8', '1.1.1.1'])

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '../..')
const env = fs.readFileSync(path.join(serverRoot, '.env'), 'utf8')
const uri = env.split('\n').find((l) => l.startsWith('MONGO_URI='))?.split('=').slice(1).join('=')
if (!uri) {
  console.error('MONGO_URI missing from server/.env — aborting')
  process.exit(1)
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 })
const db = mongoose.connection.db

const PREFIX = 'PRJ'
const validPattern = new RegExp(`^${PREFIX}\\d+$`)

// Highest existing sequential code (any project, generated or legacy-PRJ).
const last = await db.collection('projects')
  .findOne({ code: validPattern }, { sort: { code: -1 }, projection: { code: 1 } })
let nextN = last ? parseInt(String(last.code).slice(PREFIX.length), 10) : 0
if (!Number.isFinite(nextN)) nextN = 0

const rows = await db.collection('projects')
  .find({}, { projection: { name: 1, code: 1, createdAt: 1 } })
  .sort({ createdAt: 1 })
  .toArray()

let assigned = 0
for (const p of rows) {
  const code = String(p.code || '').trim()
  if (code && validPattern.test(code)) continue // already standard
  let candidate = ''
  for (let i = 0; i < 100; i += 1) {
    nextN += 1
    const c = `${PREFIX}${String(nextN).padStart(3, '0')}`
    const clash = await db.collection('projects').findOne({ code: c }, { projection: { _id: 1 } })
    if (!clash) {
      candidate = c
      break
    }
  }
  if (!candidate) throw new Error(`Unable to allocate a project code for "${p.name}"`)
  await db.collection('projects').updateOne({ _id: p._id }, { $set: { code: candidate } })
  console.log(`  ${String(p.name).padEnd(32)} ${String(code).padEnd(8) || '(empty)'} -> ${candidate}`)
  assigned += 1
}

console.log(`Projects: ${rows.length}, codes assigned: ${assigned}, next: ${PREFIX}${String(nextN).padStart(3, '0')}`)

// Enforce uniqueness at the DB level (sparse: rows without a code stay legal
// only until the generator covers them; after this backfill every row has one).
await db.collection('projects').createIndex({ code: 1 }, { unique: true, sparse: true })
console.log('Sparse unique index on projects.code: OK')

await mongoose.disconnect()
console.log('Done.')