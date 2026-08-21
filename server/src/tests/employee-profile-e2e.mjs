// PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3) — the logged-in Employee may
// edit ONLY their own personal fields and manage their OWN private documents;
// Admin/Manager keep full employee management through the existing routes.
// MY PROFILE EDUCATION/BANK (CHANGES 1+5): Employees AND Managers may also
// maintain their own Education + Bank details through the same /me route;
// everything employment-related stays allowlisted/immutable for both.
//
// Uses the LIVE server + MongoDB (run from server/ with the server + Mongo up):
//   node src/tests/employee-profile-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { FileItem } from '../models/fileModels.js'

const API = 'https://skew-server-317n.onrender.com/api'
const TEMP = [
  { email: 'prof-e1@skew.com', password: 'ProfE1#1', role: 'Employee', name: 'Prof Employee One', department: 'Engineering', designation: 'Tester' },
  { email: 'prof-e2@skew.com', password: 'ProfE2#1', role: 'Employee', name: 'Prof Employee Two', department: 'Engineering', designation: 'Tester' },
  { email: 'prof-mgr@skew.com', password: 'ProfMgr#1', role: 'Manager', name: 'Prof Manager', department: 'Management', designation: 'Tester' },
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

async function uploadDoc(pathname, file, token) {
  const fd = new FormData()
  fd.append('document', new Blob([file.content], { type: file.type }), file.name)
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

  // Idempotent cleanup of previous runs.
  const oldIds = (await User.find({ email: { $in: TEMP.map((t) => t.email) } }, { _id: 1 }).lean()).map((u) => u._id)
  if (oldIds.length) await Employee.deleteMany({ userId: { $in: oldIds } })
  await Employee.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })

  const userIds = {}
  for (const t of TEMP) {
    const doc = await User.create({ email: t.email, password: t.password, role: t.role, name: t.name, department: t.department, designation: t.designation, active: true })
    userIds[t.email] = doc._id
  }

  // Linked Employee records (the /employees/me flow resolves the record from
  // the User link, exactly like a provisioned account).
  const e1 = await Employee.create({
    name: 'Prof Employee One', email: 'prof-e1@skew.com', userId: userIds['prof-e1@skew.com'],
    phone: '9000000001', department: 'Engineering', designation: 'Tester', status: 'Active',
    address: 'Old Address', dob: new Date('1995-01-01'), bloodGroup: 'A+', maritalStatus: 'Single',
  })
  const e2 = await Employee.create({
    name: 'Prof Employee Two', email: 'prof-e2@skew.com', userId: userIds['prof-e2@skew.com'],
    phone: '9000000002', department: 'Engineering', designation: 'Tester', status: 'Active',
  })
  // Manager self-service needs its own linked record, exactly like provisioned
  // accounts (getSelf resolves through the User link).
  const eMgr = await Employee.create({
    name: 'Prof Manager', email: 'prof-mgr@skew.com', userId: userIds['prof-mgr@skew.com'],
    phone: '9000000003', department: 'Management', designation: 'Tester', status: 'Active',
  })

  const e1L = await login('prof-e1@skew.com', 'ProfE1#1')
  const e2L = await login('prof-e2@skew.com', 'ProfE2#1')
  const mgrL = await login('prof-mgr@skew.com', 'ProfMgr#1')
  check('Temp logins OK', !!(e1L && e2L && mgrL))
  if (!e1L || !e2L || !mgrL) {
    await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
    await Employee.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
    await mongoose.disconnect(); process.exit(1)
  }

  // --- Self-edit ---
  const me = await api('/employees/me', { token: e1L.token })
  check('GET /employees/me returns own record', me.status === 200 && me.data?.email === 'prof-e1@skew.com', `empCode=${me.data?.empCode}`)

  const upd = await api('/employees/me', {
    method: 'PUT', token: e1L.token,
    body: {
      phone: '9000000111', address: 'New Home Address', dob: '1994-05-05',
      bloodGroup: 'B+', maritalStatus: 'Married',
      emergencyContacts: [{ name: 'Kin One', relation: 'Spouse', phone: '9111111111' }],
      education: [
        { qualification: 'B.E.', institution: 'Anna University', fieldOfStudy: 'CSE', startYear: '2015', endYear: '2019', grade: '8.5' },
      ],
      bank: { name: 'HDFC Bank', account: '50100200300', ifsc: 'HDFC0001234' },
    },
  })
  check('PUT /employees/me updates personal fields', upd.status === 200
    && upd.data?.phone === '9000000111'
    && upd.data?.address === 'New Home Address'
    && upd.data?.bloodGroup === 'B+'
    && upd.data?.maritalStatus === 'Married'
    && Array.isArray(upd.data?.emergencyContacts) && upd.data?.emergencyContacts[0]?.name === 'Kin One',
    `status=${upd.status}`)
  check('Self-edit persists education', upd.status === 200
    && Array.isArray(upd.data?.education) && upd.data?.education[0]?.qualification === 'B.E.'
    && upd.data?.education[0]?.institution === 'Anna University')
  check('Self-edit persists bank details', upd.status === 200
    && upd.data?.bank?.name === 'HDFC Bank'
    && upd.data?.bank?.account === '50100200300'
    && upd.data?.bank?.ifsc === 'HDFC0001234')
  check('Self-edit mirrors phone onto linked User', (await User.findById(userIds['prof-e1@skew.com']).lean())?.phone === '9000000111')

  // Protected fields are ignored (allowlist), even when smuggled in. `bank` is
  // NOT in the smuggled set any more: Education + Bank are now legitimate
  // self-editable fields (Employee AND Manager), so a smuggled bank object is
  // expected to be SAVED, not dropped.
  const smuggled = await api('/employees/me', {
    method: 'PUT', token: e1L.token,
    body: {
      department: 'Hacked Dept', designation: 'Hacked Role', status: 'Inactive',
      role: 'Manager', empCode: 'ZZZ999', salary: { ctc: 99999999 },
    },
  })
  const afterSmuggle = await api('/employees/me', { token: e1L.token })
  check('Protected fields cannot be smuggled via self-edit', afterSmuggle.data?.department === 'Engineering'
    && afterSmuggle.data?.designation === 'Tester'
    && afterSmuggle.data?.status === 'Active'
    && afterSmuggle.data?.empCode !== 'ZZZ999',
    JSON.stringify({ department: afterSmuggle.data?.department, status: afterSmuggle.data?.status }))

  // Education rows missing required fields are dropped rather than saved.
  const badEdu = await api('/employees/me', {
    method: 'PUT', token: e1L.token,
    body: { education: [{ qualification: 'B.Sc.', institution: 'Loyola', grade: 'A' }, { institution: 'No Qualification' }] },
  })
  check('Education rows without qualification are dropped', badEdu.status === 200
    && Array.isArray(badEdu.data?.education) && badEdu.data?.education.length === 1
    && badEdu.data?.education[0]?.qualification === 'B.Sc.')

  // Employee cannot edit ANOTHER employee (the existing canWrite gate).
  const crossEdit = await api(`/employees/${String(e2._id)}`, {
    method: 'PUT', token: e1L.token, body: { phone: '9999999999' },
  })
  check('Employee blocked from editing another employee (403)', crossEdit.status === 403, `status=${crossEdit.status}`)

  // Manager CAN edit any employee through the existing route (regression).
  const mgrEdit = await api(`/employees/${String(e2._id)}`, {
    method: 'PUT', token: mgrL.token, body: { department: 'Quality' },
  })
  check('Manager can still edit employees via /employees/:id', mgrEdit.status === 200 && mgrEdit.data?.department === 'Quality', `status=${mgrEdit.status}`)

  // Manager CAN self-edit through the same /me route (Education + Bank
  // self-service), and protected fields in the payload are still ignored.
  const mgrSelf = await api('/employees/me', {
    method: 'PUT', token: mgrL.token,
    body: {
      phone: '9000000555',
      education: [{ qualification: 'M.E.', institution: 'MIT', grade: '9' }],
      bank: { name: 'ICICI', account: '2020202', ifsc: 'ICIC0001' },
      department: 'Hacked Dept',
    },
  })
  check('Manager can self-edit profile via /employees/me PUT (200)', mgrSelf.status === 200, `status=${mgrSelf.status}`)
  const mgrMe = await api('/employees/me', { token: mgrL.token })
  check('Manager education/bank persisted, protected fields ignored', mgrMe.status === 200
    && mgrMe.data?.phone === '9000000555'
    && Array.isArray(mgrMe.data?.education) && mgrMe.data?.education[0]?.qualification === 'M.E.'
    && mgrMe.data?.bank?.name === 'ICICI'
    && mgrMe.data?.department === 'Management',
    JSON.stringify({ phone: mgrMe.data?.phone, department: mgrMe.data?.department }))

  // --- Private profile documents ---
  const docUp = await uploadDoc('/employees/me/documents', { name: 'id-proof.pdf', type: 'application/pdf', content: 'fake pdf bytes' }, e1L.token)
  check('Self document upload (201)', docUp.status === 201 && docUp.data?._id, `status=${docUp.status}`)
  const docId = docUp.data?._id
  check('Stored doc references the staff route', typeof docUp.data?.url === 'string' && docUp.data?.url.includes('/documents/'), docUp.data?.url)

  const docDl = await fetch(`${API}/employees/me/documents/${docId}`, { headers: { Authorization: `Bearer ${e1L.token}` } })
  check('Owner can download own private document (200)', docDl.status === 200, `status=${docDl.status}`)
  check('Downloaded bytes match upload', (await docDl.text()) === 'fake pdf bytes')

  const docDlMgr = await fetch(`${API}/employees/${String(e1._id)}/documents/${docId}`, { headers: { Authorization: `Bearer ${mgrL.token}` } })
  check('Manager can download employee private document (200)', docDlMgr.status === 200, `status=${docDlMgr.status}`)

  const docDlOtherEmp = await fetch(`${API}/employees/me/documents/${docId}`, { headers: { Authorization: `Bearer ${e2L.token}` } })
  check('Other employee cannot download someone else\'s document (404)', docDlOtherEmp.status === 404, `status=${docDlOtherEmp.status}`)

  const docDlStaffRoute = await fetch(`${API}/employees/${String(e2._id)}/documents/${docId}`, { headers: { Authorization: `Bearer ${e2L.token}` } })
  check('Employee blocked from staff document route (403)', docDlStaffRoute.status === 403, `status=${docDlStaffRoute.status}`)

  const docDlWrongEmp = await fetch(`${API}/employees/${String(e2._id)}/documents/${docId}`, { headers: { Authorization: `Bearer ${mgrL.token}` } })
  check('Manager cannot open doc from the WRONG employee record (404)', docDlWrongEmp.status === 404, `status=${docDlWrongEmp.status}`)

  const docDel = await api(`/employees/me/documents/${docId}`, { method: 'DELETE', token: e1L.token })
  check('Owner can delete own document', docDel.status === 200 && docDel.data?.deleted === true, `status=${docDel.status}`)
  const docGone = await fetch(`${API}/employees/me/documents/${docId}`, { headers: { Authorization: `Bearer ${e1L.token}` } })
  check('Deleted document is gone (404)', docGone.status === 404, `status=${docGone.status}`)

  // Legacy admin flow still works (public /uploads document, HR-managed).
  const legacyUp = await uploadDoc(`/employees/${String(e1._id)}/documents`, { name: 'hr-offer.pdf', type: 'application/pdf', content: 'hr bytes' }, mgrL.token)
  check('Manager legacy document upload still works (201)', legacyUp.status === 201 && legacyUp.data?.url?.startsWith('/uploads/'), legacyUp.data?.url)

  // The self-uploaded document never became a FileItem (it is not part of the
  // general Files module at all).
  const chatless = await FileItem.countDocuments({ name: 'id-proof.pdf' })
  check('Private profile docs never create FileItems', chatless === 0, `count=${chatless}`)

  // --- Cleanup ---
  await Employee.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await User.deleteMany({ email: { $in: TEMP.map((t) => t.email) } })
  await FileItem.deleteMany({ name: 'hr-offer.pdf' })
  await mongoose.disconnect()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

run().catch((err) => { console.error(err); process.exit(1) })
