// PHASE: CHAT ATTACHMENT PRIVACY — chat attachments must NEVER surface in the
// general Files module, and their bytes are only reachable through the
// participant-checked /chat route.
//
// Uses the LIVE server + MongoDB (run from server/ with the server + Mongo up):
//   node src/tests/chat-attachment-privacy-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Conversation, Message } from '../models/chatModels.js'
import { FileItem } from '../models/fileModels.js'

const API = 'http://localhost:5000/api'
const TEMP = [
  { email: 'priv-a@skew.com', password: 'PrivA#1', role: 'Employee', name: 'Priv A', department: 'Engineering', designation: 'Tester' },
  { email: 'priv-b@skew.com', password: 'PrivB#1', role: 'Employee', name: 'Priv B', department: 'Engineering', designation: 'Tester' },
  { email: 'priv-c@skew.com', password: 'PrivC#1', role: 'Employee', name: 'Priv C', department: 'Engineering', designation: 'Tester' },
  { email: 'priv-mgr@skew.com', password: 'PrivMgr#1', role: 'Manager', name: 'Priv Manager', department: 'Management', designation: 'Tester' },
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

async function uploadFile(pathname, file, token, field = 'file') {
  const fd = new FormData()
  fd.append(field, new Blob([file.content], { type: file.type }), file.name)
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
  return status === 200 && data?.token ? data : null
}

const run = async () => {
  await mongoose.connect(TEST_MONGO_URI, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5,
  })

  // Idempotent cleanup of any previous run, then fresh temp users.
  const oldIds = (await User.find({ email: { $in: TEMP.map((t) => t.email) } }, { _id: 1 }).lean()).map((u) => u._id)
  const oldConvs = oldIds.length
    ? await Conversation.find({ 'participants.user': { $in: oldIds } }, { _id: 1 }).lean()
    : []
  await Message.deleteMany({ conversation: { $in: oldConvs.map((c) => c._id) } })
  await Conversation.deleteMany({ _id: { $in: oldConvs.map((c) => c._id) } })
  await FileItem.deleteMany({ owner: { $in: TEMP.map((t) => t.email) } })
  await FileItem.deleteMany({ name: { $in: ['priv-chat-note.txt', 'priv-general-note.txt', 'priv-legacy-chat.txt'] } })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })

  const ids = {}
  for (const t of TEMP) {
    const doc = await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
    ids[t.email] = doc._id
  }

  const a = await login('priv-a@skew.com', 'PrivA#1')
  const b = await login('priv-b@skew.com', 'PrivB#1')
  const c = await login('priv-c@skew.com', 'PrivC#1')
  const mgr = await login('priv-mgr@skew.com', 'PrivMgr#1')
  check('All temp users log in', !!(a && b && c && mgr), [a, b, c, mgr].map((u) => u?.user?.email).join(','))
  if (!a || !b || !c || !mgr) {
    await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
    await mongoose.disconnect(); process.exit(1)
  }

  // Conversation A<->B; attach a chat file and send it as a message.
  const d1 = await api('/chat/conversations/direct', { method: 'POST', token: a.token, body: { userId: ids['priv-b@skew.com'] } })
  check('Direct A<->B created', d1.status === 201 && d1.data?._id, d1.data?._id)
  const convAB = d1.data?._id

  const attUp = await uploadFile(`/chat/conversations/${convAB}/attachments`, { name: 'priv-chat-note.txt', type: 'text/plain', content: 'chat-secret-bytes' }, a.token)
  check('Chat attachment upload OK (201)', attUp.status === 201 && attUp.data?.fileId, attUp.data?.fileId)
  const chatFileId = attUp.data?.fileId

  const attMsg = await api(`/chat/conversations/${convAB}/messages`, { method: 'POST', token: a.token, body: { attachment: attUp.data } })
  check('Attachment bound to a message', attMsg.status === 201 && attMsg.data?.attachment?.fileId === chatFileId, `status=${attMsg.status}`)

  // Test 1: both participants can download through the chat route (200).
  const dlA = await fetch(`${API}/chat/conversations/${convAB}/attachments/${chatFileId}`, { headers: { Authorization: `Bearer ${a.token}` } })
  const dlB = await fetch(`${API}/chat/conversations/${convAB}/attachments/${chatFileId}`, { headers: { Authorization: `Bearer ${b.token}` } })
  check('Test 1: Participant A can download chat attachment (200)', dlA.status === 200, `status=${dlA.status}`)
  check('Test 1: Participant B can download chat attachment (200)', dlB.status === 200, `status=${dlB.status}`)
  check('Test 1: Downloaded bytes match upload', (await dlA.text()) === 'chat-secret-bytes')

  // Test 2: outsider (C) and manager (not in conversation) get 403.
  const dlC = await fetch(`${API}/chat/conversations/${convAB}/attachments/${chatFileId}`, { headers: { Authorization: `Bearer ${c.token}` } })
  check('Test 2: Outsider C blocked from chat attachment (403)', dlC.status === 403, `status=${dlC.status}`)
  const dlMgr = await fetch(`${API}/chat/conversations/${convAB}/attachments/${chatFileId}`, { headers: { Authorization: `Bearer ${mgr.token}` } })
  check('Test 2: Manager (non-member) blocked from chat attachment (403)', dlMgr.status === 403, `status=${dlMgr.status}`)

  // Test 3: the chat file is NOT in the general Files listing, storage or trash.
  const filesList = await api('/files', { token: a.token })
  const inList = (filesList.data?.files || []).some((f) => String(f._id) === String(chatFileId))
  check('Test 3: chat attachment absent from Files listing', filesList.status === 200 && !inList, `files=${filesList.data?.files?.length}`)
  const storage = await api('/files/storage', { token: a.token })
  check('Test 3: storage endpoint responds', storage.status === 200 && typeof storage.data?.count === 'number', `count=${storage.data?.count}`)
  const trash = await api('/files/trash', { token: a.token })
  check('Test 3: chat attachment absent from Files trash', trash.status === 200 && !(trash.data?.files || []).some((f) => String(f._id) === String(chatFileId)))

  // Test 4: a NORMAL Files upload still appears in the listing (regression).
  const normUp = await uploadFile('/files/upload', { name: 'priv-general-note.txt', type: 'text/plain', content: 'general-file-bytes' }, a.token)
  check('Test 4: normal Files upload OK', normUp.status === 201 && normUp.data?._id, `status=${normUp.status}`)
  const normId = normUp.data?._id
  const filesList2 = await api('/files', { token: a.token })
  check('Test 4: normal upload present in Files listing', filesList2.status === 200 && (filesList2.data?.files || []).some((f) => String(f._id) === String(normId)))
  const normDl = await fetch(`${API}/files/${normId}/download`, { headers: { Authorization: `Bearer ${a.token}` } })
  check('Test 4: normal upload downloadable via /files', normDl.status === 200, `status=${normDl.status}`)

  // Test 5: the chat file is unreachable through the Files routes (404 guards).
  const viaMeta = await api(`/files/${chatFileId}`, { token: a.token })
  check('Test 5: GET /files/:chatId -> 404', viaMeta.status === 404, `status=${viaMeta.status}`)
  const viaDl = await fetch(`${API}/files/${chatFileId}/download`, { headers: { Authorization: `Bearer ${a.token}` } })
  check('Test 5: GET /files/:chatId/download -> 404', viaDl.status === 404, `status=${viaDl.status}`)
  const viaRaw = await fetch(`${API}/files/${chatFileId}/raw`, { headers: { Authorization: `Bearer ${a.token}` } })
  check('Test 5: GET /files/:chatId/raw -> 404', viaRaw.status === 404, `status=${viaRaw.status}`)
  const viaDel = await api(`/files/${chatFileId}`, { method: 'DELETE', token: a.token })
  check('Test 5: DELETE /files/:chatId -> 404', viaDel.status === 404, `status=${viaDel.status}`)
  const viaBulk = await api('/files/bulk-delete', { method: 'POST', token: a.token, body: { ids: [chatFileId] } })
  check('Test 5: bulk-delete chat id not moved', viaBulk.status === 200 && viaBulk.data?.movedCount === 0 && viaBulk.data?.failedCount === 1, JSON.stringify(viaBulk.data))

  // Test 6: cross-conversation fileId guessing is rejected (404).
  const d2 = await api('/chat/conversations/direct', { method: 'POST', token: a.token, body: { userId: ids['priv-c@skew.com'] } })
  const convAC = d2.data?._id
  const dlCross = await fetch(`${API}/chat/conversations/${convAC}/attachments/${chatFileId}`, { headers: { Authorization: `Bearer ${a.token}` } })
  check('Test 6: attachment not reusable in another conversation (404)', dlCross.status === 404, `status=${dlCross.status}`)

  // Test 7: the migration backfills legacy chat FileItems (no source field)
  // so they too are excluded from Files — same updateMany the migration runs.
  const legacy = await FileItem.create({
    name: 'priv-legacy-chat.txt', originalName: 'priv-legacy-chat.txt',
    type: 'other', url: `/chat-uploads/legacy-${Date.now()}.txt`, size: 5, owner: 'priv-a@skew.com',
    permission: 'private', isTrashed: false,
  })
  const beforeList = await api('/files', { token: a.token })
  check('Test 7: legacy chat file (unmigrated) still listed in Files', (beforeList.data?.files || []).some((f) => String(f._id) === String(legacy._id)))
  const mig = await FileItem.updateMany(
    { url: { $regex: '^/chat-uploads/' }, source: { $ne: 'chat' } },
    { $set: { source: 'chat' } }
  )
  check('Test 7: migration matched the legacy chat file', mig.modifiedCount >= 1, `modified=${mig.modifiedCount}`)
  const afterList = await api('/files', { token: a.token })
  check('Test 7: legacy chat file excluded from Files after migration', !(afterList.data?.files || []).some((f) => String(f._id) === String(legacy._id)))

  // Cleanup temp artifacts (leave seeded data untouched).
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await Message.deleteMany({ conversation: { $in: [convAB, convAC].filter(Boolean) } })
  await Conversation.deleteMany({ _id: { $in: [convAB, convAC].filter(Boolean) } })
  await FileItem.deleteMany({ owner: { $in: TEMP.map((t) => t.email) } })
  await FileItem.deleteMany({ name: { $in: ['priv-chat-note.txt', 'priv-general-note.txt', 'priv-legacy-chat.txt'] } })
  await mongoose.disconnect()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

run().catch((err) => { console.error(err); process.exit(1) })