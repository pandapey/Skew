// E2E verification for the EMPLOYEE READ-STATE phase:
//   Req 1  — task unread count (POST /project/tasks/:id/view, unread-only
//            /project/tasks/mine/count, viewed flag, no viewedBy leak, 403 for
//            non-assignees, persistence across new logins)
//   Req 8  — announcement read state (POST /announcements/:id/read, unread
//            count, read flag, no readBy leak, idempotency, 401 unauthenticated)
// Run from server/:
//   node src/tests/read-state-verify.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Project, ProjectTask } from '../models/projectModels.js'
import { Post } from '../models/announcementModels.js'

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
    { email: 'e2e-rs-admin@skew.com', password: 'E2eRsA#1', role: 'Admin', name: 'E2E RS Admin', department: 'Management', designation: 'Tester' },
    { email: 'e2e-rs-user@skew.com', password: 'E2eRsU#1', role: 'Employee', name: 'E2E RS User', department: 'Engineering', designation: 'Dev' },
  ]
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await ProjectTask.deleteMany({ title: /^E2E RS Task/ })
  await Project.deleteMany({ name: 'E2E RS Project' })
  await Post.deleteMany({ title: /^E2E RS Post/ })

  for (const t of TEMP) {
    await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
  }
  const admin = await login('e2e-rs-admin@skew.com', 'E2eRsA#1')
  const emp = await login('e2e-rs-user@skew.com', 'E2eRsU#1')
  check('Temp admin login', !!admin)
  check('Temp employee login', !!emp)
  if (!admin || !emp) { await mongoose.disconnect(); process.exit(1) }

  // ================= Req 1: TASK READ STATE =================
  const proj = await api('/project', { method: 'POST', token: admin.token, body: {
    name: 'E2E RS Project', code: 'E2E-RS', client: 'E2E Client', budget: 10000, priority: 'Medium', status: 'Active', lead: 'E2E RS Admin',
    members: [{ name: 'E2E RS Admin', role: 'Lead' }, { name: 'E2E RS User', role: 'Member' }],
  } })
  const pid = proj.data?.id
  check('Read-state project created', proj.status === 201 && !!pid, pid)

  const taskIds = []
  for (let i = 1; i <= 3; i++) {
    const t = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: pid, title: `E2E RS Task ${i}`, assignee: 'E2E RS User' } })
    taskIds.push(t.data?.id)
  }
  check('Three assigned tasks created', taskIds.every(Boolean), taskIds.join(','))

  // Unread count = all three (no read state on fresh tasks)
  const c0 = await api('/project/tasks/mine/count', { token: emp.token })
  check('Unread count = 3 for fresh tasks', c0.status === 200 && c0.data?.count === 3, `count=${c0.data?.count}`)

  // Task list exposes per-user `viewed` flag and NEVER the raw viewedBy array
  const list0 = await api('/project/tasks?project=' + pid, { token: emp.token })
  const anyLeak = (list0.data || []).some((t) => 'viewedBy' in t)
  const allFlagged = (list0.data || []).every((t) => t.viewed === false)
  check('Task list has viewed:false and no viewedBy leak', list0.status === 200 && allFlagged && !anyLeak,
    `viewedBy leak=${anyLeak} viewedFlags=${allFlagged}`)

  // Non-assignee (admin) cannot mark the employee's task viewed -> 403
  const adminView = await api(`/project/tasks/${taskIds[0]}/view`, { method: 'POST', token: admin.token })
  check('Non-assignee mark-view -> 403', adminView.status === 403, `status=${adminView.status}`)

  // Marking read one by one decrements the unread count
  for (let i = 0; i < 3; i++) {
    const v = await api(`/project/tasks/${taskIds[i]}/view`, { method: 'POST', token: emp.token })
    check(`Mark task ${i + 1} viewed (200, has id)`, v.status === 200 && v.data?.viewed === true && v.data?.id === taskIds[i] && !('viewedBy' in v.data), `viewed=${v.data?.viewed} id=${v.data?.id}`)
    const c = await api('/project/tasks/mine/count', { token: emp.token })
    check(`Unread count = ${2 - i} after viewing task ${i + 1}`, c.status === 200 && c.data?.count === 2 - i, `count=${c.data?.count}`)
  }

  // Idempotent: re-viewing a task does not go negative
  const again = await api(`/project/tasks/${taskIds[0]}/view`, { method: 'POST', token: emp.token })
  const cAfter = await api('/project/tasks/mine/count', { token: emp.token })
  check('Re-viewing is idempotent (count stays 0)', again.status === 200 && cAfter.data?.count === 0, `count=${cAfter.data?.count}`)

  // Persistence: a brand-new login sees the same persisted state (server truth)
  const emp2 = await login('e2e-rs-user@skew.com', 'E2eRsU#1')
  const cPersist = await api('/project/tasks/mine/count', { token: emp2.token })
  check('Read state persists across logins', !!emp2 && cPersist.data?.count === 0, `count=${cPersist.data?.count}`)

  // 404 for a task that does not exist
  const missing = await api('/project/tasks/000000000000000000000000/view', { method: 'POST', token: emp.token })
  check('Mark-view on missing task -> 404', missing.status === 404, `status=${missing.status}`)

  // ===== USER-SCENARIO: "I completed 2 tasks, 2 are in progress" =====
  // A mixed-status workload must still count every UNVIEWED task; opening each
  // task (the WhatsApp model) decrements the count 4 -> 3 -> 2 -> 1 -> 0.
  const scenIds = []
  const statuses = ['Done', 'Done', 'In Progress', 'In Progress']
  for (let i = 1; i <= 4; i++) {
    const t = await api('/project/tasks', { method: 'POST', token: admin.token, body: {
      project: pid, title: `E2E RS Scenario ${i}`, assignee: 'E2E RS User', status: statuses[i - 1] } })
    scenIds.push(t.data?.id)
  }
  check('Scenario: 4 tasks (2 Done, 2 In Progress) created', scenIds.every(Boolean), scenIds.join(','))

  const scen0 = await api('/project/tasks/mine/count', { token: emp.token })
  check('Scenario: unread = 4 regardless of status', scen0.status === 200 && scen0.data?.count === 4, `count=${scen0.data?.count}`)

  let expected = 3
  for (const id of scenIds) {
    const v = await api(`/project/tasks/${id}/view`, { method: 'POST', token: emp.token })
    const c = await api('/project/tasks/mine/count', { token: emp.token })
    check(`Scenario: viewing task drops count to ${expected}`, v.status === 200 && c.data?.count === expected, `count=${c.data?.count}`)
    expected--
  }

  // ================= Req 8: ANNOUNCEMENT READ STATE =================
  const postIds = []
  for (let i = 1; i <= 3; i++) {
    const p = await api('/announcements', { method: 'POST', token: admin.token, body: { type: 'announcement', title: `E2E RS Post ${i}`, body: `body ${i}` } })
    postIds.push(p.data?.id)
  }
  check('Three posts created', postIds.every(Boolean), postIds.join(','))

  // Route order: /announcements/unread-count is a count, not a post document
  const u0 = await api('/announcements/unread-count', { token: emp.token })
  check('Announcements unread count = 3', u0.status === 200 && u0.data?.count === 3, `count=${u0.data?.count}`)

  // List exposes per-user `read` flag, never the raw readBy array
  const listP = await api('/announcements', { token: emp.token })
  const readLeak = (listP.data || []).some((p) => 'readBy' in p)
  const readFlagged = (listP.data || []).every((p) => p.read === false)
  check('Post list has read:false and no readBy leak', listP.status === 200 && readFlagged && !readLeak,
    `readBy leak=${readLeak} readFlags=${readFlagged}`)

  // Unauthenticated -> 401 on both endpoints
  const unauthCount = await api('/announcements/unread-count')
  const unauthRead = await api(`/announcements/${postIds[0]}/read`, { method: 'POST' })
  check('Unread-count without token -> 401', unauthCount.status === 401, `status=${unauthCount.status}`)
  check('Mark-read without token -> 401', unauthRead.status === 401, `status=${unauthRead.status}`)

  for (let i = 0; i < 3; i++) {
    const r = await api(`/announcements/${postIds[i]}/read`, { method: 'POST', token: emp.token })
    check(`Mark post ${i + 1} read (200, read:true)`, r.status === 200 && r.data?.read === true && !('readBy' in r.data), `read=${r.data?.read}`)
    const u = await api('/announcements/unread-count', { token: emp.token })
    check(`Announcements unread = ${2 - i} after reading post ${i + 1}`, u.status === 200 && u.data?.count === 2 - i, `count=${u.data?.count}`)
  }

  // Idempotent re-read keeps count at 0
  const reRead = await api(`/announcements/${postIds[0]}/read`, { method: 'POST', token: emp.token })
  const uAfter = await api('/announcements/unread-count', { token: emp.token })
  check('Re-reading is idempotent (count stays 0)', reRead.status === 200 && uAfter.data?.count === 0, `count=${uAfter.data?.count}`)

  // Read state is per-user: the admin (who never read the posts) still sees 3
  const uAdmin = await api('/announcements/unread-count', { token: admin.token })
  check('Read state is per-user (admin still unread=3)', uAdmin.status === 200 && uAdmin.data?.count === 3, `count=${uAdmin.data?.count}`)

  // Single-post GET reflects read state too
  const g = await api(`/announcements/${postIds[0]}`, { token: emp.token })
  check('Single post GET has read:true for reader', g.status === 200 && g.data?.read === true && !('readBy' in g.data), `read=${g.data?.read}`)

  // Missing post -> 404
  const missingPost = await api('/announcements/000000000000000000000000/read', { method: 'POST', token: emp.token })
  check('Mark-read on missing post -> 404', missingPost.status === 404, `status=${missingPost.status}`)

  // ================= Cleanup =================
  for (const id of [...taskIds, ...scenIds]) await api(`/project/tasks/${id}`, { method: 'DELETE', token: admin.token })
  await api(`/project/${pid}`, { method: 'DELETE', token: admin.token })
  await Post.deleteMany({ title: /^E2E RS Post/ })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  console.log('cleanup done')

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