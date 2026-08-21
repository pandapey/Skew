import mongoose from 'mongoose'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Employee ID standardisation: the canonical business Employee ID lives on the
// Employee document (`empCode`), mirrored onto the linked User (`empCode`).
// This migration guarantees every Employee (and, by mirror, every staff User)
// carries a sequential EMP001-style code, assigning one to any record that is
// missing or off-format, in createdAt order. Employee records without a linked
// User (HR-only profiles) are still normalised. In the current DB the codes are
// already correct, so this is expected to be a no-op that guards the invariant.
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

const PREFIX = 'EMP'
const validPattern = new RegExp(`^${PREFIX}\\d+$`)

const last = await db.collection('employees')
  .findOne({ empCode: validPattern }, { sort: { empCode: -1 }, projection: { empCode: 1 } })
let nextN = last ? parseInt(String(last.empCode).slice(PREFIX.length), 10) : 0
if (!Number.isFinite(nextN)) nextN = 0

const rows = await db.collection('employees')
  .find({}, { projection: { name: 1, empCode: 1, userId: 1, createdAt: 1 } })
  .sort({ createdAt: 1 })
  .toArray()

let assigned = 0
for (const e of rows) {
  const code = String(e.empCode || '').trim()
  if (code && validPattern.test(code)) continue
  let candidate = ''
  for (let i = 0; i < 100; i += 1) {
    nextN += 1
    const c = `${PREFIX}${String(nextN).padStart(3, '0')}`
    const clash = await db.collection('employees').findOne({ empCode: c }, { projection: { _id: 1 } })
    if (!clash) {
      candidate = c
      break
    }
  }
  if (!candidate) throw new Error(`Unable to allocate an employee code for "${e.name}"`)
  await db.collection('employees').updateOne({ _id: e._id }, { $set: { empCode: candidate } })
  console.log(`  ${String(e.name).padEnd(24)} ${String(code).padEnd(8) || '(empty)'} -> ${candidate}`)
  assigned += 1
}

console.log(`Employees: ${rows.length}, codes assigned: ${assigned}`)

// Mirror any new codes onto the linked User documents (the shared sync path).
const staff = await db.collection('users')
  .find({ role: { $in: ['Employee', 'Manager'] } }, { projection: { empCode: 1, employeeId: 1 } })
  .toArray()
let mirrored = 0
for (const u of staff) {
  const empCode = String(u.empCode || '').trim()
  if (empCode && validPattern.test(empCode)) continue
  if (u.employeeId) {
    const emp = await db.collection('employees').findOne({ _id: u.employeeId }, { projection: { empCode: 1 } })
    if (emp?.empCode) {
      await db.collection('users').updateOne({ _id: u._id }, { $set: { empCode: emp.empCode } })
      console.log(`  User ${u._id}: empCode -> ${emp.empCode}`)
      mirrored += 1
    }
  }
}

console.log(`Users mirrored: ${mirrored}`)
await mongoose.disconnect()
console.log('Done.')