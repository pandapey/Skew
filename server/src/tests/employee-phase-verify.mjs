// Temporary E2E verification for the Employee-Login phase (bulk file delete,
// task count, chat unread count, calendar range). Run from server/:
//   node src/tests/employee-phase-verify.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import fs from 'fs'
import path from 'path'
import { User } from '../models/User.js'
import { FileItem, Folder } from '../models/fileModels.js'
import { Project, ProjectTask } from '../models/projectModels.js'
import { Conversation, Message } from '../models/chatModels.js'

const API = 'http://localhost:5000/api'
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

const run = async () => {
  await mongoose.connect(TEST_MONGO_URI, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5,
  })

  const TEMP = [
    { email: 'e2e-emp-admin@skew.com', password: 'E2eEmpA#1', role: 'Admin', name: 'E2E Emp Admin', department: 'Management', designation: 'Tester' },
    { email: 'e2e-emp-user@skew.com', password: 'E2eEmpU#1', role: 'Employee', name: 'E2E Emp User', department: 'Engineering', designation: 'Dev' },
  ]
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await FileItem.deleteMany({ name: /^e2e-bulk-/ })
  await Folder.deleteMany({ name: /^E2E BulkV/ })
  await ProjectTask.deleteMany({ title: /^E2E Count Task/ })
  await Project.deleteMany({ name: 'E2E Count Project' })
  await Conversation.deleteMany({ name: /E2E Count/ })
  await Message.deleteMany({ text: /e2e count msg/ })

  for (const t of TEMP) {
    await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
  }
  const admin = await login('e2e-emp-admin@skew.com', 'E2eEmpA#1')
  const emp = await login('e2e-emp-user@skew.com', 'E2eEmpU#1')
  check('Temp admin login', !!admin)
  check('Temp employee login', !!emp)
  if (!admin || !emp) { await mongoose.disconnect(); process.exit(1) }

  // ---- Req 7: /project/tasks/mine/count ----
  const proj = await api('/project', { method: 'POST', token: admin.token, body: {
    name: 'E2E Count Project', code: 'E2E-CNT', client: 'E2E Client', budget: 10000, priority: 'Medium', status: 'Active', lead: 'E2E Emp Admin',
    members: [{ name: 'E2E Emp Admin', role: 'Lead' }, { name: 'E2E Emp User', role: 'Member' }],
  } })
  const pid = proj.data?.id
  check('Count project created', proj.status === 201 && !!pid, pid)
  const t1 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: pid, title: 'E2E Count Task 1', assignee: 'E2E Emp User' } })
  const t2 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: pid, title: 'E2E Count Task 2', assignee: 'E2E Emp User' } })
  const t3 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: pid, title: 'E2E Count Task 3', assignee: 'E2E Emp Admin' } })
  check('Three tasks created', t1.status === 201 && t2.status === 201 && t3.status === 201)

  const mineCount = await api('/project/tasks/mine/count', { token: emp.token })
  check('Employee my-task count = 2', mineCount.status === 200 && mineCount.data?.count === 2, `count=${mineCount.data?.count}`)
  const adminCount = await api('/project/tasks/mine/count', { token: admin.token })
  check('Admin count includes lead task', adminCount.status === 200 && adminCount.data?.count >= 1, `count=${adminCount.data?.count}`)

  // ---- Req 7: /chat/unread-count ----
  const c1 = await api('/chat/users', { token: admin.token })
  const me = (c1.data || []).find((u) => u.email === 'e2e-emp-admin@skew.com')
  const other = (c1.data || []).find((u) => u.email === 'e2e-emp-user@skew.com')
  check('Chat directory lists temp users', !!me && !!other)
  const direct = await api('/chat/conversations/direct', { method: 'POST', token: admin.token, body: { userId: other._id } })
  const convId = direct.data?._id
  check('Direct conversation created', direct.status === 201 && !!convId, convId)
  const msg = await api(`/chat/conversations/${convId}/messages`, { method: 'POST', token: admin.token, body: { text: 'e2e count msg' } })
  check('Message sent', msg.status === 201)
  await sleep(200)
  const unread = await api('/chat/unread-count', { token: emp.token })
  check('Employee chat unread = 1', unread.status === 200 && unread.data?.count === 1, `count=${unread.data?.count}`)
  const read = await api(`/chat/conversations/${convId}/read`, { method: 'POST', token: emp.token })
  check('Mark read ok', read.status === 200)
  await sleep(200)
  const unread2 = await api('/chat/unread-count', { token: emp.token })
  check('Employee chat unread = 0 after read', unread2.status === 200 && unread2.data?.count === 0, `count=${unread2.data?.count}`)
  const blockClient = await api('/chat/unread-count', { token: null })
  check('Chat unread requires auth (401)', blockClient.status === 401, `status=${blockClient.status}`)

  // ---- Req 6: POST /files/bulk-delete — NOW moves files to the Recycle Bin ----
  const upload = async (token, name) => {
    const fd = new FormData()
    fd.append('file', new Blob(['bulk e2e bytes'], { type: 'text/plain' }), name)
    return fetch(`${API}/files/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  }
  const up1 = await upload(admin.token, 'e2e-bulk-a.txt')
  const up2 = await upload(admin.token, 'e2e-bulk-b.txt')
  const up3 = await upload(emp.token, 'e2e-bulk-c.txt')
  const b1 = await up1.json(); const b2 = await up2.json(); const b3 = await up3.json()
  check('Three files uploaded', up1.status === 201 && up2.status === 201 && up3.status === 201, [b1?.id, b2?.id, b3?.id].filter(Boolean).join(','))
  const f1id = b1?.id, f2id = b2?.id, f3id = b3?.id

  // Missing ids -> 400
  const bad = await api('/files/bulk-delete', { method: 'POST', token: admin.token, body: {} })
  check('Bulk delete without ids -> 400', bad.status === 400, `status=${bad.status}`)

  // Employee can move ONLY files they own; foreign file is reported, not fatal
  const empDel = await api('/files/bulk-delete', { method: 'POST', token: emp.token, body: { ids: [f1id, f3id] } })
  check('Employee moves own to Bin, rejects other file', empDel.status === 200
    && empDel.data?.movedCount === 1 && empDel.data?.failedCount === 1
    && empDel.data?.moved?.includes(f3id) && empDel.data?.failed?.[0]?.id === f1id,
    `moved=${empDel.data?.movedCount} failed=${empDel.data?.failedCount}`)

  const f1after = await api(`/files/${f1id}`, { token: admin.token })
  check('Other-user file still exists (untouched)', f1after.status === 200, `status=${f1after.status}`)
  const f3after = await api(`/files/${f3id}`, { token: admin.token })
  check('Own file record still exists (soft delete)', f3after.status === 200 && f3after.data?.isTrashed === true,
    `status=${f3after.status} isTrashed=${f3after.data?.isTrashed}`)
  const trashList = await api('/files/trash', { token: admin.token })
  check('Moved file appears in the Recycle Bin', trashList.status === 200
    && (trashList.data?.files || []).some((f) => f.id === f3id),
    `bin=${(trashList.data?.files || []).length}`)

  // Admin bulk move + missing id reported; the two owned files land in the Bin
  const adminDel = await api('/files/bulk-delete', { method: 'POST', token: admin.token, body: { ids: [f1id, f2id, '000000000000000000000000'] } })
  check('Admin bulk move 2 + missing file reported', adminDel.status === 200
    && adminDel.data?.movedCount === 2 && adminDel.data?.failedCount === 1,
    `moved=${adminDel.data?.movedCount} failed=${adminDel.data?.failedCount}`)
  const remaining = await FileItem.countDocuments({ name: /^e2e-bulk-/ })
  check('Bulk-moved files still exist in DB (bin state)', remaining === 3, `remaining=${remaining}`)

  // Cleanup: hard-delete the binned e2e files (record + disk)
  const binFiles = await FileItem.find({ name: /^e2e-bulk-/ }).select('_id').lean()
  const hard = await api('/files/bulk-hard-delete', { method: 'POST', token: admin.token, body: { ids: binFiles.map((f) => String(f._id)) } })
  check('Bulk hard delete cleans the Bin', hard.status === 200 && hard.data?.deletedCount === 3 && hard.data?.failedCount === 0,
    `deleted=${hard.data?.deletedCount} failed=${hard.data?.failedCount}`)
  const afterHard = await FileItem.countDocuments({ name: /^e2e-bulk-/ })
  check('No e2e bulk files remain in DB after hard delete', afterHard === 0, `remaining=${afterHard}`)

  // ---- Req 5: /calendar/range is window-scoped ----
  const aug = await api('/calendar/range?from=2026-08-01T00:00:00.000Z&to=2026-08-31T23:59:59.999Z', { token: emp.token })
  check('Calendar range returns array', aug.status === 200 && Array.isArray(aug.data), `status=${aug.status}`)
  const outOfWindow = (aug.data || []).filter((e) => {
    const s = new Date(e.start); const en = new Date(e.end)
    return en < new Date('2026-08-01') || s > new Date('2026-08-31T23:59:59.999Z')
  })
  check('Calendar range has no out-of-window events', outOfWindow.length === 0, `out=${outOfWindow.length}`)

  // ---- Cleanup ----
  const del1 = await api(`/project/tasks/${t1.data?.id}`, { method: 'DELETE', token: admin.token })
  const del2 = await api(`/project/tasks/${t2.data?.id}`, { method: 'DELETE', token: admin.token })
  const del3 = await api(`/project/tasks/${t3.data?.id}`, { method: 'DELETE', token: admin.token })
  const delP = await api(`/project/${pid}`, { method: 'DELETE', token: admin.token })
  await Message.deleteMany({ text: 'e2e count msg' })
  await Conversation.deleteMany({ name: /E2E Count/ })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  console.log(`cleanup: tasks ${del1.status}/${del2.status}/${del3.status}, project ${delP.status}`)

  await mongoose.disconnect()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

run().catch(async (e) => {
  console.error('E2E ERROR:', e.message)
  try { await mongoose.disconnect() } catch {}
  process.exit(1)
})