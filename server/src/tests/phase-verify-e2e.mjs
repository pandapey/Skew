// E2E verification for the current phase (Tasks 1-5):
//   * Client Pay/Balance (Task 5): the Admin/HR /hr/client-billing overview
//     and the Client Portal's GET /client/payments are the SAME figures —
//     a temp client's row is compared field-by-field across both surfaces.
//   * Attendance status (Tasks 1-3): a shift that has NOT started yet must
//     yield 'Not Marked' while a General-shift employee with no record must
//     yield 'Absent' once the stored shift has started; both travel as the
//     ADDITIVE attendanceStatus field on /employees and the stats endpoint
//     keeps its keys with shift-aware numbers.
// Uses the LIVE server + MongoDB. Prints PASS/FAIL, exits 1 on any failure.
// Run from server/: node src/tests/phase-verify-e2e.mjs
import mongoose from 'mongoose'
import { TEST_MONGO_URI } from './db-connect.mjs'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { Shift, Attendance } from '../models/attendanceModels.js'
import { Client, ClientProject } from '../models/clientModels.js'
import { Invoice, Transaction } from '../models/financeModels.js'
import { AuditLog } from '../models/adminModels.js'

const API = 'http://localhost:5000/api'
const COMPANY = 'E2E Billing Verify Co'
const ADMIN_EMAIL = 'e2e-cb-admin@skew.com'
const CLIENT_EMAIL = 'e2e-cb-client@skew.com'
const EMP_A_NAME = 'E2E Verify Late Emp'
const EMP_B_NAME = 'E2E Verify General Emp'
const EMP_C_NAME = 'E2E Verify Started Emp'
const SHIFT_NAME = 'E2E Verify Late'
const SHIFT_STARTED_NAME = 'E2E Verify Started'
const AUDIT_ACTION = 'Viewed salary portal'

let pass = 0
let fail = 0
let skipped = 0
const results = []
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const skip = (name, detail = '') => {
  skipped++
  results.push(`SKIP  ${name}  (${detail})`)
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

  // --- Idempotent start cleanup ---
  await User.deleteMany({ email: { $in: [ADMIN_EMAIL, CLIENT_EMAIL, 'e2e-verify-late@skew.com', 'e2e-verify-gen@skew.com', 'e2e-verify-started@skew.com'] } })
  await Employee.deleteMany({ name: { $in: [EMP_A_NAME, EMP_B_NAME, EMP_C_NAME] } })
  await Client.deleteMany({ company: COMPANY })
  await ClientProject.deleteMany({ clientId: 'e2e-cb-1' })
  await Invoice.deleteMany({ invoiceNumber: 'E2E-INV-001' })
  await Transaction.deleteMany({ party: COMPANY })
  await Shift.deleteOne({ name: SHIFT_NAME })
  await Shift.deleteOne({ name: SHIFT_STARTED_NAME })
  await AuditLog.deleteMany({ user: { $in: [EMP_A_NAME, EMP_B_NAME, EMP_C_NAME] } })

  // --- Fixtures ---------------------------------------------------------------
  await User.create({ email: ADMIN_EMAIL, password: 'E2eCbAdmin#1', role: 'Admin', name: 'E2E CB Admin', active: true })
  await User.create({
    email: CLIENT_EMAIL, password: 'E2eCbClient#1', role: 'Client',
    name: 'E2E CB Client', clientId: 'e2e-cb-1', active: true,
  })
  await Client.create({
    clientId: 'e2e-cb-1', company: COMPANY, contactPerson: 'E2E Contact', email: CLIENT_EMAIL,
    plan: 'Business', status: 'Active', advancePayment: 0, monthlyDue: 0, budget: 0,
  })
  await ClientProject.create({
    projectId: 'e2e-cbp-1', clientId: 'e2e-cb-1', name: 'E2E Verify Project',
    budget: 500000, advancePayment: 25000, monthlyDue: 20000, status: 'In Progress',
  })
  await Invoice.create({
    invoiceNumber: 'E2E-INV-001', client: COMPANY, total: 120000, amountPaid: 50000,
    status: 'Partial', issueDate: '2026-08-01', dueDate: '2026-08-31',
  })
  await Transaction.create({
    title: 'E2E advance', type: 'Income', category: 'Project Advance',
    amount: 25000, date: '2026-08-01', method: 'Bank Transfer', party: COMPANY,
  })

  const admin = await login(ADMIN_EMAIL, 'E2eCbAdmin#1')
  const client = await login(CLIENT_EMAIL, 'E2eCbClient#1')
  check('fixtures: admin login', !!admin)
  check('fixtures: client login', !!client)
  if (!admin || !client) throw new Error('login failed')

  // ==========================================================================
  // TASK 5 — ONE billing calculation across BOTH surfaces
  // ==========================================================================
  const portal = await api('/client/payments', { token: client.token })
  check('5: portal payments OK', portal.status === 200, `status=${portal.status}`)
  check('5: portal payload carries server summary', !!portal.data?.summary, portal.data?.summary ? 'summary present' : 'missing')
  const s = portal.data?.summary || {}
  check('5: summary.totalAmount = contracted project budget', s.totalAmount === 500000, `totalAmount=${s.totalAmount}`)
  check('5: summary.billed = invoice only (advance is not a bill)', s.billed === 120000, `billed=${s.billed}`)
  check('5: summary.paid = invoice paid + advance', s.paid === 75000, `paid=${s.paid}`)
  check('5: summary.pending = unpaid open invoice portion', s.pending === 70000, `pending=${s.pending}`)
  check('5: summary.balance = max(contracted, billed) - paid', s.balance === 425000, `balance=${s.balance}`)
  check('5: summary.advancePayment/monthlyDue from project terms', s.advancePayment === 25000 && s.monthlyDue === 20000, `adv=${s.advancePayment} monthly=${s.monthlyDue}`)
  check('5: summary.nextDueDate = invoice due date', s.nextDueDate === '2026-08-31', `next=${s.nextDueDate}`)

  const overview = await api('/hr/client-billing', { token: admin.token })
  check('5: /hr/client-billing OK', overview.status === 200, `status=${overview.status}`)
  check('5: overview totals = sum of per-client rows', overview.data?.totalBilled === overview.data?.clients.reduce((t, c) => t + (c.billed || 0), 0)
    && overview.data?.totalPaid === overview.data?.clients.reduce((t, c) => t + (c.paid || 0), 0)
    && overview.data?.totalBalance === overview.data?.clients.reduce((t, c) => t + (c.balance || 0), 0),
    `billed=${overview.data?.totalBilled} paid=${overview.data?.totalPaid} balance=${overview.data?.totalBalance}`)
  const row = (overview.data?.clients || []).find((c) => c.company === COMPANY)
  check('5: temp client appears in overview', !!row)
  check('5: HR row MATCHES portal summary field-for-field',
    !!row && row.totalAmount === s.totalAmount && row.billed === s.billed && row.paid === s.paid
    && row.pending === s.pending && row.balance === s.balance && row.overdue === s.overdue
    && row.nextDueDate === s.nextDueDate,
    row ? `balance=${row.balance} paid=${row.paid}` : 'no row')
  check('5: HR row carries client identity fields', !!row?.clientId && !!row?.contactPerson && !!row?.plan, row?.plan || 'none')

  // ==========================================================================
  // TASKS 1-3 — shift-aware attendance status (additive, per-person + stats)
  // ==========================================================================
  const general = await Shift.findOne({ name: 'General' }).lean()
  await Shift.create({ name: SHIFT_NAME, code: 'E2EVL', start: '23:59', end: '23:59', hours: 8, graceMins: 0 })
  await Shift.create({ name: SHIFT_STARTED_NAME, code: 'E2EVS', start: '00:00', end: '23:59', hours: 8, graceMins: 0 })
  await User.create({ email: 'e2e-verify-late@skew.com', password: 'E2eVerify#1', role: 'Employee', name: EMP_A_NAME, department: 'Engineering', designation: 'Tester', shift: SHIFT_NAME, active: true })
  await User.create({ email: 'e2e-verify-gen@skew.com', password: 'E2eVerify#1', role: 'Employee', name: EMP_B_NAME, department: 'Engineering', designation: 'Tester', shift: 'General', active: true })
  await User.create({ email: 'e2e-verify-started@skew.com', password: 'E2eVerify#1', role: 'Employee', name: EMP_C_NAME, department: 'Engineering', designation: 'Tester', shift: SHIFT_STARTED_NAME, active: true })
  await Employee.create({ name: EMP_A_NAME, email: 'e2e-verify-late@skew.com', empCode: 'E2EV-A', phone: '9999999997', gender: 'Female', department: 'Engineering', designation: 'Tester', shift: SHIFT_NAME, salary: { ctc: 60000 }, status: 'Active' })
  await Employee.create({ name: EMP_B_NAME, email: 'e2e-verify-gen@skew.com', empCode: 'E2EV-B', phone: '9999999996', gender: 'Female', department: 'Engineering', designation: 'Tester', shift: 'General', salary: { ctc: 60000 }, status: 'Active' })
  await Employee.create({ name: EMP_C_NAME, email: 'e2e-verify-started@skew.com', empCode: 'E2EV-C', phone: '9999999995', gender: 'Female', department: 'Engineering', designation: 'Tester', shift: SHIFT_STARTED_NAME, salary: { ctc: 60000 }, status: 'Active' })

  const list = await api('/employees?search=E2EV&limit=100', { token: admin.token })
  check('1-3: /employees list OK', list.status === 200, `status=${list.status}`)
  const empA = (list.data?.data || []).find((e) => e.empCode === 'E2EV-A')
  const empB = (list.data?.data || []).find((e) => e.empCode === 'E2EV-B')
  const empC = (list.data?.data || []).find((e) => e.empCode === 'E2EV-C')
  check('1-3: all temp employees on the page', !!empA && !!empB && !!empC)
  check('1-3: stored status NOT overwritten (additive field)', empA?.status === 'Active' && empB?.status === 'Active' && empC?.status === 'Active', `A=${empA?.status} B=${empB?.status} C=${empC?.status}`)
  check('1-3: shift not yet started -> Not Marked (no midnight absent)', empA?.attendanceStatus === 'Not Marked', `A=${empA?.attendanceStatus}`)
  check('1-3: no record + started shift -> Absent (no grace, at shift start)', empC?.attendanceStatus === 'Absent', `C=${empC?.attendanceStatus}`)
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes()
  const genStart = general ? Number(general.start.split(':')[0]) * 60 + Number(general.start.split(':')[1]) : null
  if (genStart != null && nowMins >= genStart) {
    check('1-3: no record + General shift started -> Absent', empB?.attendanceStatus === 'Absent', `B=${empB?.attendanceStatus} generalStart=${general.start}`)
  } else {
    skip('1-3: General-shift absence check', genStart == null ? 'no General shift stored' : `General starts at ${general.start}, now=${nowMins}m — shift not started yet`)
  }

  const stats = await api('/attendance/stats', { token: admin.token })
  check('1-3: stats OK', stats.status === 200, `status=${stats.status}`)
  const st = stats.data || {}
  check('1-3: stats keeps absent/absentMarked/absentUnmarked', typeof st.absent === 'number' && typeof st.absentMarked === 'number' && typeof st.absentUnmarked === 'number', `absent=${st.absent} marked=${st.absentMarked} unmarked=${st.absentUnmarked}`)
  check('1-3: absent = marked + unmarked (invariant)', st.absent === st.absentMarked + st.absentUnmarked, `absent=${st.absent} marked=${st.absentMarked} unmarked=${st.absentUnmarked}`)
  check('1-3: stats carries computed onLeave + additive notMarked', typeof st.onLeave === 'number' && typeof st.notMarked === 'number', `onLeave=${st.onLeave} notMarked=${st.notMarked}`)
  check('1-3: attendanceRate within 0-100', st.attendanceRate >= 0 && st.attendanceRate <= 100, `rate=${st.attendanceRate}`)
  check('1-3: statusSplit carries Not Marked slice', Array.isArray(st.statusSplit) && st.statusSplit.some((x) => x.name === 'Not Marked'), `slices=${st.statusSplit?.map((x) => x.name).join(',')}`)

  // --- Cleanup ------------------------------------------------------------------
  await User.deleteMany({ email: { $in: [ADMIN_EMAIL, CLIENT_EMAIL, 'e2e-verify-late@skew.com', 'e2e-verify-gen@skew.com', 'e2e-verify-started@skew.com'] } })
  await Employee.deleteMany({ name: { $in: [EMP_A_NAME, EMP_B_NAME, EMP_C_NAME] } })
  await Client.deleteMany({ company: COMPANY })
  await ClientProject.deleteMany({ clientId: 'e2e-cb-1' })
  await Invoice.deleteMany({ invoiceNumber: 'E2E-INV-001' })
  await Transaction.deleteMany({ party: COMPANY })
  await Shift.deleteOne({ name: SHIFT_NAME })
  await Shift.deleteOne({ name: SHIFT_STARTED_NAME })
  await AuditLog.deleteMany({ user: { $in: [EMP_A_NAME, EMP_B_NAME, EMP_C_NAME, 'E2E CB Admin', 'E2E CB Client'] } })
  await mongoose.disconnect()
}

run()
  .then(() => {
    console.log(results.join('\n'))
    console.log(`\nphase-verify-e2e: ${pass} passed, ${fail} failed, ${skipped} skipped`)
    process.exit(fail ? 1 : 0)
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })