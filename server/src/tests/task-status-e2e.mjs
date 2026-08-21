// E2E verification for the PHASE: EMPLOYEE TASK changes:
//   - PATCH /project/tasks/:id/status (start | pending | hold | complete)
//   - GET /project/tasks?assignedBy=<name> (the "Assigned by Me" tab)
// Uses the LIVE server + MongoDB. Prints PASS/FAIL per check, exits 1 on failure.
// Run from server/: node src/tests/task-status-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Project, ProjectTask, ProjectActivity } from '../models/projectModels.js'
import { Notification } from '../models/notificationModels.js'

const API = 'http://localhost:5000/api'
const TEMP = [
  { email: 'e2e-ts-admin@skew.com', password: 'E2eTsAdmin#1', role: 'Admin', name: 'TS E2E Admin', department: 'Management', designation: 'Tester' },
  { email: 'e2e-ts-a@skew.com', password: 'E2eTsA#1', role: 'Employee', name: 'TS E2E Emp A', department: 'Engineering', designation: 'Dev' },
  { email: 'e2e-ts-b@skew.com', password: 'E2eTsB#1', role: 'Employee', name: 'TS E2E Emp B', department: 'Engineering', designation: 'Dev' },
]
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
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

  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await ProjectTask.deleteMany({ title: /^E2E Status/ })
  const oldProjects = await Project.find({ name: 'E2E Status Project' }).select('_id').lean()
  await Project.deleteMany({ name: 'E2E Status Project' })
  await ProjectActivity.deleteMany({ project: { $in: oldProjects.map((p) => p._id) } })

  for (const t of TEMP) {
    await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
  }
  const admin = await login('e2e-ts-admin@skew.com', 'E2eTsAdmin#1')
  const empA = await login('e2e-ts-a@skew.com', 'E2eTsA#1')
  const empB = await login('e2e-ts-b@skew.com', 'E2eTsB#1')
  check('Temp admin login', !!admin)
  check('Temp employee A login', !!empA)
  check('Temp employee B login', !!empB)
  if (!admin || !empA || !empB) {
    await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
    await mongoose.disconnect(); process.exit(1)
  }

  const proj = await api('/project', {
    method: 'POST', token: admin.token,
    body: {
      name: 'E2E Status Project', code: 'E2E-S', client: 'E2E Client Co',
      members: [{ name: 'TS E2E Admin', role: 'Lead' }, { name: 'TS E2E Emp A', role: 'Member' }, { name: 'TS E2E Emp B', role: 'Member' }],
      budget: 50000, priority: 'Medium', status: 'Active', lead: 'TS E2E Admin',
    },
  })
  check('Project created (201)', proj.status === 201 && proj.data?.id, proj.data?.id)
  const projectId = proj.data?.id

  const t1 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: projectId, title: 'E2E Status Task 1', assignee: 'TS E2E Emp A' } })
  check('Task created (201)', t1.status === 201 && t1.data?.id, t1.data?.id)
  const task1Id = t1.data?.id

  // --- assignedBy filter ("Assigned by Me") ---
  const byAdmin = await api(`/project/tasks?assignedBy=${encodeURIComponent('TS E2E Admin')}`, { token: admin.token })
  check('assignedBy filter finds the task', byAdmin.status === 200 && byAdmin.data?.some((t) => t.id === task1Id), `count=${byAdmin.data?.length}`)
  const byEmpA = await api(`/project/tasks?assignedBy=${encodeURIComponent('TS E2E Emp A')}`, { token: admin.token })
  check('assignedBy filter excludes other assigners', byEmpA.status === 200 && !byEmpA.data?.some((t) => t.id === task1Id))
  const assigneeFilter = await api(`/project/tasks?assignee=${encodeURIComponent('TS E2E Emp A')}`, { token: empA.token })
  check('assignee filter still works for the to-me list', assigneeFilter.status === 200 && assigneeFilter.data?.some((t) => t.id === task1Id))

  // --- Status transitions (PATCH /tasks/:id/status) ---
  const st1 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'start' } })
  check('status=start -> startedAt + In Progress', st1.status === 200 && st1.data?.startedAt && st1.data?.status === 'In Progress', `status=${st1.data?.status}`)
  await sleep(1100)
  const st2 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'hold' } })
  check('status=hold -> pausedAt set', st2.status === 200 && st2.data?.pausedAt, `pausedAt=${st2.data?.pausedAt}`)
  const st3 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'start' } })
  check('status=start on a held task RESUMES it (pausedAt cleared)', st3.status === 200 && !st3.data?.pausedAt && st3.data?.status === 'In Progress')
  const st4 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'pending' } })
  check('status=pending resets to not-started (Todo)', st4.status === 200 && !st4.data?.startedAt && st4.data?.status === 'Todo', `status=${st4.data?.status}`)
  const st5 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'complete' } })
  check('status=complete -> SUBMITTED for approval (Review, not auto-Done)', st5.status === 200 && st5.data?.submissionStatus === 'Submitted' && st5.data?.status === 'Review' && st5.data?.completedAt, `status=${st5.data?.status} sub=${st5.data?.submissionStatus} durationSec=${st5.data?.durationSec}`)
  const st6 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'complete' } })
  check('submitted-for-approval task rejects a second complete (409)', st6.status === 409, `status=${st6.status}`)
  const queue = await api('/project/tasks/review-queue', { token: admin.token })
  check('completed task lands in the review queue', queue.status === 200 && queue.data?.some((t) => t.id === task1Id), `queue=${queue.data?.length}`)
  const st7 = await api(`/project/tasks/${task1Id}/status`, { method: 'PATCH', token: empB.token, body: { status: 'start' } })
  check('non-assignee is forbidden (403)', st7.status === 403, `status=${st7.status}`)
  const t3 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: projectId, title: 'E2E Status Task 3', assignee: 'TS E2E Emp A' } })
  const bad = await api(`/project/tasks/${t3.data?.id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'bogus' } })
  check('invalid status is rejected (422) on a fresh task', bad.status === 422, `status=${bad.status}`)

  // A SUBMITTED task cannot be re-opened via the status endpoint.
  const t2 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: projectId, title: 'E2E Status Task 2', assignee: 'TS E2E Emp A' } })
  const sub = await api(`/project/tasks/${t2.data?.id}/submit`, { method: 'POST', token: empA.token, body: { comment: 'Submitting this work' } })
  check('Task 2 submitted (Review)', sub.status === 200 && sub.data?.submissionStatus === 'Submitted', `status=${sub.data?.submissionStatus}`)
  const st9 = await api(`/project/tasks/${t2.data?.id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'complete' } })
  check('submitted task rejects status changes (409)', st9.status === 409, `status=${st9.status}`)

  // REGRESSION: a "pending" reset must drop old pause intervals, and a pause
  // recorded BEFORE startedAt must never be subtracted from working time.
  const t4 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: projectId, title: 'E2E Status Task 4', assignee: 'TS E2E Emp A' } })
  const t4Id = t4.data?.id
  await ProjectTask.updateOne({ _id: t4Id }, { $set: { pauseIntervals: [{ from: new Date(Date.now() - 72000000), to: new Date(Date.now() - 36000000) }] } })
  await api(`/project/tasks/${t4Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'start' } })
  await sleep(1100)
  await api(`/project/tasks/${t4Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'hold' } })
  await api(`/project/tasks/${t4Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'pending' } })
  const t4pend = await ProjectTask.findById(t4Id).select('pauseIntervals startedAt').lean()
  check('pending reset clears pauseIntervals', (t4pend.pauseIntervals || []).length === 0 && !t4pend.startedAt, `intervals=${(t4pend.pauseIntervals || []).length}`)
  await api(`/project/tasks/${t4Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'start' } })
  await sleep(1100)
  const t4done = await api(`/project/tasks/${t4Id}/status`, { method: 'PATCH', token: empA.token, body: { status: 'complete' } })
  check('working time accrues after reset (pre-start pause ignored)', t4done.status === 200 && t4done.data?.durationSec >= 1, `durationSec=${t4done.data?.durationSec}`)

  // Cleanup
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await ProjectTask.deleteMany({ title: /^E2E Status/ })
  await ProjectActivity.deleteMany({ project: { $in: (await Project.find({ name: 'E2E Status Project' }).select('_id').lean()).map((p) => p._id) } })
  await Project.deleteMany({ name: 'E2E Status Project' })
  await Notification.deleteMany({ sender: { $in: TEMP.map((t) => t.name) } })
  await mongoose.disconnect()

  console.log(`\ntask-status-e2e: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

run().catch((e) => { console.error(e); process.exit(1) })