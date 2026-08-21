import { Router } from 'express'
import * as M from '../models/hrModels.js'
import { Employee } from '../models/Employee.js'
import { AuditLog } from '../models/adminModels.js'
import { attendanceService } from '../services/attendanceService.js'
import { computePayroll, fillPayrollGaps, comparePayrollMonthDesc, parsePayrollMonth } from '../services/payrollEngine.js'
// PHASE SALARY/BILLING (TASK 4): organisation-wide payroll configuration
// (currently the Overtime Rate per hour), stored on the EXISTING category-keyed
// `Setting` document — see services/payrollSettings.js for why no new model.
import { getPayrollSettings, savePayrollSettings } from '../services/payrollSettings.js'
import { createResourceService } from '../services/resourceFactory.js'
import { buildResourceRouter } from './resourceRouter.js'
import { validators } from '../validators/hrValidators.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
// PHASE ADMIN ATTENDANCE (TASK 3A): reuse the EXISTING audit helper instead of
// calling AuditLog.create() directly, so every audited event in the system is
// written through one function with one shape and one failure policy.
import { audit } from '../utils/password.js'
import { protect, blockClient, authorize } from '../middleware/auth.js'
// PHASE CLIENT PAY/BALANCE (TASK 5): the ONE billing overview routine shared
// with the Client Portal (see services/clientBillingService.js).
import { buildClientBillingOverview } from '../services/clientBillingService.js'

// PHASE ADMIN ATTENDANCE (TASK 3A) — Salary Portal audit constants.
// `context=salary-portal` is sent ONLY by the three Salary Portal pages
// (MySalary, SalaryHistory, SalaryReport) via hrApi.payroll.mySalary(). The
// dashboard Salary widget and the My Profile salary tab read the same endpoint
// without it and are therefore not audited — they are not the portal.
const SALARY_PORTAL_CONTEXT = 'salary-portal'
const SALARY_PORTAL_ACTION = 'Viewed salary portal'
// One visit = one record. React-query refetches and navigation between the
// three portal pages all land inside this window and collapse into the single
// record already written for the visit.
const SALARY_PORTAL_AUDIT_WINDOW_MS = 15 * 60 * 1000

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
const refDataRead = authorize('Admin', 'Manager')

// PHASE SALARY/BILLING (TASK 4) — RBAC for the Overtime Rate.
//
// Configuring what the company pays per overtime hour is a payroll-policy
// decision, so it is restricted to the roles that own payroll in this system:
// Admin and HR (the same pair `buildResourceRouter` defaults its write guard
// to for every HR resource, including /hr/payroll itself). Phase 7.2: HR was
// merged into Manager, which is now the sole payroll-owning staff role.
//
// Employee is deliberately NOT included: an employee must be able to SEE the
// rate their overtime was priced at — and they can, because it is returned
// inside their own computed salary payload from GET /payroll/me/salary — but
// must never be able to change it.
const payrollConfigWrite = authorize('Admin', 'Manager')

const router = Router()

// Authenticate (defense-in-depth; the resource routers also authenticate) and
// keep the external Client role out of the internal HR surface.
router.use(protect, blockClient)

// --- Instantiate a layered service per HR resource ---
// --- PHASE ADMIN/HR PAYROLL + HEADCOUNT (TASKS 1 & 2) -----------------------
// Department and Designation headcounts are DERIVED from the authoritative
// Employee collection instead of read from the stored Department.headcount /
// Designation.count fields (which are only ever written at creation and go
// stale the moment an employee is created, reassigned or deleted). The join
// is by NAME — Employee.department === Department.name and
// Employee.designation === Designation.title — the exact string values the
// employee create/edit forms store from the same dropdowns. One aggregation
// feeds every read path (list / all / get) of both resources, and the count
// is returned under the SAME key the stored schema uses (`headcount` /
// `count`), so the existing Departments / Designations pages and their
// exports render the true number with no frontend change. The stored fields
// themselves are never written here.
const employeeCountsBy = async (field) => {
  const rows = await Employee.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id ?? ''), r.n]))
}
const withLiveHeadcount = (created, { field, key, pick }) => {
  const service = created.service
  const base = {
    list: service.list.bind(service),
    all: service.all.bind(service),
    get: service.get.bind(service),
  }
  return {
    ...created,
    service: {
      ...service,
      async list(query) {
        const result = await base.list(query)
        const counts = await employeeCountsBy(field)
        result.data = result.data.map((d) => ({ ...d, [key]: counts.get(String(pick(d))) ?? 0 }))
        return result
      },
      async all() {
        const counts = await employeeCountsBy(field)
        return (await base.all()).map((d) => ({ ...d, [key]: counts.get(String(pick(d))) ?? 0 }))
      },
      async get(id) {
        const doc = await base.get(id)
        const counts = await employeeCountsBy(field)
        return { ...doc, [key]: counts.get(String(pick(doc))) ?? 0 }
      },
    },
  }
}

const departments = withLiveHeadcount(createResourceService(M.Department, { searchFields: ['name', 'code', 'head'], filterFields: ['status'] }), { field: 'department', key: 'headcount', pick: (d) => d.name })
const designations = withLiveHeadcount(createResourceService(M.Designation, { searchFields: ['title', 'department'], filterFields: ['department'] }), { field: 'designation', key: 'count', pick: (d) => d.title })
const jobs = createResourceService(M.JobOpening, { searchFields: ['title', 'department', 'location'], filterFields: ['department', 'status'] })
const candidates = createResourceService(M.Candidate, { searchFields: ['name', 'position', 'email'], filterFields: ['stage', 'source'] })
const interviews = createResourceService(M.Interview, { searchFields: ['candidate', 'position', 'interviewer'], filterFields: ['status', 'round'] })
const offers = createResourceService(M.Offer, { searchFields: ['candidate', 'position'], filterFields: ['status'] })
const onboarding = createResourceService(M.Onboarding, { searchFields: ['name', 'position'], filterFields: ['department'] })
const payroll = createResourceService(M.Payroll, { searchFields: ['employee', 'empCode', 'department'], filterFields: ['department', 'status'] })
const reviews = createResourceService(M.Review, { searchFields: ['employee', 'department', 'employeeCode'], filterFields: ['department', 'status', 'employee'] })
const movements = createResourceService(M.Movement, { searchFields: ['employee', 'type', 'department'], filterFields: ['type', 'status'] })

// Resolve the logged-in user's own payroll filter (never a client-supplied id).
const selfPayrollFilter = (user) => (user.empCode ? { empCode: user.empCode } : { employee: user.name })

// --- PHASE SALARY/BILLING (TASK 4): payroll configuration ------------------
// Registered before the `/payroll` resource router for the same reason
// `/payroll/me` is: that router's `GET /:id` would otherwise match
// 'payroll-settings' as an id. Kept on a distinct path so it cannot collide.
router.get('/payroll-settings', protect, payrollConfigWrite, asyncHandler(async (req, res) => {
  res.json(await getPayrollSettings())
}))
router.put('/payroll-settings', protect, payrollConfigWrite, asyncHandler(async (req, res) => {
  const saved = await savePayrollSettings(req.body || {})
  await audit(req.user?.name || 'System', 'Updated payroll settings', {
    module: 'Payroll',
    severity: 'Warning',
    ip: req.ip,
  })
  res.json(saved)
}))

// --- Self-serve payslip (any authenticated staff user, their own record only) ---
// Registered BEFORE the generic `/payroll` resource router below: that router's
// `GET /:id` is guarded to Admin/HR only, and would otherwise
// shadow `/payroll/me` (matching it as `:id === 'me'`) and 403 every employee
// before this handler ever ran.
router.get('/payroll/me', protect, asyncHandler(async (req, res) => {
  // Scoped strictly to the authenticated session's own identity — never a
  // client-supplied id/param — so an employee cannot reach another employee's
  // payroll by manipulating input.
  //
  // PHASE SALARY/PROJECT AUDIT (SALARY BUG 3): `.sort({ month: -1 }).limit(12)`
  // sorted the STRING label ("July 2026") alphabetically and then truncated, so
  // the 12 rows returned were not the 12 most recent months. One employee has a
  // handful of payroll rows, so they are fetched and ordered chronologically in
  // memory with the shared comparator before slicing.
  const rows = (await M.Payroll.find(selfPayrollFilter(req.user)).lean())
    .sort(comparePayrollMonthDesc)
    .slice(0, 12)

  // PHASE ADMIN ATTENDANCE (TASK 3A): the unconditional `AuditLog.create({
  // action: 'Viewed payslip' })` that used to sit here is removed for the same
  // reason as the salary-portal one below — see the block comment there. A plain
  // GET of one's own data is not, by itself, an auditable action, and writing a
  // row per request produced audit entries nobody had performed.
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

  // 1) Payroll history, newest month FIRST.
  //
  // PHASE SALARY/PROJECT AUDIT (SALARY BUG 3): `.sort({ month: -1 })` ordered
  // the string label alphabetically, so `history[0]` — which this handler treats
  // as the CURRENT pay period — was whichever month sorted first in the
  // alphabet, not the latest one. Ordered chronologically with the shared
  // payroll-month comparator instead.
  const payrollRows = (await M.Payroll.find(selfPayrollFilter(user)).lean())
    .sort(comparePayrollMonthDesc)
    .slice(0, 24)

  // The payment date genuinely modelled by the schema (`payment_date`, set when
  // a run transitions to Paid) with the record's own updatedAt as the documented
  // fallback for rows written before that field was populated. The previous code
  // only ever used updatedAt while `meta.paymentDateSource` advertised
  // payment_date, so a real payment date stored by HR was ignored.
  const paymentDateOf = (r) => r.payment_date || (r.status === 'Paid' ? r.updatedAt : null)

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

  // 3) Attendance metrics for THE CURRENT CALENDAR MONTH (own data), reusing
  //    the shared personal-summary service so figures match the Attendance page.
  //
  //    PHASE SALARY RECEIVABLE + LOP + OVERTIME — ROOT CAUSE of the "Current
  //    Receivable always ₹0" bug: the range used to follow the LATEST PAYROLL
  //    RECORD's month (`period = parsePayrollMonth(latest?.month)`). Whenever
  //    that newest row belonged to a different month (any earlier payroll run),
  //    the employee's CURRENT-month attendance — including today's check-in —
  //    was ignored entirely, presentDays came out 0, and Current Receivable was
  //    ₹0 even after days worked.
  //
  //    The salary period is ALWAYS the current calendar month (employeeId +
  //    year + month): on the 1st of a month, attendance for the new month is
  //    empty and every attendance-based figure correctly starts at ₹0 (the
  //    monthly reset); as days are worked, payable days and Current Receivable
  //    grow. A payroll row is consulted for salary COMPONENTS only — never for
  //    the period.
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  const attendance = await attendanceService.mySummary(
    user,
    { year: currentYear, month: currentMonth }
  )

  // Phase 7.2 (TASK 3): Overtime is removed — no rate is resolved and the
  // engine pins overtime to 0. The old `resolveOvertimeRate()` call and the
  // `payrollOpts` it fed are gone.

  // 4) Current-period salary: the LATEST Payroll run WHEN it is the current
  //    calendar month; otherwise derive from the employee's stored salary
  //    structure. Never hardcoded.
  //
  //    PHASE SALARY RECEIVABLE + LOP + OVERTIME — MONTHLY RESET: the gate
  //    below is what makes "employeeId + year + month" work. A payroll row
  //    exists only for months a run was executed; when the newest row is any
  //    month other than the current one, it is history and must not be served
  //    as `current` — `current` then comes from the live salary structure,
  //    scoped to THIS month's attendance, and on the 1st shows ₹0 growing as
  //    days are earned.
  const latest = payrollRows[0] || null
  const latestIsCurrentPeriod = latest != null
    && parsePayrollMonth(latest.month)?.year === currentYear
    && parsePayrollMonth(latest.month)?.month === currentMonth
  let current
  if (latest && latestIsCurrentPeriod) {
    // PHASE SALARY/PROJECT AUDIT (SALARY BUG 2) — NET NOT EQUAL TO
    // GROSS MINUS DEDUCTIONS.
    //
    // What used to happen here: each component was merged as
    // `stored || computed`, `totalDeductions` was then re-summed from the merged
    // set (pf + tax + esi + professional_tax + other + LWP), but `net` was taken
    // as `h.net || …` — i.e. the value STORED on the payroll document, which was
    // written from a narrower deduction set (typically gross − pf − tax). The
    // Salary page therefore showed Gross, a Total Deductions that included ESI /
    // Professional Tax / LWP, and a Net that did not subtract them. Worse, the
    // loss-of-pay deduction was displayed but never actually applied to Net for
    // any employee who had a payroll record at all.
    //
    // A second defect fed the same symptom: the merge read `h.*` from the
    // NORMALISED history row, which only carried basic/hra/allowances/gross/pf/
    // tax/net. `h.esi`, `h.professional_tax`, `h.other_deductions`,
    // `h.overtime_*`, `h.lwp_*`, `h.daily_rate` and `h.bonus` were all
    // `undefined`, so any value HR had actually stored for them was silently
    // discarded in favour of the computed one. The raw payroll document is used
    // now.
    //
    // FIX: reuse `fillPayrollGaps()` from the payroll engine — the helper that
    // already existed for exactly this job (it was imported by this file and
    // never called). It fills only missing/zero components from the computed
    // breakdown, keeping HR-entered values authoritative, and then ALWAYS
    // re-derives gross / total_deductions / net from the resulting components.
    // One definition of the arithmetic, and Net is internally consistent by
    // construction.
    // The daily rate that prices a loss-of-pay day comes from `basic`. When the
    // employee has no Employee.salary structure (an HR-only payroll row), fall
    // back to the payslip's OWN components so the rate still reflects what is
    // actually being paid instead of collapsing to zero and silently dropping
    // the LWP deduction.
    // PHASE SALARY STRUCTURE REWORK: `hra`/`allowances` are no longer part of
    // the salary structure — Basic remains 50% of Gross Monthly Salary (the
    // ratio is unchanged; nothing fills the remaining 50% any more). `esi`
    // is included in the fallback the same way `pf` already was, since it is
    // now a stored Employee.salary field too (see models/Employee.js).
    const rateBasis = (struct && (struct.basic || struct.ctc))
      ? struct
      // TASK 5: `tax` is no longer forwarded — computePayroll does not read it,
      // so passing it would be dead payload implying a live deduction.
      : { basic: latest.basic, monthly: latest.monthly, pf: latest.pf, esi: latest.esi }
    const computed = computePayroll(rateBasis, attendance)
    const merged = fillPayrollGaps({
      basic: latest.basic,
      pf: latest.pf, esi: latest.esi,
      other_deductions: latest.other_deductions,
      bonus: latest.bonus,
      daily_rate: latest.daily_rate, hourly_rate: latest.hourly_rate,
      lwp_days: latest.lwp_days,
      // PHASE SALARY/BILLING (TASK 5): `tax` and `professional_tax` are no
      // longer seeded from the stored row — fillPayrollGaps forces them to 0
      // regardless, but not passing them makes the intent explicit at the call
      // site: the display figures are built without them.
      // PHASE LOP SALARY FIX: `lwp_deduction` is deliberately NOT seeded either
      // — fillPayrollGaps recomputes it from the merged `lwp_days` × the daily
      // payable rate, so a stored 0 (written while the full-salary bug was
      // live) cannot produce a full-salary display. The stored Payroll
      // document itself is untouched — this object is assembled per-request
      // for display only.
      //
      // TASK 3/4: `overtime_hours` / `overtime_pay` are likewise not seeded, so
      // uncapped hours or legacy 1.5× pay stored on an old payslip cannot
      // survive into the response. fillPayrollGaps overwrites both from the
      // freshly computed, capped, correctly-priced values.
    }, computed)

    current = {
      month: latest.month,
      // `monthly` is the FIXED Gross Monthly Salary — identical to `gross`
      // (PHASE SALARY RECEIVABLE + LOP + OVERTIME: overtime/bonus are separate
      // lines and never fold into gross). The "Gross Salary" widget binds to
      // this figure.
      monthly: merged.monthly,
      basic: merged.basic,
      daily_rate: merged.daily_rate,
      hourly_rate: merged.hourly_rate,
      // TASK 2/7 — the per-day figures and the days they were applied to, so
      // the UI can explain Current Receivable rather than assert it.
      // PHASE SALARY MONTHLY RECEIVABLE: both `daily_payable_rate` and
      // `daily_payable_amount` are Net Monthly Salary ÷ 30 — the rate prices
      // LOP days at the NET receivable salary, the amount prices the current
      // receivable. `net_monthly_salary` is the FIXED Gross − PF − ESI figure.
      daily_payable_rate: merged.daily_payable_rate,
      daily_payable_amount: merged.daily_payable_amount,
      net_monthly_salary: merged.net_monthly_salary,
      scheduled_working_days: computed.scheduled_working_days,
      present_days: computed.present_days,
      paid_leave_days: computed.paid_leave_days,
      payable_days: merged.payable_days,
      // TASK 3/4 — Phase 7.2 (TASK 3): keys retained, pinned to 0 by the engine.
      overtime_hours: merged.overtime_hours,
      overtime_hours_raw: computed.overtime_hours_raw,
      overtime_rate: merged.overtime_rate,
      overtime_rate_source: computed.overtime_rate_source,
      overtime_pay: merged.overtime_pay,
      lwp_days: merged.lwp_days,
      // PHASE LOP SALARY FIX: the LOP deduction is real again — LOP Days ×
      // Daily Payable Rate, recomputed by fillPayrollGaps from the (possibly
      // stored) lwp_days so a stored 0 written under the old full-salary bug
      // cannot survive. `payable_gross` is the LOP-adjusted base that `gross`
      // and `net` are built from.
      lwp_deduction: merged.lwp_deduction,
      payable_gross: merged.payable_gross,
      // TASK 5/6: Late Entry Days, sourced from attendanceService.mySummary's
      // shift-aware `lateDays` (see attendanceService.js's `isLate` helper) —
      // not re-derived here, so the Salary widgets and the attendance module
      // can never disagree on what counts as late.
      late_days: attendance?.lateDays ?? 0,
      bonus: merged.bonus,
      gross: merged.gross,
      pf: merged.pf,
      esi: merged.esi,
      other_deductions: merged.other_deductions,
      totalDeductions: merged.total_deductions,
      net: merged.net,
      status: latest.status || 'Pending',
      paymentDate: paymentDateOf(latest),
      // PHASE SALARY RECEIVABLE + LOP + OVERTIME: the old
      // `latest.status === 'Paid' ? 0 : …` zeroing is GONE — marking a
      // payslip Paid must not zero the employee's EARNED current-month
      // receivable (and if this row IS the current month it has not been paid
      // yet). The engine's attendance-based figures are reported
      // unconditionally: earned days × Daily Payable Amount, with overtime
      // added exactly once via `current_receivable`.
      receivable: merged.receivable,
      current_receivable: merged.current_receivable,
      receivable_total: merged.receivable_total,
      source: 'payroll',
    }
  } else if (struct && (struct.basic || struct.ctc)) {
    // No current-month payroll run — compute entirely from Employee.salary
    // structure, scoped to the current calendar month's attendance.
    const computed = computePayroll(struct, attendance)
    current = {
      // PHASE SALARY RECEIVABLE + LOP + OVERTIME: label the current calendar
      // month so the page shows the exact period (employeeId + year + month)
      // it is computing, even before a run exists.
      month: now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      // PHASE SALARY STRUCTURE REWORK: `hra`/`allowances` removed. `monthly`
      // is the FIXED Gross Monthly Salary (the "Gross Salary" widget binds to
      // this); `basic` remains 50% of it.
      monthly: computed.monthly,
      basic: computed.basic,
      daily_rate: computed.dailyRate,
      hourly_rate: computed.hourlyRate,
      daily_payable_rate: computed.daily_payable_rate,
      daily_payable_amount: computed.daily_payable_amount,
      net_monthly_salary: computed.net_monthly_salary,
      scheduled_working_days: computed.scheduled_working_days,
      present_days: computed.present_days,
      paid_leave_days: computed.paid_leave_days,
      payable_days: computed.payable_days,
      // TASK 3/4 — Phase 7.2 (TASK 3): keys retained, pinned to 0 by the engine.
      overtime_hours: computed.overtime_hours,
      overtime_hours_raw: computed.overtime_hours_raw,
      overtime_rate: computed.overtime_rate,
      overtime_rate_source: computed.overtime_rate_source,
      overtime_pay: computed.overtime_pay,
      lwp_days: computed.lwp_days,
      lwp_deduction: computed.lwp_deduction,
      payable_gross: computed.payable_gross,
      late_days: attendance?.lateDays ?? 0,
      bonus: computed.bonus,
      gross: computed.gross,
      pf: computed.pf,
      esi: computed.esi,
      other_deductions: computed.other_deductions,
      totalDeductions: computed.total_deductions,
      net: computed.net,
      status: 'Not Processed',
      paymentDate: null,
      receivable: computed.receivable,
      current_receivable: computed.current_receivable,
      receivable_total: computed.receivable_total,
      source: 'computed',
    }
  } else {
    current = null
  }

  // 5) History rows for the Salary History table and the Salary Report rollup.
  //
  // PHASE SALARY/PROJECT AUDIT (SALARY BUG 2, second half) — "salary report
  // totals not matching salary details". The history row was built as
  // `deductions = gross − net` from the stored document while the Salary page
  // built Total Deductions from a different (wider) component set, so the two
  // screens disagreed about the SAME month. Each row now derives its totals from
  // its OWN stored components with one rule, and the row for the period rendered
  // as `current` is served the identical figures `current` carries, so the
  // summary, the history table and the report rollup can no longer diverge.
  //
  // Historical rows are deliberately NOT re-costed against today's attendance:
  // a closed payslip is a record, and recomputing last quarter's loss-of-pay
  // from live attendance data would rewrite history.
  //
  // PHASE SALARY/BILLING (TASK 5): this is ALSO why the fallback sum below still
  // includes `tax`, `professional_tax` and `lwp_deduction`. Those three are no
  // longer APPLIED to current salary — the row rendered as `current` takes its
  // figures from `current.totalDeductions`, which excludes them by construction
  // — but a payslip HR already ran and paid recorded them, and reporting a
  // different total for a closed month would misstate what was actually paid.
  // The brief is explicit that historical records must not be destroyed and that
  // historical recalculation is not required.
  const history = payrollRows.map((r) => {
    const isCurrent = current?.source === 'payroll' && String(r._id) === String(latest._id)
    // PHASE SALARY STRUCTURE REWORK: `r.hra` / `r.allowances` are read here
    // ONLY as a historical-compatibility fallback for payslips that were run
    // BEFORE this change and genuinely have those values stored on disk (the
    // fields are no longer declared on payrollSchema going forward, but
    // Mongoose still returns whatever an existing document has for an
    // undeclared path, so `r.hra`/`r.allowances` safely reads as `undefined`
    // -> `|| 0` on any row written after this change). This is NOT a live
    // code path for new payslips: computePayroll/fillPayrollGaps never
    // produce hra/allowances any more, so `r.gross` (written by them) is
    // always preferred over this fallback for current data. The brief is
    // explicit that historical records must not be destroyed or recalculated.
    const gross = isCurrent
      ? current.gross
      : (r.gross ?? ((r.basic || 0) + (r.hra || 0) + (r.allowances || 0) + (r.overtime_pay || 0) + (r.bonus || 0)))
    const deductions = isCurrent
      ? current.totalDeductions
      : (r.total_deductions
        || ((r.pf || 0) + (r.tax || 0) + (r.esi || 0) + (r.professional_tax || 0)
          + (r.other_deductions || 0) + (r.lwp_deduction || 0)))
    const net = isCurrent ? current.net : (r.net ?? Math.max(0, gross - deductions))
    return {
      id: String(r._id),
      month: r.month,
      basic: r.basic || 0,
      gross,
      pf: r.pf || 0,
      tax: r.tax || 0,
      deductions,
      net,
      status: r.status || 'Pending',
      paymentDate: paymentDateOf(r),
    }
  })

  // -------------------------------------------------------------------------
  // PHASE ADMIN ATTENDANCE (TASK 3A) — FALSE "Salary Portal" AUDIT RECORDS
  //
  // TRACE: Admin -> Audit Log (pages/admin/AuditLogs.jsx)
  //        -> GET /api/admin/audit-logs -> AuditLog collection
  //        -> written by this handler, GET /api/hr/payroll/me/salary.
  //
  // ROOT CAUSE: this handler used to run an UNCONDITIONAL
  //     AuditLog.create({ action: 'Viewed salary portal', module: 'Payroll' })
  // on every request. But this endpoint is NOT the Salary Portal — it is the
  // shared self-salary data source, and five different surfaces read it:
  //     1. pages/MySalary.jsx            -> /salary          (the actual portal)
  //     2. pages/salary/SalaryHistory    -> /salary/history  (portal)
  //     3. pages/salary/SalaryReport     -> /salary/report   (portal)
  //     4. pages/Profile.jsx             -> My Profile, Salary tab   (NOT portal)
  //     5. features/dashboard/widgets/SalaryWidget.jsx -> Dashboard  (NOT portal)
  // Cases 4 and 5 mount automatically: the Salary widget renders as part of the
  // dashboard every staff user lands on after login. So simply logging in and
  // seeing your own dashboard minted a "Viewed salary portal" record — for every
  // user, exactly as reported, without anyone ever opening the Salary Portal.
  // It also re-fired on every react-query refetch and every remount, so one real
  // visit produced several identical rows.
  //
  // FIX (at the point of creation, not by filtering the Admin page):
  //   * The event is now recorded ONLY when the request actually originates from
  //     a Salary Portal page, which declares itself with `?context=salary-portal`
  //     (hrApi.payroll.mySalary({ context: 'salary-portal' })). The dashboard
  //     widget and the profile tab send nothing and so produce no audit record.
  //     The server cannot otherwise know which screen issued a read; this flag
  //     is a provenance label, NOT an access control — it grants nothing, and the
  //     worst a forged value can do is record that the caller looked at their own
  //     salary, which they just did.
  //   * Repeat reads inside one visit collapse into a single record (see the
  //     de-duplication window below), so a refetch or a hop between the three
  //     portal pages no longer multiplies the trail.
  //   * The EXISTING audit helper (utils/password.js `audit`) is reused rather
  //     than a second AuditLog.create, so the actor/user/module/severity shape
  //     stays identical to every other audited event and failures stay
  //     non-fatal to the primary request.
  if (String(req.query.context || '') === SALARY_PORTAL_CONTEXT) {
    const since = new Date(Date.now() - SALARY_PORTAL_AUDIT_WINDOW_MS)
    const already = await AuditLog.exists({
      user: user.name || 'Unknown',
      action: SALARY_PORTAL_ACTION,
      at: { $gte: since },
    })
    if (!already) {
      await audit(user.name || 'Unknown', SALARY_PORTAL_ACTION, {
        user: user.name || 'Unknown',
        module: 'Payroll',
        severity: 'Info',
        ip: req.ip,
      })
    }
  }

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
      // PHASE SALARY/BILLING (TASK 5): Professional Tax and TDS/Tax are no
      // longer part of the salary calculation. Reported as explicit `false`
      // rather than deleted so a consumer can tell "not applied" apart from
      // "unknown". `lwpDeductionTracked` is TRUE: loss-of-pay IS applied —
      // LOP Pay Amount (LOP Days × Daily Payable Rate) is a literal member of
      // `total_deductions` (PF + ESI + LOP Pay [+ other]).
      professionalTaxTracked: false,
      incomeTaxTracked: false,
      lwpDeductionTracked: true,
      removedDeductions: ['professional_tax', 'tax'],
      // Phase 7.2 (TASK 3): Overtime is removed — no rate, cap or source is
      // reported any more.
      paymentDateSource: 'Payroll.payment_date or updatedAt when Paid',
      salarySource: current?.source || 'none',
      // PHASE SALARY/PROJECT AUDIT (SALARY BUG 6) — MISSING RESPONSE FIELD.
      // pages/MySalary.jsx reads `meta.attendanceBasis` and renders an
      // explanation of exactly which attendance figures produced the loss-of-pay
      // deduction (`basis.payableAbsentDays`, `.expectedWorkingDays`,
      // `.companyHolidays`, `.presentDays`, `.approvedLeaveDays`). The server
      // never sent the key, so `basis` was always `{}`, `Number(undefined) > 0`
      // was always false, and the entire "About some figures" card was
      // unreachable UI. This is a plain response-contract gap: every value below
      // was already computed by attendanceService.mySummary() and is passed
      // straight through — nothing new is calculated.
      attendanceBasis: {
        from: attendance?.from ?? null,
        to: attendance?.to ?? null,
        expectedWorkingDays: attendance?.expectedWorkingDays ?? 0,
        elapsedWorkingDays: attendance?.elapsedWorkingDays ?? 0,
        companyHolidays: attendance?.holidayDays ?? 0,
        presentDays: attendance?.presentDays ?? 0,
        approvedLeaveDays: attendance?.paidLeaveDays ?? attendance?.leaveDays ?? 0,
        unpaidLeaveDays: attendance?.unpaidLeaveDays ?? 0,
        recordedAbsentDays: attendance?.absentDays ?? 0,
        unrecordedDays: attendance?.unrecordedDays ?? 0,
        payableAbsentDays: attendance?.payableAbsentDays ?? 0,
      },
    },
  })
}))

// PHASE PAYROLL (TASK 4) — "Cannot create payroll for an employee".
//
// ROOT CAUSE: the Payroll.jsx HR page had NO create UI at all — only a read-only
// table of existing Payroll documents. The backend DID have POST /hr/payroll
// (via buildResourceRouter), but it simply persisted whatever payload it received
// without computing salary from the engine, and the page never called it.
// The result: "I cannot create payroll for an employee" — there was no button.
//
// FIX: a dedicated POST /hr/payroll/run endpoint that:
//   1. Resolves the employee by id (reusing the Employee model already imported).
//   2. Resolves the employee's salary structure (Employee.salary).
//   3. Gets attendance metrics for the requested month/period via the EXISTING
//      attendanceService.mySummary() — the single source of truth.
//   4. Calls computePayroll() — the ONE salary calculation engine, reused.
//   5. Saves the computed breakdown as a Payroll document (deduplicated by month).
//   6. Invalidates the realtime cache so the Payroll table refreshes.
//
// Route is declared BEFORE the generic `/payroll` resource router so `/run` does
// not shadow as a `:id` parameter.
// ---------------------------------------------------------------------------
router.post(
  '/payroll/run',
  payrollConfigWrite,
  asyncHandler(async (req, res) => {
    const { employee, month, bonus, otherDeductions } = req.body
    if (!employee) throw new ApiError(400, 'Employee is required')
    if (!month) throw new ApiError(400, 'Payroll month is required')
    const emp = await Employee.findById(employee).lean()
    if (!emp) throw new ApiError(404, 'Employee not found')

    // Duplicate-prevention: one payroll row per employee per month. Payroll rows
    // store `employee` as the employee NAME (emp.name), not the id the client
    // sent, so the check must match the resolved employee, or a second run for
    // the same person+month would slip through and mint a duplicate payslip.
    const existing = await M.Payroll.findOne({ employee: emp.name, month: { $regex: `^${month}$`, $options: 'i' } })
    if (existing) {
      throw new ApiError(409, `Payroll for ${emp.name} (${month}) already exists.`)
    }

    // Resolve the payroll month to a year/month for the attendance range.
    const parsed = parsePayrollMonth(month)

    // PHASE ADMIN/HR PAYROLL + HEADCOUNT (TASK 4): an employee's payroll can
    // only run for months from their joining month onwards — the same bound
    // the Run Payroll month dropdown offers on the client. Employees without
    // a joiningDate carry no bound and keep their previous behaviour.
    if (emp.joiningDate && parsed.year != null) {
      const join = new Date(emp.joiningDate)
      if (parsed.year * 12 + parsed.month < join.getFullYear() * 12 + join.getMonth()) {
        const joinLabel = join.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        throw new ApiError(400, `Payroll for ${emp.name} cannot run for ${month} — it is before their joining month (${joinLabel}).`)
      }
    }

    // Resolve the salary structure — the engine accepts Employee.salary shape.
    const struct = emp.salary || {}
    // Phase 7.2 (TASK 3): Overtime is removed — the old resolveOvertimeRate()
    // lookup is gone and the engine prices overtime at 0.

    let attendance = {}
    if (parsed.year != null) {
      // attendanceService.mySummary accepts { year, month } (month 0-based).
      attendance = await attendanceService.mySummary(emp, {
        year: parsed.year, month: parsed.month,
      }) || {}
    }

    // Compute the full breakdown through the ONE shared engine.
    const computed = computePayroll(struct, attendance, {
      bonus: Number(bonus) || 0,
      otherDeductions: Number(otherDeductions) || 0,
    })

    // Persist the computed payslip.
    const doc = await M.Payroll.create({
      employee: emp.name,
      empCode: emp.empCode || '',
      department: emp.department || '',
      designation: emp.designation || '',
      month,
      // Base salary components.
      monthly: computed.monthly,
      basic: computed.basic,
      pf: computed.pf,
      esi: computed.esi,
      // Computed rates (stored for immutability on the payslip).
      daily_rate: computed.dailyRate,
      hourly_rate: computed.hourlyRate,
      // Overtime.
      overtime_hours: computed.overtime_hours,
      overtime_pay: computed.overtime_pay,
      // Loss of Pay.
      lwp_days: computed.lwp_days,
      lwp_deduction: computed.lwp_deduction,
      // Bonuses / extras.
      bonus: computed.bonus,
      other_deductions: computed.other_deductions,
      // Totals.
      gross: computed.gross,
      total_deductions: computed.total_deductions,
      net: computed.net,
      // Attendance snapshot.
      working_days: computed.scheduled_working_days,
      present_days: computed.present_days,
      leave_days: computed.paid_leave_days ?? computed.leave_days,
      late_days: attendance?.lateDays ?? 0,
      status: 'Pending',
    })

    // Realtime: invalidate the payroll list + the self-salary cache.
    const { emitResource } = await import('../realtime/index.js')
    emitResource('hr', 'create', doc)
    emitResource('hr', 'payroll-created', doc)

    res.status(201).json({ ...doc.toObject(), id: String(doc._id) })
  })
)

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
// Reviews: readGuard widened to refDataRead (Admin/HR/Manager) - the Employee
// Details "Reviews" tab is a Manager-visible surface and must render the real
// Review collection, so the Manager token needs read access to GET /hr/reviews.
// Writes (POST/PUT/DELETE) keep the default Admin/HR writeGuard.
router.use('/reviews', buildResourceRouter(reviews.service, { validate: validators.review, readGuard: refDataRead }))
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
// PHASE HR (TASK 3) + RBAC: this endpoint aggregates ORGANISATION-WIDE figures
// (headcount, candidates, open jobs, payroll totals). Every consumer is an
// Admin/HR surface (HR.jsx, Recruitment.jsx, HrReports.jsx — all gated to
// Admin/HR in routes/index.jsx), so read access is restricted to those two
// roles — an Employee token previously received 200 with the org-wide payroll
// total, which is internal data.
router.get('/stats', protect, authorize('Admin', 'Manager'), asyncHandler(async (req, res) => {
  const groupBy = (Model, field) => Model.aggregate([
    { $group: { _id: `$${field}`, value: { $sum: 1 } } },
    { $project: { _id: 0, name: '$_id', value: 1 } },
  ])

  // PHASE HR (TASK 3) ROOT CAUSE FIX: "Headcount shows 0"
  //
  // TRACE: pages/HR.jsx -> hrApi.stats() -> GET /hr/stats -> here.
  //
  // ROOT CAUSE: headcount was computed from `Department.headcount`, a static
  // integer field seeded at creation time (e.g. `headcount: 6 + i * 2`). That
  // field is NOT linked to the Employee collection — it is never updated when an
  // employee is hired, leaves, or is deleted. If the Department documents had
  // not been seeded, or if their `headcount` fields were 0 (the schema default),
  // the sum was 0, which is exactly what the HR dashboard showed.
  //
  // FIX: derive headcount from the Employee collection — the system of record
  // for actual people. `Employee.countDocuments()` gives the true total across
  // every status (Active / On Leave / Inactive), and the per-department
  // aggregation counts real Employee documents grouped by `department`. The
  // Department.headcount column is left untouched — it is informational and
  // still rendered on the Departments page.
  const [depts, headByDept, byStage, openJobs, interviewsScheduled, pendingOffers, onboardingCount, pendingReviews, attrition, payrollAgg] = await Promise.all([
    M.Department.countDocuments(),
    Employee.aggregate([{ $group: { _id: '$department', value: { $sum: 1 } } }, { $project: { _id: 0, name: '$_id', value: 1 } }]),
    groupBy(M.Candidate, 'stage'),
    M.JobOpening.countDocuments({ status: 'Open' }),
    M.Interview.countDocuments({ status: 'Scheduled' }),
    M.Offer.countDocuments({ status: { $in: ['Pending', 'Sent'] } }),
    M.Onboarding.countDocuments(),
    M.Review.countDocuments({ status: { $ne: 'Completed' } }),
    M.Movement.countDocuments({ type: { $in: ['Resignation', 'Exit'] } }),
    M.Payroll.aggregate([{ $group: { _id: null, total: { $sum: '$net' } } }]),
  ])

  // Real headcount: count actual Employee documents, not the static
  // Department.headcount field. Falls back to the department-aggregate sum so
  // the per-dept breakdown and the total always agree.
  const totalHeadcount = await Employee.countDocuments()
  // Prefer the live aggregate; only fall back if the collection itself is empty.
  const headByDeptFinal = headByDept.length ? headByDept : (totalHeadcount ? [{ name: 'Unassigned', value: totalHeadcount }] : headByDept)
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
    headcountByDept: headByDeptFinal,
    byStage: byStage.filter((s) => s.name !== 'Rejected'),
  })
}))

// PHASE CLIENT PAY/BALANCE (TASK 5) — Admin/HR client billing overview.
//
// Powers the new "Client Pay/Balance" HR module (pages/hr/ClientBilling.jsx).
// Every figure comes from services/clientBillingService.js — the SAME
// buildBillingRows() + summarizeBilling() that feed the Client Portal's
// GET /client/payments — so the HR screen and the client's own portal always
// agree. Restricted to Admin/HR: client money data is internal, like every
// other /hr/* read. This router already runs `protect` + `blockClient` for the
// whole mount, and the per-route `authorize` adds the role gate.
// ---------------------------------------------------------------------------
router.get('/client-billing', protect, authorize('Admin', 'Manager'), asyncHandler(async (req, res) => {
  res.json(await buildClientBillingOverview())
}))

export default router
