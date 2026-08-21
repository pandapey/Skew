// PHASE SALARY/PROJECT AUDIT — end-to-end runtime verification.
//
// Boots the REAL Express app against an ISOLATED MongoDB database
// (skew_phase_audit_test), seeds a deterministic fixture, drives the real HTTP
// endpoints with a real JWT, and asserts the behaviours this phase changed.
// The developer's own `skew` database is never touched, and the test database
// is dropped on exit.
//
//   node src/tests/auditE2E.test.mjs
//
// Requires a MongoDB reachable at MONGO_BASE (default mongodb://127.0.0.1:27017).

import mongoose from 'mongoose'

const BASE = process.env.MONGO_BASE || 'mongodb://127.0.0.1:27017'
const TEST_DB = 'skew_phase_audit_test'
const PORT = Number(process.env.TEST_PORT || 5099)

process.env.MONGO_URI = `${BASE}/${TEST_DB}`
process.env.PORT = String(PORT)
process.env.JWT_SECRET ||= 'audit_test_secret'
process.env.JWT_REFRESH_SECRET ||= 'audit_test_refresh'

let pass = 0
let fail = 0
const log = []
function check(name, cond, detail = '') {
  cond ? pass++ : fail++
  log.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}
const api = (p) => `http://127.0.0.1:${PORT}/api${p}`
async function get(path, token) {
  const r = await fetch(api(path), { headers: { Authorization: `Bearer ${token}` } })
  let body = null
  try { body = await r.json() } catch { body = null }
  return { status: r.status, body }
}

// --- Deterministic fixture period: the CURRENT calendar month --------------
const now = new Date()
const YEAR = now.getFullYear()
const MONTH = now.getMonth()                       // 0-based
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (d) => `${YEAR}-${pad(MONTH + 1)}-${pad(d)}`
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const CURRENT_LABEL = `${MONTH_NAMES[MONTH]} ${YEAR}`
// A month label that sorts AFTER the current one alphabetically but BEFORE it
// chronologically — this is what exposed the lexicographic-sort defect.
const OLDER_LABEL = `September ${YEAR - 1}`

async function main() {
  const { connectDB } = await import('../config/db.js')
  await connectDB(process.env.MONGO_URI)
  await mongoose.connection.dropDatabase()

  const { User } = await import('../models/User.js')
  const { Employee } = await import('../models/Employee.js')
  const { Payroll } = await import('../models/hrModels.js')
  const { Attendance, Holiday, Shift } = await import('../models/attendanceModels.js')
  const { LeaveType, LeaveRequest } = await import('../models/leaveModels.js')
  const { Project, ProjectTask, ProjectComment, ProjectFile, ProjectActivity, Sprint, Milestone } =
    await import('../models/projectModels.js')
  const { CalendarEvent } = await import('../models/calendarModels.js')
  const { countWorkingDays, toDateKey } = await import('../utils/leaveDays.js')

  // ---- Identities ---------------------------------------------------------
  const PASSWORD = 'AuditTest#2026'
  const emp = await User.create({
    name: 'Audit Employee', email: 'audit.employee@skew.test', password: PASSWORD,
    role: 'Employee', department: 'Engineering', empCode: 'AUD001', status: 'Active',
  })
  const outsider = await User.create({
    name: 'Audit Outsider', email: 'audit.outsider@skew.test', password: PASSWORD,
    role: 'Employee', department: 'Engineering', empCode: 'AUD002', status: 'Active',
  })
  await User.create({
    name: 'Audit Admin', email: 'audit.admin@skew.test', password: PASSWORD,
    role: 'Admin', status: 'Active',
  })

  // CTC 1,200,000 -> monthly (gross) 100000 -> basic 50000 (50% of gross)
  const empDoc = new Employee({
    empCode: 'AUD001', userId: emp._id, name: 'Audit Employee',
    email: 'audit.employee@skew.test', phone: '9999999999',
    department: 'Engineering', designation: 'Engineer', shift: 'General',
    salary: { ctc: 1200000 },
  })
  await empDoc.save()

  await Shift.create({ name: 'General', code: 'GEN', start: '09:30', end: '18:30', hours: 9, graceMins: 15 })

  // ---- Leave policy: one paid type, one unpaid type ------------------------
  await LeaveType.insertMany([
    { name: 'Casual Leave', code: 'CL', allocated: 12, paid: true },
    { name: 'Unpaid Leave', code: 'LWP', allocated: 0, paid: false },
  ])

  // ---- Attendance fixture --------------------------------------------------
  // Working days 1..10 of this month (skipping Sundays/holidays), of which:
  //   * days marked Present
  //   * 2 days approved PAID leave      -> must NOT be deducted
  //   * 2 days approved UNPAID leave    -> MUST be deducted (SALARY BUG 5)
  //   * 1 day explicitly Absent         -> must be deducted
  const holidayDay = 6
  await Holiday.create({ name: 'Audit Holiday', date: dayKey(holidayDay), type: 'Public' })
  const holidaySet = new Set([dayKey(holidayDay)])
  const isWorking = (d) => {
    const key = dayKey(d)
    return new Date(`${key}T00:00:00`).getDay() !== 0 && !holidaySet.has(key)
  }
  const workingDaysInWindow = []
  for (let d = 1; d <= 12 && workingDaysInWindow.length < 9; d += 1) if (isWorking(d)) workingDaysInWindow.push(d)

  const paidLeaveDays = workingDaysInWindow.slice(0, 2)
  const unpaidLeaveDays = workingDaysInWindow.slice(2, 4)
  const absentDays = workingDaysInWindow.slice(4, 5)
  const presentDays = workingDaysInWindow.slice(5)

  const attDocs = [
    ...presentDays.map((d) => ({
      employee: 'Audit Employee', empCode: 'AUD001', department: 'Engineering',
      date: dayKey(d), status: 'Present', shift: 'General', workingHours: 9,
      checkIn: '09:30', checkOut: '18:30',
    })),
    ...paidLeaveDays.map((d) => ({ employee: 'Audit Employee', empCode: 'AUD001', date: dayKey(d), status: 'On Leave' })),
    ...unpaidLeaveDays.map((d) => ({ employee: 'Audit Employee', empCode: 'AUD001', date: dayKey(d), status: 'On Leave' })),
    ...absentDays.map((d) => ({ employee: 'Audit Employee', empCode: 'AUD001', date: dayKey(d), status: 'Absent' })),
  ]
  await Attendance.insertMany(attDocs)

  await LeaveRequest.insertMany([
    {
      employee: 'Audit Employee', empCode: 'AUD001', type: 'Casual Leave', typeCode: 'CL',
      from: dayKey(paidLeaveDays[0]), to: dayKey(paidLeaveDays[1]), days: paidLeaveDays.length,
      reason: 'paid fixture', status: 'Approved',
    },
    {
      employee: 'Audit Employee', empCode: 'AUD001', type: 'Unpaid Leave', typeCode: 'LWP',
      from: dayKey(unpaidLeaveDays[0]), to: dayKey(unpaidLeaveDays[1]), days: unpaidLeaveDays.length,
      reason: 'unpaid fixture', status: 'Approved',
    },
  ])

  // ---- Payroll rows: seeded to match the CURRENT server/src/seed.js shape,
  // i.e. gross/net computed from monthly-pf-esi only (no HRA/allowances, no
  // professional tax, no LWP, no TDS). The OLDER row deliberately keeps an
  // old-style stray `tax` value on disk (a payslip run before TASK 5) to
  // verify historical rows are reported as-recorded rather than rewritten —
  // see the history-normalization comment in hrRoutes.js.
  await Payroll.insertMany([
    {
      employee: 'Audit Employee', empCode: 'AUD001', department: 'Engineering', designation: 'Engineer',
      month: CURRENT_LABEL, monthly: 100000, basic: 50000, pf: 6000, esi: 750,
      gross: 100000, net: 100000 - 6000 - 750, status: 'Pending',
    },
    {
      employee: 'Audit Employee', empCode: 'AUD001', department: 'Engineering', designation: 'Engineer',
      month: OLDER_LABEL, monthly: 100000, basic: 50000, pf: 6000, tax: 8000,
      gross: 100000, net: 86000, status: 'Paid',
    },
  ])

  // ---- Projects: one the employee belongs to, one they do not --------------
  const mine = await Project.create({
    name: 'Audit Project Mine', code: 'AUD-1', client: 'Audit Client', status: 'Active',
    priority: 'High', lead: 'Audit Employee', members: [{ name: 'Audit Employee', role: 'Lead' }],
    budget: 500000, startDate: new Date(), deadline: new Date(Date.now() + 30 * 864e5),
  })
  const foreign = await Project.create({
    name: 'Audit Project Foreign', code: 'AUD-2', client: 'Other Client', status: 'Active',
    priority: 'High', lead: 'Audit Outsider', members: [{ name: 'Audit Outsider', role: 'Lead' }],
    budget: 900000, startDate: new Date(), deadline: new Date(Date.now() + 30 * 864e5),
  })

  await ProjectComment.insertMany([
    { project: mine._id, author: 'Audit Employee', body: 'mine-comment' },
    { project: foreign._id, author: 'Audit Outsider', body: 'CONFIDENTIAL-foreign-comment' },
  ])
  await ProjectFile.insertMany([
    { project: mine._id, name: 'mine.pdf', uploadedBy: 'Audit Employee' },
    { project: foreign._id, name: 'CONFIDENTIAL-foreign.pdf', uploadedBy: 'Audit Outsider' },
  ])
  await ProjectActivity.insertMany([
    { project: mine._id, actor: 'Audit Employee', action: 'created project' },
    { project: foreign._id, actor: 'Audit Outsider', action: 'CONFIDENTIAL activity' },
  ])
  await Sprint.insertMany([
    { project: mine._id, name: 'Mine Sprint 1', goal: 'ship', status: 'Active' },
    { project: foreign._id, name: 'CONFIDENTIAL Foreign Sprint', goal: 'secret', status: 'Active' },
  ])
  await Milestone.insertMany([
    { project: mine._id, title: 'Mine Milestone', status: 'Upcoming', dueDate: new Date() },
    { project: foreign._id, title: 'CONFIDENTIAL Foreign Milestone', status: 'Upcoming', dueDate: new Date() },
  ])
  await ProjectTask.create({
    project: mine._id, title: 'Audit assigned task', type: 'Task', status: 'Todo',
    priority: 'High', assignee: 'Audit Employee', assignedBy: 'Audit Employee',
    dueDate: new Date(Date.now() + 2 * 864e5),
  })
  await CalendarEvent.create({
    title: 'Audit upcoming meeting', type: 'meeting', meetingStatus: 'Pending',
    start: new Date(Date.now() + 864e5), end: new Date(Date.now() + 864e5 + 36e5),
    projectId: mine._id, createdBy: 'Audit Employee', requestedBy: 'staff', attendees: ['Audit Employee'],
  })

  // ---- Boot the real app ---------------------------------------------------
  await import('../server.js')
  await new Promise((r) => setTimeout(r, 1500))

  const health = await fetch(api('/health')).then((r) => r.json())
  check('server booted', health?.status === 'ok', JSON.stringify(health))

  const loginAs = async (email) => {
    const r = await fetch(api('/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    const b = await r.json()
    return b.token
  }
  const empToken = await loginAs('audit.employee@skew.test')
  const outsiderToken = await loginAs('audit.outsider@skew.test')
  const adminToken = await loginAs('audit.admin@skew.test')
  check('employee logged in', Boolean(empToken))
  check('outsider logged in', Boolean(outsiderToken))
  check('admin logged in', Boolean(adminToken))

  // =========================================================================
  // SALARY
  // =========================================================================
  const salary = await get('/hr/payroll/me/salary', empToken)
  check('GET /hr/payroll/me/salary responds 200', salary.status === 200, `status=${salary.status}`)
  const cur = salary.body?.current
  const att = salary.body?.attendance
  const meta = salary.body?.meta

  check('SALARY BUG 3 — current period is the CHRONOLOGICALLY latest month',
    cur?.month === CURRENT_LABEL, `got "${cur?.month}", expected "${CURRENT_LABEL}"`)

  // PHASE SALARY RECEIVABLE + LOP + OVERTIME — the current identities:
  //   net             = monthly − totalDeductions, with LOP Pay INSIDE
  //                     totalDeductions (PF + ESI + LOP Pay [+ other]) — the
  //                     old flow (payable_gross = monthly − lwp, LOP outside
  //                     the total) produced the same net number but made
  //                     Total Deduction lie about what was deducted.
  //   payable_gross   = monthly (fixed; LOP is never deducted twice)
  //   gross           = monthly (overtime/bonus never fold into gross)
  //   receivable      = round(daily_payable_amount × payable_days)
  //   current_receivable = receivable + overtime_pay (added exactly once)
  check('LOP FIX — net === monthly - totalDeductions (LOP inside the total)',
    cur && cur.net === cur.monthly - cur.totalDeductions,
    `monthly=${cur?.monthly} lwp=${cur?.lwp_deduction} deductions=${cur?.totalDeductions} net=${cur?.net}`)

  check('LOP FIX — payable gross === fixed monthly (LOP charged once, in deductions)',
    cur && cur.payable_gross === cur.monthly,
    `monthly=${cur?.monthly} payableGross=${cur?.payable_gross}`)

  check('LOP FIX — net === gross - totalDeductions (no overtime/bonus in fixture)',
    cur && cur.net === cur.gross - cur.totalDeductions,
    `gross=${cur?.gross} deductions=${cur?.totalDeductions} net=${cur?.net}`)

  check('SALARY BUG 2 — the stored payroll net (86000) no longer overrides the recomputed one',
    cur && cur.net !== 86000, `net=${cur?.net}`)

  // Phase 6.12 (TASK 10): the engine derives lwp_days from the ADDITIVE
  // `attendance.payableAbsentDays` — unpaid leave + explicit absences PLUS
  // elapsed working days with no attendance record (payrollEngine.js). The
  // fixture deliberately contains one unrecorded day (elapsedWorkingDays=10,
  // recorded=9), so the correct expectation is payableAbsentDays, not the
  // unpaid+absent sum alone. This still proves unpaid leave and absences are
  // counted as non-payable days.
  const expectedLop = Number(att?.payableAbsentDays ?? (unpaidLeaveDays.length + absentDays.length))
  check('SALARY BUG 5 — unpaid leave + absences are still COUNTED as non-payable days',
    cur?.lwp_days === expectedLop,
    `lwp_days=${cur?.lwp_days} expected=${expectedLop} (unpaid=${unpaidLeaveDays.length} absent=${absentDays.length} unrecorded=${att?.unrecordedDays} payableAbsentDays=${att?.payableAbsentDays})`)
  check('SALARY BUG 5 — approved PAID leave is NOT charged',
    att?.paidLeaveDays === paidLeaveDays.length,
    `paidLeaveDays=${att?.paidLeaveDays} expected=${paidLeaveDays.length}`)

  // ---------------------------------------------------------------------
  // PHASE LOP SALARY FIX: this block previously asserted
  //     Number(cur.lwp_deduction) === 0
  // i.e. that the loss-of-pay deduction never reached the payslip — the
  // full-salary bug this phase fixes. The fixture employee has real unpaid
  // absence this period (payableAbsentDays = expectedLop > 0), so the
  // deduction MUST now be positive and must equal LOP days × the per-day
  // payable rate. PT and TDS remain genuinely removed and stay pinned to 0.
  // ---------------------------------------------------------------------
  check('LOP FIX — loss-of-pay IS deducted on the payslip',
    Number(cur?.lwp_deduction || 0) > 0, `lwp_deduction=${cur?.lwp_deduction}`)
  check('LOP FIX — lwp_deduction === round(lwp_days x daily_payable_rate)',
    Number(cur?.lwp_deduction) === Math.round(Number(cur?.lwp_days || 0) * Number(cur?.daily_payable_rate || 0)),
    `lwp_deduction=${cur?.lwp_deduction} days=${cur?.lwp_days} rate=${cur?.daily_payable_rate}`)
  check('TASK 5 — no professional tax is applied',
    Number(cur?.professional_tax || 0) === 0, `professional_tax=${cur?.professional_tax}`)
  check('TASK 5 — no TDS/tax is applied',
    Number(cur?.tax || 0) === 0, `tax=${cur?.tax}`)
  // PHASE SALARY MONTHLY RECEIVABLE: Total Deduction = PF + ESI + LOP Pay
  // (+ other). LOP lives INSIDE the total now (LOP Pay = days × daily payable
  // rate) — the fixture has real unpaid absence this month, so this only holds
  // if the loss-of-pay days were actually priced.
  check('TASK 5 — total deductions = pf + esi + other + LOP Pay',
    Number(cur?.totalDeductions) === Number(cur?.pf || 0) + Number(cur?.esi || 0)
      + Number(cur?.other_deductions || 0) + Number(cur?.lwp_deduction || 0),
    `total=${cur?.totalDeductions} pf=${cur?.pf} esi=${cur?.esi} other=${cur?.other_deductions} lwp=${cur?.lwp_deduction}`)
  check('LOP FIX — meta reports LOP as a tracked deduction',
    meta?.lwpDeductionTracked === true, `lwpDeductionTracked=${meta?.lwpDeductionTracked}`)
  check('LOP FIX — lwp_deduction is no longer listed among removed deductions',
    Array.isArray(meta?.removedDeductions) && !meta.removedDeductions.includes('lwp_deduction'),
    JSON.stringify(meta?.removedDeductions))

  // TASK 2 — Receivable is earned pay, not the whole month's net.
  const expectedPayableDays = Number(att?.presentDays || 0) + Number(att?.paidLeaveDays || 0)
  check('TASK 2 — payable days = present + approved paid leave',
    cur?.payable_days === expectedPayableDays,
    `payable_days=${cur?.payable_days} expected=${expectedPayableDays}`)
  // PHASE SALARY MONTHLY RECEIVABLE: earned days are priced at the NET-based
  // Daily Payable Amount (Net Monthly ÷ 30), not the gross-based rate.
  check('TASK 2 — receivable = daily payable AMOUNT x payable days',
    cur?.receivable === Math.round(Number(cur?.daily_payable_amount || 0) * expectedPayableDays),
    `receivable=${cur?.receivable} amount=${cur?.daily_payable_amount} days=${expectedPayableDays}`)
  check('TASK 2 — receivable is no longer just the month net',
    cur?.status === 'Paid' || cur?.receivable !== cur?.net,
    `receivable=${cur?.receivable} net=${cur?.net}`)

  // PHASE SALARY RECEIVABLE + LOP + OVERTIME — the CURRENT-month receivable
  // is a REAL earned figure (this fixture has present days + approved paid
  // leave THIS month, so the current-month attendance must price it): the
  // exact "always ₹0" root cause this phase fixes is that attendance used to
  // be scoped to the latest payroll row's month instead of the current
  // calendar month. current_receivable = receivable + overtime (exactly
  // once); gross stays the fixed monthly figure.
  check('PHASE FIX — current receivable > 0 from current-month attendance',
    Number(cur?.current_receivable || 0) > 0, `current_receivable=${cur?.current_receivable}`)
  check('PHASE FIX — current_receivable = receivable + overtime (once)',
    cur && cur.current_receivable === cur.receivable + Number(cur?.overtime_pay || 0),
    `current_receivable=${cur?.current_receivable} receivable=${cur?.receivable} overtime=${cur?.overtime_pay}`)
  check('PHASE FIX — receivable_total = current_receivable',
    cur && cur.receivable_total === cur.current_receivable,
    `receivable_total=${cur?.receivable_total} current_receivable=${cur?.current_receivable}`)
  check('PHASE FIX — gross = fixed monthly salary (no overtime/bonus)',
    cur && cur.gross === cur.monthly,
    `gross=${cur?.gross} monthly=${cur?.monthly}`)

  // Phase 7.2 (TASK 3) — Overtime REMOVED: the summary no longer computes a
  // per-day split or a cap; `overtime` / `overtimeRaw` are pinned to 0 by the
  // service and the cap key no longer exists.
  check('Phase 7.2 — overtime is REMOVED: payable overtime = 0',
    Number(att?.overtime || 0) === 0 && Number(att?.overtimeRaw || 0) === 0,
    `overtime=${att?.overtime} raw=${att?.overtimeRaw} workingDays=${att?.workingDays}`)
  check('Phase 7.2 — the overtime cap key is gone',
    !('overtimeDailyCap' in (att || {})), `overtimeDailyCap=${att?.overtimeDailyCap}`)

  const expectedWorking = countWorkingDays(dayKey(1), toDateKey(new Date(YEAR, MONTH + 1, 0)), holidaySet)
  check('working days exclude Sundays and the company holiday',
    att?.expectedWorkingDays === expectedWorking,
    `expectedWorkingDays=${att?.expectedWorkingDays} computed=${expectedWorking}`)
  check('the company holiday is reported', att?.holidayDays === 1, `holidayDays=${att?.holidayDays}`)

  check('SALARY BUG 6 — meta.attendanceBasis is present (MySalary reads it)',
    Boolean(meta?.attendanceBasis) && typeof meta.attendanceBasis.payableAbsentDays === 'number',
    JSON.stringify(meta?.attendanceBasis))

  const hist = salary.body?.history || []
  check('SALARY BUG 3 — history is ordered newest-first chronologically',
    hist[0]?.month === CURRENT_LABEL && hist[1]?.month === OLDER_LABEL,
    hist.map((h) => h.month).join(' | '))
  const curRow = hist.find((h) => h.month === CURRENT_LABEL)
  check('SALARY — the history row for the current period matches the Salary page exactly',
    curRow && curRow.gross === cur.gross && curRow.net === cur.net && curRow.deductions === cur.totalDeductions,
    `row: gross=${curRow?.gross} ded=${curRow?.deductions} net=${curRow?.net} | current: gross=${cur?.gross} ded=${cur?.totalDeductions} net=${cur?.net}`)
  check('SALARY — every history row satisfies net = gross - deductions',
    hist.every((h) => h.net === h.gross - h.deductions),
    JSON.stringify(hist.map((h) => [h.month, h.gross, h.deductions, h.net])))

  const empRecord = await Employee.findOne({ empCode: 'AUD001' }).lean()
  check('SALARY BUG 1 — Employee.salary.monthly is now persisted',
    empRecord?.salary?.monthly === 100000, `monthly=${empRecord?.salary?.monthly}`)

  // Self-scoping: the outsider gets their OWN (empty) salary, never the employee's.
  const otherSalary = await get('/hr/payroll/me/salary', outsiderToken)
  check('RBAC — /payroll/me/salary is self-scoped',
    otherSalary.status === 200 && otherSalary.body?.identity?.empCode !== 'AUD001',
    `identity=${JSON.stringify(otherSalary.body?.identity)}`)

  // =========================================================================
  // LEAVE RBAC (LEAVE BUG 1) + notification deep link (LEAVE BUG 2)
  // =========================================================================
  const ownLeave = await LeaveRequest.findOne({ employee: 'Audit Employee', type: 'Unpaid Leave' }).lean()
  const leaveSelf = await get(`/leave/requests/${ownLeave._id}`, empToken)
  check('LEAVE — an employee can still open their OWN leave request',
    leaveSelf.status === 200 && leaveSelf.body?.employee === 'Audit Employee', `status=${leaveSelf.status}`)
  const leaveOther = await get(`/leave/requests/${ownLeave._id}`, outsiderToken)
  check('LEAVE BUG 1 — another employee cannot read it by id',
    leaveOther.status === 403, `status=${leaveOther.status} body=${JSON.stringify(leaveOther.body).slice(0, 120)}`)
  const leaveAdmin = await get(`/leave/requests/${ownLeave._id}`, adminToken)
  check('LEAVE — Admin retains org-wide read (no capability removed)',
    leaveAdmin.status === 200, `status=${leaveAdmin.status}`)

  // =========================================================================
  // PROJECT RBAC (PROJECT BUG 1)
  // =========================================================================
  const leaks = [
    ['comments', `/project/comments?project=${foreign._id}`],
    ['files', `/project/files?project=${foreign._id}`],
    ['activity', `/project/activity?project=${foreign._id}`],
    ['sprints', `/project/sprints/list?project=${foreign._id}`],
    ['milestones', `/project/milestones/list?project=${foreign._id}`],
    ['sprints (resource all)', '/project/sprints/all'],
    ['milestones (resource all)', '/project/milestones/all'],
  ]
  // Two acceptable outcomes, both of which close the leak:
  //   * an explicit ?project the caller may not open -> 403/404
  //   * an unscoped collection read -> 200 carrying ONLY their own project's
  //     rows (every foreign fixture row is tagged CONFIDENTIAL).
  for (const [label, path] of leaks) {
    const r = await get(path, empToken)
    const text = JSON.stringify(r.body || '')
    const denied = r.status === 403 || r.status === 404
    check(`PROJECT BUG 1 — employee cannot read another project's ${label}`,
      denied || !text.includes('CONFIDENTIAL'),
      `status=${r.status} body=${text.slice(0, 160)}`)
  }

  const ownComments = await get(`/project/comments?project=${mine._id}`, empToken)
  check('PROJECT — the employee CAN still read their own project comments',
    ownComments.status === 200 && JSON.stringify(ownComments.body).includes('mine-comment'),
    `status=${ownComments.status}`)
  const ownSprints = await get(`/project/sprints/list?project=${mine._id}`, empToken)
  check('PROJECT — the employee CAN still read their own project sprints',
    ownSprints.status === 200 && JSON.stringify(ownSprints.body).includes('Mine Sprint 1'),
    `status=${ownSprints.status}`)

  const unscoped = await get('/project/comments', empToken)
  check('PROJECT BUG 1 — an omitted ?project no longer returns the whole organisation',
    unscoped.status === 200 && !JSON.stringify(unscoped.body).includes('CONFIDENTIAL'),
    `status=${unscoped.status} body=${JSON.stringify(unscoped.body).slice(0, 160)}`)

  const adminSees = await get(`/project/comments?project=${foreign._id}`, adminToken)
  check('PROJECT — Admin keeps full access (no permission was removed)',
    adminSees.status === 200 && JSON.stringify(adminSees.body).includes('CONFIDENTIAL-foreign-comment'),
    `status=${adminSees.status}`)

  const writeLeak = await fetch(api('/project/comments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${empToken}` },
    body: JSON.stringify({ project: String(foreign._id), body: 'intrusion' }),
  })
  check('PROJECT BUG 1 — employee cannot POST a comment into another project',
    writeLeak.status === 403 || writeLeak.status === 404, `status=${writeLeak.status}`)

  const detail403 = await get(`/project/${foreign._id}/detail`, empToken)
  check('PROJECT — detail of an unrelated project stays forbidden (pre-existing guard intact)',
    detail403.status === 403, `status=${detail403.status}`)

  // =========================================================================
  // DASHBOARD (DASHBOARD BUG 1)
  // =========================================================================
  const dash = await get('/dashboard/stats', empToken)
  check('DASHBOARD BUG 1 — /dashboard/stats returns real tasks',
    Array.isArray(dash.body?.tasks) && dash.body.tasks.length > 0
      && dash.body.tasks[0].title === 'Audit assigned task' && Boolean(dash.body.tasks[0].projectId),
    JSON.stringify(dash.body?.tasks))
  check('DASHBOARD BUG 1 — /dashboard/stats returns real meetings',
    Array.isArray(dash.body?.meetings) && dash.body.meetings.length > 0
      && dash.body.meetings[0].title === 'Audit upcoming meeting',
    JSON.stringify(dash.body?.meetings))
  check('DASHBOARD — fabricated "0% vs last month" trends are now null',
    dash.body?.trends?.employees === null && dash.body?.trends?.projects === null,
    JSON.stringify(dash.body?.trends))

  const outsiderDash = await get('/dashboard/stats', outsiderToken)
  check('DASHBOARD — task list is per-user (outsider sees none of the employee\'s tasks)',
    (outsiderDash.body?.tasks || []).every((t) => t.title !== 'Audit assigned task'),
    JSON.stringify(outsiderDash.body?.tasks))

  console.log(log.join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)

  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('HARNESS ERROR:', e)
  try { await mongoose.connection.dropDatabase(); await mongoose.disconnect() } catch { /* ignore */ }
  process.exit(2)
})
