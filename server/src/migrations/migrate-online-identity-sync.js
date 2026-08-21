import mongoose from 'mongoose'
import dns from 'dns'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// The system/Node resolver points at 127.0.0.1, which breaks Atlas SRV
// resolution. db.js does the same, so keep it consistent here.
dns.setServers(['8.8.8.8', '1.1.1.1'])

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '../..')

const LOCAL_URI = 'mongodb://127.0.0.1:27017/skew'
const envPath = path.join(serverRoot, '.env')
const env = fs.readFileSync(envPath, 'utf8')
const ONLINE_URI = env.split('\n').find((l) => l.startsWith('MONGO_URI='))?.split('=').slice(1).join('=')

if (!ONLINE_URI) {
  console.error('MONGO_URI missing from server/.env — aborting')
  process.exit(1)
}

// Local user email that the online DB already has (deliberate online Admin).
// Its online document is preserved untouched; the local Employee duplicate
// and its employee record are skipped so no dangling links are created.
const CONFLICT_EMAIL = 'test@gmail.com'

// Collections synced by upsert key.
const REFERENCE = [
  ['departments', 'name'],
  ['designations', 'name'],
  ['shifts', 'name'],
  ['leavetypes', 'name'],
]

function summarize(rows) {
  const ok = rows.filter((r) => r.action === 'synced' || r.action === 'exists').length
  const skipped = rows.filter((r) => r.action === 'skipped').length
  console.log(`  ${ok} synced/present, ${skipped} skipped`)
  for (const r of rows.filter((x) => x.action === 'skipped')) {
    console.log(`    skipped: ${r.reason} (${r.key})`)
  }
}

console.log('Syncing local identity data ->', ONLINE_URI.includes('mongodb+srv') ? 'ONLINE (Atlas)' : 'online URI')

await mongoose.connect(LOCAL_URI, { serverSelectionTimeoutMS: 8000 })
const local = mongoose.connection.db

const onlineM = new mongoose.Mongoose()
await onlineM.connect(ONLINE_URI, { serverSelectionTimeoutMS: 15000 })
const online = onlineM.connection.db

// ---- users (skip any email that already exists online) ----
const localUsers = await local.collection('users').find().toArray()
const onlineEmails = new Set((await online.collection('users').find({}, { projection: { email: 1 } }).toArray()).map((u) => u.email))
const userRows = []
const usersToInsert = []
for (const u of localUsers) {
  if (u.email === CONFLICT_EMAIL) {
    userRows.push({ key: u.email, action: 'skipped', reason: 'online copy exists as Admin; local Employee duplicate not copied' })
  } else if (onlineEmails.has(u.email)) {
    userRows.push({ key: u.email, action: 'exists', reason: '' })
  } else {
    usersToInsert.push(u)
    userRows.push({ key: u.email, action: 'synced' })
  }
}
if (usersToInsert.length) {
  await online.collection('users').insertMany(usersToInsert.map(({ _id, ...rest }) => ({ _id, ...rest })))
}
console.log('users:')
summarize(userRows)

// ---- roles (add missing system roles) ----
const localRoles = await local.collection('roles').find().toArray()
const onlineRoleNames = new Set((await online.collection('roles').find({}, { projection: { name: 1 } }).toArray()).map((r) => r.name))
const rolesToInsert = localRoles.filter((r) => !onlineRoleNames.has(r.name))
if (rolesToInsert.length) {
  await online.collection('roles').insertMany(rolesToInsert.map(({ _id, ...rest }) => ({ _id, ...rest })))
}
console.log('roles:')
for (const r of rolesToInsert) console.log('  synced:', r.name)
for (const r of localRoles.filter((x) => onlineRoleNames.has(x.name))) console.log('  exists:', r.name)

// ---- employees (skip records whose linked user was not synced) ----
const localEmployees = await local.collection('employees').find().toArray()
const syncedUserIds = new Set(usersToInsert.map((u) => String(u._id)))
const empRows = []
const empsToInsert = []
for (const e of localEmployees) {
  if (!syncedUserIds.has(String(e.userId))) {
    empRows.push({ key: e.email || e.empCode, action: 'skipped', reason: `linked user not synced (userId ${e.userId})` })
  } else {
    empsToInsert.push(e)
    empRows.push({ key: e.email || e.empCode, action: 'synced' })
  }
}
if (empsToInsert.length) {
  await online.collection('employees').insertMany(empsToInsert.map(({ _id, ...rest }) => ({ _id, ...rest })))
}
console.log('employees:')
summarize(empRows)

// ---- clients (upsert by clientId) ----
const localClients = await local.collection('clients').find().toArray()
const onlineClientIds = new Set((await online.collection('clients').find({}, { projection: { clientId: 1 } }).toArray()).map((c) => c.clientId))
const clientsToInsert = localClients.filter((c) => !onlineClientIds.has(c.clientId))
if (clientsToInsert.length) {
  await online.collection('clients').insertMany(clientsToInsert.map(({ _id, ...rest }) => ({ _id, ...rest })))
}
console.log('clients:')
for (const c of clientsToInsert) console.log('  synced:', c.clientId, c.company)
for (const c of localClients.filter((x) => onlineClientIds.has(x.clientId))) console.log('  exists:', c.clientId)

// ---- reference collections (departments, designations, shifts, leavetypes) ----
for (const [name, key] of REFERENCE) {
  const localDocs = await local.collection(name).find().toArray()
  const onlineKeys = new Set((await online.collection(name).find({}, { projection: { [key]: 1 } }).toArray()).map((d) => d[key]))
  const toInsert = localDocs.filter((d) => !onlineKeys.has(d[key]))
  if (toInsert.length) {
    await online.collection(name).insertMany(toInsert.map(({ _id, ...rest }) => ({ _id, ...rest })))
  }
  console.log(`${name}: ${toInsert.length} synced, ${localDocs.length - toInsert.length} present`)
}

await onlineM.disconnect()
await mongoose.disconnect()
console.log('Done.')
