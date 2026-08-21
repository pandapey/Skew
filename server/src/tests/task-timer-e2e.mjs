// E2E verification for the Phase 7.2 task timer (start/pause/resume/submit),
// self-approval, task attachments and the task-history payload. Uses the LIVE
// server + MongoDB. Prints PASS/FAIL per check, exits 1 on any failure.
// Run from server/: node src/tests/task-timer-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import fs from 'fs'
import path from 'path'
import { User } from '../models/User.js'
import { Project, ProjectTask, ProjectActivity, ProjectFile } from '../models/projectModels.js'
import { Notification } from '../models/notificationModels.js'

const API = 'http://localhost:5000/api'
const TEMP = [
  { email: 'e2e-tt-admin@skew.com', password: 'E2eTtAdmin#1', role: 'Admin', name: 'TT E2E Admin', department: 'Management', designation: 'Tester' },
  { email: 'e2e-tt-a@skew.com', password: 'E2eTtA#1', role: 'Employee', name: 'TT E2E Emp A', department: 'Engineering', designation: 'Dev' },
  { email: 'e2e-tt-b@skew.com', password: 'E2eTtB#1', role: 'Employee', name: 'TT E2E Emp B', department: 'Engineering', designation: 'Dev' },
]
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

  // Idempotent setup: clear leftovers from an aborted previous run.
  const oldUsers = await User.find({ email: { $in: TEMP.map((t) => t.email) } }, { _id: 1 }).lean()
  const oldNames = oldUsers.length ? TEMP.map((t) => t.name) : []
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await ProjectTask.deleteMany({ title: /^E2E Timer/ })
  await Project.deleteMany({ name: 'E2E Timer Project' })
  await ProjectActivity.deleteMany({ project: { $in: (await Project.find({ name: 'E2E Timer Project' }).select('_id').lean()).map((p) => p._id) } })
  await Notification.deleteMany({ sender: { $in: oldNames.filter(Boolean) } })

  const tempIds = []
  for (const t of TEMP) {
    const doc = await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
    tempIds.push(doc._id)
  }
  const admin = await login('e2e-tt-admin@skew.com', 'E2eTtAdmin#1')
  const empA = await login('e2e-tt-a@skew.com', 'E2eTtA#1')
  const empB = await login('e2e-tt-b@skew.com', 'E2eTtB#1')
  check('Temp admin login', !!admin)
  check('Temp employee A login', !!empA)
  check('Temp employee B login', !!empB)
  if (!admin || !empA || !empB) {
    await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
    await mongoose.disconnect(); process.exit(1)
  }

  // --- Project + task setup ---
  const proj = await api('/project', {
    method: 'POST', token: admin.token,
    body: {
      name: 'E2E Timer Project', code: 'E2E-T', client: 'E2E Client Co',
      members: [{ name: 'TT E2E Admin', role: 'Lead' }, { name: 'TT E2E Emp A', role: 'Member' }, { name: 'TT E2E Emp B', role: 'Member' }],
      budget: 50000, priority: 'Medium', status: 'Active', lead: 'TT E2E Admin',
    },
  })
  check('Project created (201)', proj.status === 201 && proj.data?.id, proj.data?.id)
  const projectId = proj.data?.id

  const t1 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: projectId, title: 'E2E Timer Task 1', assignee: 'TT E2E Emp A' } })
  check('Task 1 created (201)', t1.status === 201 && t1.data?.id, t1.data?.id)
  const task1Id = t1.data?.id

  const t2 = await api('/project/tasks', { method: 'POST', token: admin.token, body: { project: projectId, title: 'E2E Timer Task 2', assignee: 'TT E2E Emp A' } })
  check('Task 2 created (201)', t2.status === 201 && t2.data?.id)
  const task2Id = t2.data?.id

  // --- Guard rails ---
  const wrongStart = await api(`/project/tasks/${task1Id}/start`, { method: 'POST', token: empB.token })
  check('Non-assignee cannot start (403)', wrongStart.status === 403, `status=${wrongStart.status}`)

  const pauseBeforeStart = await api(`/project/tasks/${task2Id}/pause`, { method: 'POST', token: empA.token, body: { reason: '' } })
  check('Pause before start rejected (409)', pauseBeforeStart.status === 409, `status=${pauseBeforeStart.status}`)

  // --- Timer: start -> pause -> (wait) -> resume -> (wait) -> submit ---
  const start = await api(`/project/tasks/${task1Id}/start`, { method: 'POST', token: empA.token })
  check('Start task (200, startedAt set)', start.status === 200 && !!start.data?.startedAt, `status=${start.status}`)

  const pause = await api(`/project/tasks/${task1Id}/pause`, { method: 'POST', token: empA.token, body: { reason: 'Waiting on input' } })
  check('Pause task (pausedAt set)', pause.status === 200 && !!pause.data?.pausedAt, `status=${pause.status}`)

  const doublePause = await api(`/project/tasks/${task1Id}/pause`, { method: 'POST', token: empA.token })
  check('Double pause rejected (409)', doublePause.status === 409, `status=${doublePause.status}`)

  const startWhilePaused = await api(`/project/tasks/${task1Id}/start`, { method: 'POST', token: empA.token })
  check('Start while paused rejected (409)', startWhilePaused.status === 409, `status=${startWhilePaused.status}`)

  await sleep(1200) // paused span must NOT count toward the duration

  const resume = await api(`/project/tasks/${task1Id}/resume`, { method: 'POST', token: empA.token })
  check('Resume task (pausedAt cleared)', resume.status === 200 && !resume.data?.pausedAt && resume.data?.pauseIntervals?.length === 1, `status=${resume.status}`)

  const resumeAgain = await api(`/project/tasks/${task1Id}/resume`, { method: 'POST', token: empA.token })
  check('Double resume rejected (409)', resumeAgain.status === 409, `status=${resumeAgain.status}`)

  await sleep(600) // active span ~0.6s

  const submit = await api(`/project/tasks/${task1Id}/submit`, { method: 'POST', token: empA.token, body: { comment: 'E2E timer work complete' } })
  const dur = submit.data?.durationSec
  check('Submit task (Submitted)', submit.status === 200 && submit.data?.submissionStatus === 'Submitted', `status=${submit.status}`)
  check('Duration excludes paused time (~1s, not ~2s wall)', typeof dur === 'number' && dur >= 0 && dur <= 1, `durationSec=${dur}`)
  check('Open pause closed on submit (pausedAt null)', submit.data?.pausedAt == null && submit.data?.completedAt != null)

  // --- Self-approval ---
  const wrongApprove = await api(`/project/tasks/${task1Id}/review/approve`, { method: 'PATCH', token: empB.token, body: { comment: 'not mine to approve' } })
  check('Other employee cannot approve (403)', wrongApprove.status === 403, `status=${wrongApprove.status}`)

  const selfApprove = await api(`/project/tasks/${task1Id}/review/approve`, { method: 'PATCH', token: empA.token, body: { comment: 'Approved by assignee' } })
  check('Assignee self-approval allowed (200)', selfApprove.status === 200 && selfApprove.data?.submissionStatus === 'Approved', `status=${selfApprove.status}`)
  check('Approved task marked Done', selfApprove.data?.status === 'Done' && selfApprove.data?.progress === 100)

  const startAfterDone = await api(`/project/tasks/${task1Id}/start`, { method: 'POST', token: empA.token })
  check('Cannot start a completed task (409)', startAfterDone.status === 409, `status=${startAfterDone.status}`)

  // --- Task attachments ---
  const fd = new FormData()
  fd.append('file', new Blob(['task file content'], { type: 'text/plain' }), 'e2e-task-note.txt')
  const att = await fetch(`${API}/project/tasks/${task1Id}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empA.token}` },
    body: fd,
  })
  const attBody = await att.json()
  check('Assignee can attach file (201)', att.status === 201 && attBody?.fileId && attBody?.url?.includes('/uploads/'), attBody?.name)

  const fd2 = new FormData()
  fd2.append('file', new Blob(['x'], { type: 'text/plain' }), 'e2e-other.txt')
  const attWrong = await fetch(`${API}/project/tasks/${task1Id}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${empB.token}` },
    body: fd2,
  })
  check('Non-assignee cannot attach (403)', attWrong.status === 403, `status=${attWrong.status}`)

  const tasksList = await api(`/project/tasks?project=${projectId}`, { token: admin.token })
  const withAtt = (tasksList.data || []).find((t) => t.id === task1Id)
  check('Task row exposes attachments', !!withAtt && (withAtt.attachments || []).length >= 1, `count=${withAtt?.attachments?.length}`)

  // --- Task history payload ---
  const hist = await api('/project/tasks/history?mine=true', { token: empA.token })
  const hrow = (hist.data || []).find((t) => t.id === task1Id)
  check('History lists the task for the assignee', !!hrow)
  check('History exposes pausedSec', !!hrow && typeof hrow.pausedSec === 'number' && hrow.pausedSec >= 1, `pausedSec=${hrow?.pausedSec}`)
  const events = (hrow?.timeline || []).map((e) => e.event)
  check('Timeline has Paused + Resumed events', events.includes('Paused') && events.includes('Resumed'), events.join(','))

  // --- Cleanup ---
  const attFile = await ProjectFile.findOne({ name: 'e2e-task-note.txt' }).lean()
  const del1 = await api(`/project/tasks/${task1Id}`, { method: 'DELETE', token: admin.token })
  const del2 = await api(`/project/tasks/${task2Id}`, { method: 'DELETE', token: admin.token })
  const delP = await api(`/project/${projectId}`, { method: 'DELETE', token: admin.token })
  if (attFile) {
    const disk = String(attFile.url || '').replace(/^\/uploads\//, '')
    const abs = path.resolve(process.cwd(), 'uploads', disk)
    if (disk && !/[/\\]/.test(disk) && abs.startsWith(path.resolve(process.cwd(), 'uploads'))) {
      try { fs.unlinkSync(abs) } catch {}
    }
  }
  await ProjectFile.deleteOne({ name: 'e2e-task-note.txt' })
  await ProjectActivity.deleteMany({ project: projectId })
  await Notification.deleteMany({ sender: { $in: ['TT E2E Admin', 'TT E2E Emp A'] } })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  console.log(`cleanup: tasks ${del1.status}/${del2.status}, project ${delP.status}, temp users removed`)

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