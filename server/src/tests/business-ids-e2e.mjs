// E2E verification for the BUSINESS-ID STANDARDISATION + PROJECT FORM
// SIMPLIFICATION changes:
//   Change 3 — Employee IDs are server-generated, sequential, EMP001-style
//              (never ObjectId substrings), and the createUser endpoint
//              rejects manually typed codes that do not match EMP<digits>.
//   Change 4 — Project IDs are server-generated, sequential, PRJ001-style;
//              a manually typed code is preserved, and the backend never
//              requires a code.
//   Change 2 — Project creation works with NONE of the removed commercial
//              fields (priority/budget/startDate/deadline/advancePayment/
//              monthlyDue/billingCycle/paymentMode); legacy callers that still
//              send them keep working unchanged.
// Run from server/ (with the server + Mongo up):
//   node src/tests/business-ids-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { Project } from '../models/projectModels.js'

const API = 'https://skew-server-317n.onrender.com/api'
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

async function login(email, password) {
  const { status, data } = await api('/auth/login', { method: 'POST', body: { email, password } })
  return status === 200 && data?.token ? data : null
}

const run = async () => {
  await mongoose.connect(TEST_MONGO_URI, {
    serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, maxPoolSize: 5,
  })

  const ADMIN = { email: 'e2e-bid-admin@skew.com', password: 'E2eBidA#1', role: 'Admin', name: 'E2E BID Admin', department: 'Management', designation: 'Tester' }

  // Idempotent cleanup of previous runs.
  const oldIds = (await User.find({ email: { $in: [ADMIN.email] } }, { _id: 1 }).lean()).map((u) => u._id)
  if (oldIds.length) await Employee.deleteMany({ userId: { $in: oldIds } })
  await Employee.deleteMany({ email: { $in: [ADMIN.email] } })
  await User.deleteMany({ email: { $in: [ADMIN.email] } })
  await Project.deleteMany({ name: /^E2E BID Project/ })

  await User.create({ email: ADMIN.email, password: ADMIN.password, role: ADMIN.role, name: ADMIN.name, department: ADMIN.department, designation: ADMIN.designation, active: true })
  const admin = await login(ADMIN.email, ADMIN.password)
  check('Temp admin login', !!admin)
  if (!admin) { await mongoose.disconnect(); process.exit(1) }

  // ============ Change 4: Project ID generation ============
  // Creation WITHOUT any of the removed commercial fields and WITHOUT a code.
  const p1 = await api('/project', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Project One', client: 'E2E BID Client', status: 'Active',
    members: [{ name: ADMIN.name, role: 'Lead' }],
  } })
  check('Project created without code / budget / priority / dates / commercial terms (201)',
    p1.status === 201 && !!p1.data?.id, `status=${p1.status}`)
  const code1 = p1.data?.code
  check('Generated project code follows PRJ### format', typeof code1 === 'string' && /^PRJ\d{3,}$/.test(code1), String(code1))

  // A second creation gets the NEXT sequential code (never a collision).
  const p2 = await api('/project', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Project Two', client: 'E2E BID Client', status: 'Active',
    members: [{ name: ADMIN.name, role: 'Lead' }],
  } })
  check('Second project gets a different, sequential code',
    p2.status === 201 && p2.data?.code && p2.data.code !== code1 && /^PRJ\d{3,}$/.test(p2.data.code),
    `c1=${code1} c2=${p2.data?.code}`)

  // A manually typed code is preserved (the generator only fills blanks).
  const p3 = await api('/project', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Project Three', code: 'E2E-TYPED', client: 'E2E BID Client',
    members: [{ name: ADMIN.name, role: 'Lead' }],
  } })
  check('Manually typed project code is preserved', p3.status === 201 && p3.data?.code === 'E2E-TYPED',
    `code=${p3.data?.code}`)

  // Legacy callers that still send the removed fields are not broken.
  const p4 = await api('/project', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Project Four', client: 'E2E BID Client', status: 'Active',
    priority: 'High', budget: 50000, startDate: '2026-01-01', deadline: '2026-12-31',
    advancePayment: 1000, monthlyDue: 500, billingCycle: 'Monthly', paymentMode: 'Bank Transfer',
    members: [{ name: ADMIN.name, role: 'Lead' }],
  } })
  check('Legacy project payload (with removed fields) still creates (201)',
    p4.status === 201 && !!p4.data?.id, `status=${p4.status}`)

  // ============ Change 3: Employee ID generation ============
  // Creation through the real createUser endpoint with NO typed ID -> the
  // server allocates the next sequential EMP### code. User responses expose
  // `_id` (projects go through withId and expose `id`).
  const e1 = await api('/employees', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Employee One', email: 'e2e-bid-emp1@skew.com', password: 'E2eBidE#1',
    role: 'Employee', phone: '9111111111', department: 'Engineering', designation: 'Dev', gender: 'Male',
  } })
  check('Employee created without a typed Employee ID (201)', e1.status === 201 && !!e1.data?._id, `status=${e1.status}`)
  const empCode1 = e1.data?.empCode
  check('Generated employee code follows EMP### format', typeof empCode1 === 'string' && /^EMP\d{3,}$/.test(empCode1), String(empCode1))

  const e2 = await api('/employees', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Employee Two', email: 'e2e-bid-emp2@skew.com', password: 'E2eBidE#2',
    role: 'Employee', phone: '9222222222', department: 'Engineering', designation: 'Dev', gender: 'Male',
  } })
  check('Second employee gets a different, sequential code',
    e2.status === 201 && e2.data?.empCode && e2.data.empCode !== empCode1 && /^EMP\d{3,}$/.test(e2.data.empCode),
    `c1=${empCode1} c2=${e2.data?.empCode}`)

  // A typed code that does not follow the format is rejected outright.
  const bad = await api('/employees', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Bad Code', email: 'e2e-bid-bad@skew.com', password: 'E2eBidB#1',
    role: 'Employee', phone: '9333333333', department: 'Engineering', designation: 'Dev', gender: 'Male',
    employeeId: 'ABC',
  } })
  check('Typed Employee ID not in EMP### format is rejected (400)',
    bad.status === 400 && /EMP001/.test(String(bad.data?.message || '')), `status=${bad.status}`)

  // A correctly formatted typed code is adopted.
  const good = await api('/employees', { method: 'POST', token: admin.token, body: {
    name: 'E2E BID Typed Code', email: 'e2e-bid-typed@skew.com', password: 'E2eBidT#1',
    role: 'Employee', phone: '9444444444', department: 'Engineering', designation: 'Dev', gender: 'Male',
    employeeId: 'EMP9999',
  } })
  check('Typed EMP### code is adopted', good.status === 201 && good.data?.empCode === 'EMP9999',
    `status=${good.status} code=${good.data?.empCode}`)

  // Stored Employee document carries the same code (single source of truth).
  const storedEmp = await Employee.findOne({ email: 'e2e-bid-typed@skew.com' }).lean()
  check('Employee record stores the same empCode', storedEmp?.empCode === 'EMP9999', storedEmp?.empCode)

  // ============ Business-ID URL resolution (PRJ001 / EMP001 in the address bar) ============
  // The app navigates to /projects/<PRJ code> and /employees/<EMP code>; every
  // staff endpoint must resolve the human-readable code OR the legacy ObjectId.
  const dByCode = await api(`/project/${code1}/detail`, { token: admin.token })
  check('GET /project/:code/detail resolves by Project ID code',
    dByCode.status === 200 && dByCode.data?.id === p1.data.id && dByCode.data?.code === code1,
    `status=${dByCode.status} id=${dByCode.data?.id}`)

  const dByObjectId = await api(`/project/${p1.data.id}/detail`, { token: admin.token })
  check('GET /project/:objectId/detail still works (legacy link)',
    dByObjectId.status === 200 && dByObjectId.data?.code === code1, `status=${dByObjectId.status}`)

  const gByCode = await api(`/project/${code1}`, { token: admin.token })
  check('GET /project/:code resolves by Project ID code',
    gByCode.status === 200 && gByCode.data?.id === p1.data.id, `status=${gByCode.status}`)

  const upByCode = await api(`/project/${code1}`, { method: 'PUT', token: admin.token, body: { status: 'On Hold' } })
  check('PUT /project/:code updates by Project ID code',
    upByCode.status === 200 && upByCode.data?.status === 'On Hold', `status=${upByCode.status}`)
  await Project.updateOne({ _id: p1.data.id }, { status: 'Active' })

  const e1Doc = await Employee.findOne({ email: 'e2e-bid-emp1@skew.com' }).lean()

  const eByCode = await api(`/employees/${empCode1}`, { token: admin.token })
  check('GET /employees/:empCode resolves by Employee ID code',
    eByCode.status === 200 && eByCode.data?.empCode === empCode1 && String(eByCode.data?._id) === String(e1Doc._id),
    `status=${eByCode.status} empCode=${eByCode.data?.empCode}`)

  const eByObjectId = await api(`/employees/${e1Doc._id}`, { token: admin.token })
  check('GET /employees/:objectId still works (legacy link)',
    eByObjectId.status === 200 && eByObjectId.data?.empCode === empCode1, `status=${eByObjectId.status}`)

  const upByCode2 = await api(`/employees/${empCode1}`, { method: 'PUT', token: admin.token, body: { phone: '9555555555' } })
  check('PUT /employees/:empCode updates by Employee ID code',
    upByCode2.status === 200 && upByCode2.data?.phone === '9555555555', `status=${upByCode2.status}`)

  // Malformed / unknown refs must 404, never 500 (the refresh-fix symptom).
  const missing = await api('/project/PRJ999999/detail', { token: admin.token })
  check('Unknown Project ID code returns 404 (not 500)',
    missing.status === 404, `status=${missing.status}`)
  const badRef = await api('/project/not-a-real-id/detail', { token: admin.token })
  check('Malformed project ref returns 404 (not 500)',
    badRef.status === 404, `status=${badRef.status}`)
  const missingEmp = await api('/employees/EMP000000', { token: admin.token })
  check('Unknown Employee ID code returns 404 (not 500)',
    missingEmp.status === 404, `status=${missingEmp.status}`)
  const badEmpRef = await api('/employees/not-a-real-id', { token: admin.token })
  check('Malformed employee ref returns 404 (not 500)',
    badEmpRef.status === 404, `status=${badEmpRef.status}`)

  // ============ Cleanup ============
  const empEmails = ['e2e-bid-emp1@skew.com', 'e2e-bid-emp2@skew.com', 'e2e-bid-bad@skew.com', 'e2e-bid-typed@skew.com', 'e2e-bid-debug@skew.com', 'e2e-bid-debug2@skew.com']
  const empIds = (await User.find({ email: { $in: empEmails } }, { _id: 1 }).lean()).map((u) => u._id)
  if (empIds.length) await Employee.deleteMany({ userId: { $in: empIds } })
  await Employee.deleteMany({ email: { $in: empEmails } })
  await User.deleteMany({ email: { $in: empEmails } })
  await Project.deleteMany({ name: /^E2E BID Project/ })
  await mongoose.disconnect()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exit(1)
}

run().catch((err) => { console.error(err); process.exit(1) })
