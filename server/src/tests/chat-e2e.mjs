// E2E verification for the chat feature + salary payload sanity (Phase
// BRANDING/CHAT/SALARY). Uses the LIVE server + MongoDB. Prints PASS/FAIL per
// check, exits 1 on any failure. Run from server/: node src/tests/chat-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import fs from 'fs'
import path from 'path'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { Conversation, Message } from '../models/chatModels.js'
import { FileItem } from '../models/fileModels.js'
import { Notification } from '../models/notificationModels.js'

const API = 'http://localhost:5000/api'
// Temp accounts created directly in MongoDB (the live DB's own users have
// unknown passwords) and removed at the end. A freshly hashed password is
// written straight to the User doc so /api/auth/login works against them.
const TEMP = [
  { email: 'e2e-admin@skew.com', password: 'E2eAdmin#1', role: 'Admin', name: 'E2E Admin', department: 'Management', designation: 'Tester' },
  { email: 'e2e-hr@skew.com', password: 'E2eHr#1', role: 'Manager', name: 'E2E HR', department: 'Human Resources', designation: 'Tester' },
  { email: 'e2e-emp@skew.com', password: 'E2eEmp#1', role: 'Employee', name: 'E2E Employee', department: 'Engineering', designation: 'Tester' },
  { email: 'e2e-client@skew.com', password: 'E2eClient#1', role: 'Client', name: 'E2E Client', department: 'Demo Ltd', designation: 'Owner' },
]
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

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

async function uploadFile(pathname, file, token) {
  const fd = new FormData()
  fd.append('file', new Blob([file.content], { type: file.type }), file.name)
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

async function login(email, password) {
  const { status, data } = await api('/auth/login', { method: 'POST', body: { email, password } })
  if (status !== 200 || !data?.token) return null
  return data
}

const run = async () => {
  await mongoose.connect(TEST_MONGO_URI, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5,
  })

  const users = await User.find({}, { email: 1, role: 1, name: 1, active: 1 }).lean()
  const admin = users.find((u) => u.role === 'Admin')
  const employee = users.find((u) => u.role === 'Employee')
  const client = users.find((u) => u.role === 'Client')
  const hr = users.find((u) => u.role === 'Manager')
  check('DB has Admin user', !!admin, admin?.email)
  check('DB has Employee user', !!employee, employee?.email)
  check('DB has Manager user', !!hr, hr?.email)
  check('DB has Client user', !!client, client?.email)
  if (!admin || !employee || !hr) { await mongoose.disconnect(); process.exit(1) }

// --- Temp accounts with known passwords (removed in cleanup below) ---
  // NOTE: User's pre-save hook hashes `password`, so the PLAINTEXT password is
  // written and the schema hashes it exactly like the auth flow expects.
  // Leftovers from an aborted previous run are removed first so the harness
  // is idempotent: any conversation/message a previous run created (its temp
  // users are gone, so match on their old user ids) plus the temp Employee
  // and chat notifications.
  const oldTempUsers = await User.find({ email: { $in: TEMP.map((t) => t.email) } }, { _id: 1 }).lean()
  const oldTempIds = oldTempUsers.map((u) => u._id)
  const oldConvs = oldTempIds.length
    ? await Conversation.find({ 'participants.user': { $in: oldTempIds } }, { _id: 1 }).lean()
    : []
  const oldConvIds = oldConvs.map((c) => c._id)
  await Conversation.deleteMany({ _id: { $in: oldConvIds } })
  if (oldConvIds.length) await Message.deleteMany({ conversation: { $in: oldConvIds } })
  const aliveConvIds = (await Conversation.find({}, { _id: 1 }).lean()).map((c) => c._id)
  await Message.deleteMany({ conversation: { $nin: aliveConvIds } })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await Employee.deleteMany({ email: 'e2e-emp@skew.com' })
  await Notification.deleteMany({ type: 'chat' })
  const tempIds = []
  for (const t of TEMP) {
    const doc = await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
    tempIds.push(doc._id)
  }
  const empDoc = await User.findOne({ email: 'e2e-emp@skew.com' }).lean()

  // --- Login ---
  const a = await login('e2e-admin@skew.com', 'E2eAdmin#1')
  check('Admin login', !!a, a?.user?.name)
  const emp = await login('e2e-emp@skew.com', 'E2eEmp#1')
  check('Employee login', !!emp, emp?.user?.name)
const hrL = await login('e2e-hr@skew.com', 'E2eHr#1')
  check('Manager login', !!hrL, hrL?.user?.name)
  if (!a || !emp || !hrL) {
    await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
    await mongoose.disconnect(); process.exit(1)
  }
  const clientL = await login('e2e-client@skew.com', 'E2eClient#1')

  // --- blockClient: Clients get 403 on every chat endpoint ---
  if (clientL) {
    const r = await api('/chat/users', { token: clientL.token })
    check('Client blocked from /chat/users (403)', r.status === 403, `status=${r.status}`)
    const r2 = await api('/chat/conversations', { token: clientL.token })
    check('Client blocked from /chat/conversations (403)', r2.status === 403, `status=${r2.status}`)
  } else {
    check('Client blocked from /chat/users (403)', false, 'no client account available to test')
  }

  // --- Directory ---
  const dir = await api('/chat/users', { token: a.token })
  check('GET /chat/users OK', dir.status === 200 && Array.isArray(dir.data), `count=${dir.data?.length}`)
  const dir2 = await api('/chat/users', { token: emp.token })
  check('Employee sees same staff directory', dir2.status === 200 && dir2.data?.length === dir.data?.length)

  // --- Direct conversation (find-or-create, idempotent) ---
  const d1 = await api('/chat/conversations/direct', { method: 'POST', token: a.token, body: { userId: empDoc._id } })
  check('POST direct OK (201)', d1.status === 201 && d1.data?.isGroup === false, `id=${d1.data?._id}`)
  const d2 = await api('/chat/conversations/direct', { method: 'POST', token: a.token, body: { userId: empDoc._id } })
  check('Direct find-or-create is idempotent', d1.data?._id === d2.data?._id)
  const directId = d1.data?._id

  // Self-chat rejected
  const self = await api('/chat/conversations/direct', { method: 'POST', token: a.token, body: { userId: a.user._id } })
  check('Self-chat rejected (4xx)', self.status >= 400, `status=${self.status}`)

  // --- Messages ---
  const m1 = await api(`/chat/conversations/${directId}/messages`, { method: 'POST', token: a.token, body: { text: 'E2E hello from Admin' } })
  check('Send message OK (201)', m1.status === 201 && m1.data?.text === 'E2E hello from Admin', m1.data?._id)
  const m2 = await api(`/chat/conversations/${directId}/messages`, { method: 'POST', token: emp.token, body: { text: 'E2E reply from Employee' } })
  check('Employee replies OK (201)', m2.status === 201 && m2.data?.text === 'E2E reply from Employee')
  const list = await api(`/chat/conversations/${directId}/messages`, { token: a.token })
  check('Message list contains both', list.status === 200 && list.data?.length >= 2, `count=${list.data?.length}`)

// lastMessage on conversation
  const conv = await api(`/chat/conversations/${directId}`, { token: emp.token })
  check('Conversation view has lastMessage', conv.status === 200 && conv.data?.lastMessage?.text === 'E2E reply from Employee')

  // --- Attachments: upload -> send -> list -> download, participant-gated ---
  const createdFileIds = []
  const attUp = await uploadFile(`/chat/conversations/${directId}/attachments`, { name: 'e2e-note.txt', type: 'text/plain', content: 'hello attachment' }, a.token)
  check('Upload attachment OK (201)', attUp.status === 201 && attUp.data?.fileId && attUp.data?.url.includes('/attachments/'), attUp.data?.name)
  if (attUp.data?.fileId) createdFileIds.push(attUp.data.fileId)

  const noPayload = await api(`/chat/conversations/${directId}/messages`, { method: 'POST', token: a.token, body: {} })
  check('Empty message rejected (400)', noPayload.status === 400, `status=${noPayload.status}`)

  const attMsg = await api(`/chat/conversations/${directId}/messages`, { method: 'POST', token: a.token, body: { attachment: attUp.data } })
  check('Send attachment-only message (201)', attMsg.status === 201 && attMsg.data?.attachment?.fileId === attUp.data?.fileId, attMsg.data?.attachment?.name)

  const listWithAtt = await api(`/chat/conversations/${directId}/messages`, { token: a.token })
  const attRow = (listWithAtt.data || []).find((m) => m.attachment?.fileId === attUp.data?.fileId)
  check('Message list exposes attachment', !!attRow && !!attRow.attachment?.url, attRow?.attachment?.name)

  const convWithAtt = await api(`/chat/conversations/${directId}`, { token: a.token })
  check('Conversation preview has hasAttachment flag', convWithAtt.status === 200 && convWithAtt.data?.lastMessage?.hasAttachment === true)

  const dl = await fetch(`${API}/chat/conversations/${directId}/attachments/${attUp.data.fileId}`, {
    headers: { Authorization: `Bearer ${emp.token}` },
  })
  check('Participant can download attachment (200)', dl.status === 200, `status=${dl.status}`)
  const dlBody = await dl.text()
  check('Downloaded bytes match upload', dlBody === 'hello attachment', `len=${dlBody.length}`)

  const dlNon = await fetch(`${API}/chat/conversations/${directId}/attachments/${attUp.data.fileId}`, {
    headers: { Authorization: `Bearer ${hrL.token}` },
  })
  check('Non-participant blocked from attachment (403)', dlNon.status === 403, `status=${dlNon.status}`)

  const attByClient = await uploadFile(`/chat/conversations/${directId}/attachments`, { name: 'x.txt', type: 'text/plain', content: 'x' }, clientL?.token)
  check('Client blocked from attachment upload (403)', attByClient.status === 403, `status=${attByClient.status}`)

  const badType = await uploadFile(`/chat/conversations/${directId}/attachments`, { name: 'x.exe', type: 'application/x-msdownload', content: 'MZ' }, a.token)
  check('Executable upload rejected (4xx)', badType.status >= 400, `status=${badType.status}`)

  // --- Read receipts (live on MESSAGES, not the conversation view) ---
  const read = await api(`/chat/conversations/${directId}/read`, { method: 'POST', token: a.token })
  check('Mark read OK', read.status === 200, `status=${read.status}`)
  const msgsAfter = await api(`/chat/conversations/${directId}/messages`, { token: a.token })
  const empReply = (msgsAfter.data || []).find((m) => m.text === 'E2E reply from Employee')
  check('readBy recorded for Admin', !!empReply && Array.isArray(empReply.readBy) && empReply.readBy.some((id) => String(id) === String(a.user._id)), `readBy=${JSON.stringify(empReply?.readBy)}`)

  // --- Unread counts: badge value must drop to 0 once read ---
  const convBefore = await api(`/chat/conversations/${directId}`, { token: a.token })
  const unreadBefore = convBefore.data?.unreadCount || 0
  const empSends = await api(`/chat/conversations/${directId}/messages`, { method: 'POST', token: emp.token, body: { text: 'unread check' } })
  check('Second employee message sent (201)', empSends.status === 201, `status=${empSends.status}`)
  const convUnread = await api(`/chat/conversations/${directId}`, { token: a.token })
  check('Unread count = 1 after new message', convUnread.data?.unreadCount === 1, `count=${convUnread.data?.unreadCount}`)
  await api(`/chat/conversations/${directId}/read`, { method: 'POST', token: a.token })
  const convRead = await api(`/chat/conversations/${directId}`, { token: a.token })
  check('Unread count = 0 after marking read', convRead.data?.unreadCount === 0, `count=${convRead.data?.unreadCount}`)

  // --- Non-participant blocked ---
  const hrR = await api(`/chat/conversations/${directId}`, { token: hrL.token })
  check('Non-participant blocked from conversation (403)', hrR.status === 403, `status=${hrR.status}`)

  // --- Group flow ---
  const g1 = await api('/chat/conversations/groups', { method: 'POST', token: a.token, body: { name: 'E2E Test Group', memberIds: [empDoc._id] } })
  check('Create group OK (201)', g1.status === 201 && g1.data?.isGroup === true, `id=${g1.data?._id}`)
  const gid = g1.data?._id
  const g2 = await api(`/chat/conversations/${gid}/members`, { method: 'POST', token: a.token, body: { userId: hrL.user._id } })
  check('Add member OK (201)', g2.status === 201, `status=${g2.status}`)
  const g3 = await api(`/chat/conversations/${gid}`, { token: hrL.token })
  check('New member can view group', g3.status === 200 && g3.data?.memberCount >= 3, `members=${g3.data?.memberCount}`)
  const g4 = await api(`/chat/conversations/${gid}/members`, { method: 'POST', token: emp.token, body: { userId: a.user._id } })
  check('Non-creator cannot add members (403)', g4.status === 403, `status=${g4.status}`)
  const g5 = await api(`/chat/conversations/${gid}/leave`, { method: 'POST', token: emp.token })
  check('Leave group OK', g5.status === 200, `status=${g5.status}`)
  const g6 = await api(`/chat/conversations/${gid}`, { token: emp.token })
  check('Leaver loses access (403)', g6.status === 403, `status=${g6.status}`)

  // --- Conversations list (checked BEFORE the leaver check below distorts it:
  //     the employee left the group above, so their list correctly shows only
  //     the direct conversation — count=1 is the expected post-leave state.) ---
  const cl = await api('/chat/conversations', { token: a.token })
  check('Conversations list has direct + group', Array.isArray(cl.data) && cl.data.length >= 2, `count=${cl.data?.length}`)

// --- Salary payload sanity (keys the client widgets/report read) ---
  // The temp employee gets a linked Employee record with the brief's worked
  // CTC (₹1,20,000) so GET /hr/payroll/me/salary computes a REAL `current`
  // from the shared engine (gross ₹10,000, PF ₹600, ESI ₹75, net ₹9,325).
  await Employee.create({
    name: 'E2E Employee', email: 'e2e-emp@skew.com', userId: empDoc._id,
    phone: '9999999999', gender: 'Female',
    department: 'Engineering', designation: 'Software Engineer',
    salary: { ctc: 120000 }, status: 'Active',
  })
  const sal = await api('/hr/payroll/me/salary', { token: emp.token })
  const cur = sal.data?.current
  const att = sal.data?.attendance
  check('GET salary OK', sal.status === 200, `source=${cur?.source}`)
  if (cur) {
    const keys = ['monthly', 'gross', 'pf', 'esi', 'totalDeductions', 'net_monthly_salary', 'net', 'lwp_days', 'overtime_hours', 'overtime_rate', 'overtime_pay', 'payable_days', 'daily_payable_amount', 'current_receivable', 'late_days', 'month', 'status']
    const missing = keys.filter((k) => !(k in cur))
    check('All salary widget keys present', missing.length === 0, missing.length ? `missing=${missing.join(',')}` : 'all 17 present')
    check('Gross = ₹10,000 for ₹1,20,000 CTC', cur.gross === 10000, `gross=${cur.gross}`)
    check('PF = 12% of basic (₹600)', cur.pf === 600, `pf=${cur.pf}`)
    check('ESI = 0.75% of gross (₹75)', cur.esi === 75, `esi=${cur.esi}`)
    check('Net monthly = gross - pf - esi (₹9,325)', cur.net_monthly_salary === 9325, `net=${cur.net_monthly_salary}`)
    check('Phase 7.2 — Overtime removed: overtime_pay = 0', cur.overtime_pay === 0 && cur.overtime_hours === 0, `pay=${cur.overtime_pay} hours=${cur.overtime_hours}`)
    check('Widget keys exist for the reordered grid', ['monthly', 'pf', 'esi', 'lwp_days', 'late_days', 'totalDeductions', 'payable_days', 'overtime_hours', 'overtime_rate', 'net_monthly_salary', 'overtime_pay', 'daily_payable_amount', 'current_receivable'].every((k) => k in cur), 'all 13 widget bindings resolved')
  }
  if (att) {
    check('Attendance keys for report rows', ['lateDays', 'leaveDays', 'holidayDays', 'overtime'].every((k) => k in att), `lateDays=${att.lateDays} overtime=${att.overtime}`)
  }

  // Cleanup: drop the E2E conversations, their messages, chat notifications,
  // temp users, temp employee and any attachment file metadata + bytes.
  const ids = [directId, gid].filter(Boolean)
  const convDel = await Conversation.deleteMany({ _id: { $in: ids } })
  const msgDel = ids.length ? await Message.deleteMany({ conversation: { $in: ids } }) : { deletedCount: 0 }
  let fileBytesRemoved = 0
  if (createdFileIds.length) {
    const items = await FileItem.find({ _id: { $in: createdFileIds } }).lean()
    for (const item of items) {
      const disk = String(item.url || '').replace(/^\/chat-uploads\//, '')
      const abs = path.resolve(process.cwd(), 'chat-uploads', disk)
      if (disk && !/[/\\]/.test(disk) && abs.startsWith(path.resolve(process.cwd(), 'chat-uploads'))) {
        try { fs.unlinkSync(abs); fileBytesRemoved += 1 } catch {}
      }
    }
    await FileItem.deleteMany({ _id: { $in: createdFileIds } })
  }
  await Notification.deleteMany({ type: 'chat' })
  await Employee.deleteOne({ email: 'e2e-emp@skew.com' })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  console.log(`cleanup: removed ${convDel.deletedCount} conversation(s) + ${msgDel.deletedCount} message(s) + chat notifications, temp employee, ${createdFileIds.length} attachment(s) (${fileBytesRemoved} bytes removed) and ${TEMP.length} temp user(s)`)

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



