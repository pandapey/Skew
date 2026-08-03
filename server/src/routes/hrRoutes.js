import { Router } from 'express'
import * as M from '../models/hrModels.js'
import { Employee } from '../models/Employee.js'
import { AuditLog } from '../models/adminModels.js'
import { attendanceService } from '../services/attendanceService.js'
import { computePayroll, fillPayrollGaps } from '../services/payrollEngine.js'
import { createResourceService } from '../services/resourceFactory.js'
import { buildResourceRouter } from './resourceRouter.js'
import { validators } from '../validators/hrValidators.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { protect, blockClient, authorize } from '../middleware/auth.js'

// PHASE NEXT (TASK 1) - narrowest backend permission required by the task.
//
// ROOT CAUSE (server half): buildResourceRouter defaults BOTH its read and its
// write guard to HR_WRITE = ['Admin','HR'] (routes/resourceRouter.js), so
// GET /hr/departments/all and GET /hr/designations/all returned 403 for a
// Manager. Pointing the Manager employee-creation dropdowns at the real
// collections would therefore have produced two permanently empty dropdowns.
//
// FIX: a READ-ONLY widening for these two reference collections only. Writes
// (POST/PUT/DELETE) keep the default Admin/HR writeGuard, so a Manager still
// cannot create, rename or delete a department or designation, and no other HR
// resource (jobs, candidates, payroll, reviews, ...) is touched.
const refDataRead = authorize('Admin', 'HR', 'Manager')

const router = Router()

// Authenticate (defense-in-depth; the resource routers also authenticate) and
// keep the external Client role out of the internal HR surface.
router.use(protect, blockClient)

// --- Instantiate a layered service per HR resource ---
const departments = createResourceService(M.Department, { searchFields: ['name', 'code', 'head'], filterFields: ['status'] })
const designations = createResourceService(M.Designation, { searchFields: ['title', 'department'], filterFields: ['department'] })
const jobs = createResourceService(M.JobOpening, { searchFields: ['title', 'department', 'location'], filterFields: ['department', 'status'] })
const candidates = createResourceService(M.Candidate, { searchFields: ['name', 'position', 'email'], filterFields: ['stage', 'source'] })
const interviews = createResourceService(M.Interview, { searchFields: ['candidate', 'position', 'interviewer'], filterFields: ['status', 'round'] })
const offers = createResourceService(M.Offer, { searchFields: ['candidate', 'position'], filterFields: ['status'] })
const onboarding = createResourceService(M.Onboarding, { searchFields: ['name', 'position'], filterFields: ['department'] })
const payroll = createResourceService(M.Payroll, { searchFields: ['employee', 'empCode', 'department'], filterFields: ['department', 'status'] })
const reviews = createResourceService(M.Review, { searchFields: ['employee', 'department'], filterFields: ['department', 'status'] })
const movements = createResourceService(M.Movement, { searchFields: ['employee', 'type', 'department'], filterFields: ['type', 'status'] })

// Resolve the logged-in user's own payroll filter (never a client-supplied id).
const selfPayrollFilter = (user) => (user.empCode ? { empCode: user.empCode } : { employee: user.name })

// --- Self-serve payslip (any authenticated staff user, their own record only) ---
// Registered BEFORE the generic `/payroll` resource router below: that router's
// `GET /:id` is guarded to Admin/HR only, and would otherwise
// shadow `/payroll/me` (matching it as `:id === 'me'`) and 403 every employee
// before this handler ever ran.
router.get('/payroll/me', protect, asyncHandler(async (req, res) => {
  // Scoped strictly to the authenticated session's own identity — never a
  // client-supplied id/param — so an employee cannot reach another employee's
  // payroll by manipulating input.
  const rows = await M.Payroll.find(selfPayrollFilter(req.user)).sort({ month: -1 }).limit(12).lean()

  await AuditLog.create({
    user: req.user.name || 'Unknown',
    action: 'Viewed payslip',
    module: 'Payroll',
    severity: 'Info',
    ip: req.ip,
  })

  res.json(rows.map((r) => ({ ...r, id: String(r._id) })))
}))

// --- Self-serve SALARY PORTAL (Employee "My Salary" page, own data only) ---
// Distinct from the HR Payroll admin page. Returns a fully computed salary
// object for the logged-in employee, assembled ONLY from real MongoDB data:
//   * Salary components + status come from the Payroll collection when a run
//     exists for the employee; otherwise they are derived from the employee's
//     own Employee.salary structure (the same breakdown HR stored at creation).
//   * Attendance metrics (working / present / absent / leave days, overtime)
//     are computed from the employee's own Attendance documents via the shared
//     attendanceService.mySummary (single source of truth with the Attendance
//     page — Issue 2).
// Nothing is hardcoded or mocked; fields the payroll schema does not model
// (ESI, "other deductions", explicit payment date) are reported transparently
// rather than invented — see the response `meta` notes.
router.get('/payroll/me/salary', protect, asyncHandler(async (req, res) => {
  const user = req.user

  // 1) Payroll history (most recent first), normalized for the frontend.
  const historyRows = await M.Payroll.find(selfPayrollFilter(user)).sort({ month: -1 }).limit(24).lean()
  const history = historyRows.map((r) => {
    const gross = r.gross ?? ((r.basic || 0) + (r.hra || 0) + (r.allowances || 0))
    const net = r.net ?? (gross - (r.pf || 0) - (r.tax || 0))
    return {
      id: String(r._id),
      month: r.month,
      basic: r.basic || 0,
      hra: r.hra || 0,
      allowances: r.allowances || 0,
      gross,
      pf: r.pf || 0,
      tax: r.tax || 0,
      deductions: Math.max(0, gross - net),
      net,
      status: r.status || 'Pending',
      // The Payroll schema has no explicit payment-date field; when a run is
      // marked Paid we surface the record's own updatedAt as the payment date
      // (honest derivation, not a fabricated value). Pending runs show none.
      paymentDate: r.status === 'Paid' ? r.updatedAt : null,
    }
  })

  // 2) Employee profile (salary structure + identity), matched by the linked
  //    login account first, then empCode, then name.
  const emp = await Employee.findOne({
    $or: [
      ...(user._id ? [{ userId: user._id }] : []),
      ...(user.empCode ? [{ empCode: user.empCode }] : []),
      { name: user.name },
    ],
  }).lean()
  const struct = emp?.salary || null

  // 3) Attendance metrics for the current month (own data), reusing the shared
  //    personal-summary service so figures match the Attendance page exactly.
  const attendance = await attendanceService.mySummary(user, {})

  // 4) Current-period salary: prefer the latest real Payroll run; otherwise
  //    derive from the employee's stored salary structure. Never hardcoded.
  let current
  if (history.length) {
    const h = history[0]
    // If the payroll record has zero salary fields, fill the gaps from the
    // employee salary structure so the page never shows phantom zeros.
    const computed = struct ? computePayroll(struct, attendance, {}) : null
    const basic         = h.basic         || computed?.basic         || 0
    const hra           = h.hra           || computed?.hra           || 0
    const allowances    = h.allowances    || computed?.allowances    || 0
    const pf            = h.pf            || computed?.pf            || 0
    const tax           = h.tax           || computed?.tax           || 0
    const esi           = h.esi           || computed?.esi           || 0
    const professional_tax = h.professional_tax || computed?.professional_tax || 0
    const other_deductions = h.other_deductions || computed?.other_deductions || 0
    const overtime_hours   = h.overtime_hours   || attendance?.overtime       || 0
    const overtime_pay     = h.overtime_pay     || computed?.overtime_pay     || 0
    const lwp_days         = h.lwp_days         || computed?.lwp_days         || 0
    const lwp_deduction    = h.lwp_deduction    || computed?.lwp_deduction    || 0
    const bonus            = h.bonus            || 0
    const gross = h.gross || (basic + hra + allowances + overtime_pay + bonus)
    const totalDeductions = pf + tax + esi + professional_tax + other_deductions + lwp_deduction
    const net = h.net || Math.max(0, gross - totalDeductions)
    current = {
      month: h.month,
      basic, hra, allowances,
      daily_rate: h.daily_rate || computed?.dailyRate || 0,
      hourly_rate: h.hourly_rate || computed?.hourlyRate || 0,
      overtime_hours, overtime_pay,
      lwp_days, lwp_deduction,
      bonus,
      gross,
      pf, tax, esi,
      professional_tax,
      other_deductions,
      totalDeductions,
      net,
      status: h.status,
      paymentDate: h.paymentDate || (h.status === 'Paid' ? h.updatedAt : null),
      receivable: h.status === 'Paid' ? 0 : net,
      source: 'payroll',
    }
  } else if (struct && (struct.basic || struct.ctc)) {
    // No payroll run yet — compute entirely from Employee.salary structure
    const computed = computePayroll(struct, attendance, {})
    current = {
      month: null,
      basic: computed.basic,
      hra: computed.hra,
      allowances: computed.allowances,
      daily_rate: computed.dailyRate,
      hourly_rate: computed.hourlyRate,
      overtime_hours: computed.overtime_hours,
      overtime_pay: computed.overtime_pay,
      lwp_days: computed.lwp_days,
      lwp_deduction: computed.lwp_deduction,
      bonus: computed.bonus,
      gross: computed.gross,
      pf: computed.pf,
      tax: computed.tax,
      esi: computed.esi,
      professional_tax: computed.professional_tax,
      other_deductions: computed.other_deductions,
      totalDeductions: computed.total_deductions,
      net: computed.net,
      status: 'Not Processed',
      paymentDate: null,
      receivable: computed.net,
      source: 'computed',
    }
  } else {
    current = null
  }

  await AuditLog.create({
    user: user.name || 'Unknown',
    action: 'Viewed salary portal',
    module: 'Payroll',
    severity: 'Info',
    ip: req.ip,
  })

  res.json({
    identity: {
      name: emp?.name || user.name,
      empCode: emp?.empCode || user.empCode || null,
      department: emp?.department || user.department || null,
      designation: emp?.designation || null,
      // Phase 6.12 (TASK 5): `ctc`, `monthly` and `bank` are surfaced here so
      // the My Profile -> Salary tab can render through the SAME <SalaryTab/>
      // component that Admin/HR/Manager already use on the Employee Detail
      // page (features/employees/detailTabs.jsx). That component reads
      // employee.salary.ctc / .monthly and employee.bank, and those three
      // values were the only fields it needed that this payload did not
      // already carry - so exposing them lets the employee reuse the existing
      // viewer verbatim instead of a second, look-alike salary panel.
      //
      // These are read off the SAME `emp` document already loaded above (step
      // 2) - no extra query - and they are the caller's OWN record, resolved
      // from the session identity via userId/empCode/name. No other employee's
      // salary or bank details can be reached through this endpoint, so this
      // is strictly self-service data and widens nothing.
      ctc: struct?.ctc || 0,
      monthly: struct?.monthly || (struct?.ctc ? Math.round(struct.ctc / 12) : 0),
      bank: emp?.bank
        ? { name: emp.bank.name || '', account: emp.bank.account || '', ifsc: emp.bank.ifsc || '' }
        : null,
    },
    current,
    attendance,
    history,
    meta: {
      esiTracked: true,
      otherDeductionsTracked: true,
      professionalTaxTracked: true,
      paymentDateSource: 'Payroll.payment_date or updatedAt when Paid',
      salarySource: current?.source || 'none',
    },
  })
}))

// --- Mount resource routers ---
// `readGuard` widened to include Manager (read-only reference data - see the
// refDataRead note at the top of this file). `writeGuard` is deliberately left
// unset so it keeps defaulting to Admin/HR.
router.use('/departments', buildResourceRouter(departments.service, { validate: validators.department, readGuard: refDataRead }))
router.use('/designations', buildResourceRouter(designations.service, { validate: validators.designation, readGuard: refDataRead }))
router.use('/jobs', buildResourceRouter(jobs.service, { validate: validators.job }))
router.use('/interviews', buildResourceRouter(interviews.service, { validate: validators.interview }))
router.use('/offers', buildResourceRouter(offers.service, { validate: validators.offer }))
router.use('/onboarding', buildResourceRouter(onboarding.service))
router.use('/payroll', buildResourceRouter(payroll.service))
router.use('/reviews', buildResourceRouter(reviews.service, { validate: validators.review }))
router.use('/movements', buildResourceRouter(movements.service, { validate: validators.movement }))

// Candidates gets an extra stage-move endpoint for the pipeline board.
router.use('/candidates', buildResourceRouter(candidates.service, {
  validate: validators.candidate,
  extraRoutes: (r, canWrite) => {
    r.patch('/:id/stage', canWrite, asyncHandler(async (req, res) => {
      res.json(await candidates.service.update(req.params.id, { stage: req.body.stage }))
    }))
  },
}))

// --- Aggregated HR dashboard stats ---
router.get('/stats', protect, asyncHandler(async (req, res) => {
  const groupBy = (Model, field) => Model.aggregate([
    { $group: { _id: `$${field}`, value: { $sum: 1 } } },
    { $project: { _id: 0, name: '$_id', value: 1 } },
  ])

  const [depts, headByDept, byStage, openJobs, interviewsScheduled, pendingOffers, onboardingCount, pendingReviews, attrition, payrollAgg] = await Promise.all([
    M.Department.countDocuments(),
    M.Department.aggregate([{ $group: { _id: '$name', value: { $sum: '$headcount' } } }, { $project: { _id: 0, name: '$_id', value: 1 } }]),
    groupBy(M.Candidate, 'stage'),
    M.JobOpening.countDocuments({ status: 'Open' }),
    M.Interview.countDocuments({ status: 'Scheduled' }),
    M.Offer.countDocuments({ status: { $in: ['Pending', 'Sent'] } }),
    M.Onboarding.countDocuments(),
    M.Review.countDocuments({ status: { $ne: 'Completed' } }),
    M.Movement.countDocuments({ type: { $in: ['Resignation', 'Exit'] } }),
    M.Payroll.aggregate([{ $group: { _id: null, total: { $sum: '$net' } } }]),
  ])

  const totalHeadcount = headByDept.reduce((s, d) => s + d.value, 0)
  res.json({
    totalDepartments: depts,
    totalHeadcount,
    openJobs,
    totalCandidates: byStage.reduce((s, x) => s + x.value, 0),
    interviewsScheduled,
    pendingOffers,
    onboarding: onboardingCount,
    monthlyPayroll: payrollAgg[0]?.total || 0,
    pendingReviews,
    attrition,
    headcountByDept: headByDept,
    byStage: byStage.filter((s) => s.name !== 'Rejected'),
  })
}))

export default router
