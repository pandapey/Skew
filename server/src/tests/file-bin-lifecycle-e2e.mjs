// Temporary E2E verification for the Employee Files / Recycle Bin phase:
// bulk delete must MOVE files to the Bin, the Bin supports selection +
// permanent bulk delete, ownership is enforced per file, missing disk
// binaries are tolerated, and single delete → bin → hard delete still works.
// Run from server/:
//   node src/tests/file-bin-lifecycle-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import fs from 'fs'
import path from 'path'
import { User } from '../models/User.js'
import { FileItem, Folder } from '../models/fileModels.js'

const API = 'https://skew-server-317n.onrender.com/api'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

async function login(email, password) {
  const { status, data } = await api('/auth/login', { method: 'POST', body: { email, password } })
  return status === 200 && data?.token ? data : null
}

const upload = async (token, name) => {
  const fd = new FormData()
  fd.append('file', new Blob(['bin e2e bytes'], { type: 'text/plain' }), name)
  const res = await fetch(`${API}/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  const data = await res.json()
  return { status: res.status, id: data?.id }
}

const run = async () => {
  await mongoose.connect(TEST_MONGO_URI, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5,
  })

  const TEMP = [
    { email: 'e2e-bin-admin@skew.com', password: 'E2eBinA#1', role: 'Admin', name: 'E2E Bin Admin', department: 'Management', designation: 'Tester' },
    { email: 'e2e-bin-user@skew.com', password: 'E2eBinU#1', role: 'Employee', name: 'E2E Bin User', department: 'Engineering', designation: 'Dev' },
  ]
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await FileItem.deleteMany({ name: /^e2e-bin-/ })
  await Folder.deleteMany({ name: /^E2E BinF/ })

  for (const t of TEMP) {
    await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
  }
  const admin = await login('e2e-bin-admin@skew.com', 'E2eBinA#1')
  const emp = await login('e2e-bin-user@skew.com', 'E2eBinU#1')
  check('Temp admin login', !!admin)
  check('Temp employee login', !!emp)
  if (!admin || !emp) { await mongoose.disconnect(); process.exit(1) }

  // ---- T1: active bulk delete MOVES files to the Bin ----
  const a1 = await upload(emp.token, 'e2e-bin-1.txt')
  const a2 = await upload(emp.token, 'e2e-bin-2.txt')
  check('T1 uploads two files', a1.status === 201 && a2.status === 201, [a1.id, a2.id].join(','))

  const activeBefore = await api('/files', { token: emp.token })
  check('T1 both files listed in active view', activeBefore.status === 200
    && (activeBefore.data?.files || []).filter((f) => f.id === a1.id || f.id === a2.id).length === 2,
    `files=${(activeBefore.data?.files || []).length}`)

  const mv = await api('/files/bulk-delete', { method: 'POST', token: emp.token, body: { ids: [a1.id, a2.id] } })
  check('T1 bulk delete moves both to Bin', mv.status === 200 && mv.data?.movedCount === 2 && mv.data?.failedCount === 0,
    `moved=${mv.data?.movedCount}`)

  const activeAfter = await api('/files', { token: emp.token })
  check('T1 active view no longer lists them', activeAfter.status === 200
    && !(activeAfter.data?.files || []).some((f) => f.id === a1.id || f.id === a2.id),
    `files=${(activeAfter.data?.files || []).length}`)
  const bin1 = await api('/files/trash', { token: emp.token })
  check('T1 both files appear in the Recycle Bin', bin1.status === 200
    && (bin1.data?.files || []).filter((f) => f.id === a1.id || f.id === a2.id).length === 2,
    `bin=${(bin1.data?.files || []).length}`)
  const db1 = await FileItem.findById(a1.id).lean()
  check('T1 record kept, isTrashed=true', !!db1 && db1.isTrashed === true && !!db1.trashedAt, `isTrashed=${db1?.isTrashed}`)

  // ---- T2: restore returns a file to the active view ----
  const rs = await api(`/files/${a1.id}/restore`, { method: 'POST', token: emp.token })
  check('T2 restore ok', rs.status === 200 && rs.data?.isTrashed === false, `status=${rs.status}`)
  const activeRestored = await api('/files', { token: emp.token })
  check('T2 restored file back in active view', activeRestored.status === 200
    && (activeRestored.data?.files || []).some((f) => f.id === a1.id),
    `files=${(activeRestored.data?.files || []).length}`)

  // ---- T3: ownership — employee cannot move other users' files ----
  const adminF = await upload(admin.token, 'e2e-bin-admin.txt')
  const bin3 = await upload(emp.token, 'e2e-bin-3.txt')
  const mixed = await api('/files/bulk-delete', { method: 'POST', token: emp.token, body: { ids: [bin3.id, adminF.id] } })
  check('T3 own moves, foreign fails (1 moved / 1 failed)', mixed.status === 200
    && mixed.data?.movedCount === 1 && mixed.data?.failedCount === 1
    && mixed.data?.moved?.includes(bin3.id) && mixed.data?.failed?.[0]?.id === adminF.id,
    `moved=${mixed.data?.movedCount} failed=${mixed.data?.failedCount}`)
  const foreignAfter = await api(`/files/${adminF.id}`, { token: emp.token })
  check('T3 foreign file untouched', foreignAfter.status === 200 && foreignAfter.data?.isTrashed === false,
    `isTrashed=${foreignAfter.data?.isTrashed}`)

  // ---- T4: bulk hard delete removes records AND disk binaries ----
  // a1 was restored in T2 — move it back to the Bin so both are binned.
  await api('/files/bulk-delete', { method: 'POST', token: emp.token, body: { ids: [a1.id] } })
  const binFiles = await FileItem.find({ name: /^e2e-bin-[12]\.txt$/ }).lean()
  check('T4 both records in bin before hard delete', binFiles.length === 2, `found=${binFiles.length}`)
  const diskBefore = binFiles.map((f) => path.resolve(process.cwd(), 'uploads', (f.versions?.[0]?.filename) || ''))
  check('T4 binned files have disk binaries', diskBefore.every((p) => fs.existsSync(p)), diskBefore.join(' | '))

  const hard = await api('/files/bulk-hard-delete', { method: 'POST', token: emp.token, body: { ids: binFiles.map((f) => String(f._id)) } })
  check('T4 bulk hard delete removes both', hard.status === 200 && hard.data?.deletedCount === 2 && hard.data?.failedCount === 0,
    `deleted=${hard.data?.deletedCount}`)
  const dbAfter = await FileItem.countDocuments({ _id: { $in: [a1.id, a2.id] } })
  check('T4 records removed from DB', dbAfter === 0, `remaining=${dbAfter}`)
  check('T4 disk binaries removed', diskBefore.every((p) => !fs.existsSync(p)), 'disk still present')
  const binEmpty = await api('/files/trash', { token: emp.token })
  check('T4 bin no longer lists them', binEmpty.status === 200
    && !(binEmpty.data?.files || []).some((f) => f.id === a1.id || f.id === a2.id),
    `bin=${(binEmpty.data?.files || []).length}`)

  // ---- T5: ownership on bulk hard delete ----
  const guard = await upload(admin.token, 'e2e-bin-guard.txt')
  const hardMixed = await api('/files/bulk-hard-delete', { method: 'POST', token: emp.token, body: { ids: [guard.id] } })
  check('T5 employee cannot hard-delete admin file', hardMixed.status === 200 && hardMixed.data?.deletedCount === 0 && hardMixed.data?.failedCount === 1,
    `deleted=${hardMixed.data?.deletedCount} failed=${hardMixed.data?.failedCount}`)
  const guardAfter = await api(`/files/${guard.id}`, { token: admin.token })
  check('T5 admin file still intact', guardAfter.status === 200, `status=${guardAfter.status}`)
  const guardDel = await api(`/files/${guard.id}`, { method: 'DELETE', token: admin.token })
  check('T5 cleanup: single soft delete ok', guardDel.status === 200, `status=${guardDel.status}`)
  await api(`/files/${guard.id}/hard`, { method: 'DELETE', token: admin.token })

  // ---- T6: missing disk binary still removes the record (graceful) ----
  const ghost = await upload(emp.token, 'e2e-bin-ghost.txt')
  const ghostRec = await FileItem.findById(ghost.id).lean()
  const ghostDisk = path.resolve(process.cwd(), 'uploads', ghostRec.versions?.[0]?.filename || '')
  if (fs.existsSync(ghostDisk)) fs.unlinkSync(ghostDisk)
  const ghostDel = await api('/files/bulk-delete', { method: 'POST', token: emp.token, body: { ids: [ghost.id] } })
  check('T6 ghost file moved to bin', ghostDel.status === 200 && ghostDel.data?.movedCount === 1, `moved=${ghostDel.data?.movedCount}`)
  const ghostHard = await api('/files/bulk-hard-delete', { method: 'POST', token: emp.token, body: { ids: [ghost.id] } })
  check('T6 hard delete ok despite missing disk binary', ghostHard.status === 200 && ghostHard.data?.deletedCount === 1 && ghostHard.data?.failedCount === 0,
    `deleted=${ghostHard.data?.deletedCount} failed=${ghostHard.data?.failedCount}`)
  const ghostGone = await FileItem.findById(ghost.id).lean()
  check('T6 orphaned record removed', !ghostGone)

  // ---- T7: single delete → bin → single hard delete regression ----
  const single = await upload(emp.token, 'e2e-bin-single.txt')
  const singleDel = await api(`/files/${single.id}`, { method: 'DELETE', token: emp.token })
  check('T7 single delete moves to bin', singleDel.status === 200 && singleDel.data?.message?.includes('recycle'), `status=${singleDel.status}`)
  const singleRec = await FileItem.findById(single.id).lean()
  check('T7 single-deleted record isTrashed', !!singleRec && singleRec.isTrashed === true)
  const singleRestore = await api(`/files/${single.id}/restore`, { method: 'POST', token: emp.token })
  check('T7 single restore ok', singleRestore.status === 200 && singleRestore.data?.isTrashed === false, `status=${singleRestore.status}`)
  const singleHard = await api(`/files/${single.id}/hard`, { method: 'DELETE', token: emp.token })
  check('T7 single hard delete ok', singleHard.status === 200, `status=${singleHard.status}`)
  const singleGone = await FileItem.findById(single.id).lean()
  check('T7 single file fully removed', !singleGone)

  // ---- Cleanup ----
  await api('/files/bulk-hard-delete', { method: 'POST', token: admin.token, body: { ids: [bin3.id, adminF.id] } })
  await FileItem.deleteMany({ name: /^e2e-bin-/ })
  await Folder.deleteMany({ name: /^E2E BinF/ })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })

  await mongoose.disconnect()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1) })
