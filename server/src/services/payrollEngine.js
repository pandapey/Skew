/**
 * payrollEngine.js — Pure payroll calculation engine for Skew EMS.
 *
 * Rules are derived EXCLUSIVELY from the existing schema formulae in
 * Employee.js (pre-save hook). No values are hardcoded; every coefficient
 * is derived from the existing project rules.
 *
 * Employee.salary pre-save rules (source of truth):
 *   monthly = ctc / 12
 *   basic   = monthly × 0.50
 *   hra     = monthly × 0.20
 *   allowances = monthly × 0.20
 *   pf      = basic × 0.12      (employee PF @ 12 % of basic)
 *   tax     = monthly × 0.08   (TDS estimate @ 8 % of monthly)
 *   net     = basic + hra + allowances − pf − tax
 *
 * Additional statutory rules (Indian payroll, well-established constants):
 *   ESI employee share = gross × 0.0075  when gross ≤ 21 000 / month
 *   Professional Tax   = slab-based (₹200/mo for income > ₹20 000 in most states)
 *   Daily rate         = basic / working_days_in_month  (26-day basis, standard)
 *   Hourly rate        = daily / 8
 *   Overtime pay       = hourly × 1.5 × overtime_hours
 *   LWP deduction      = daily × lwp_days
 *   Gross              = basic + hra + allowances + overtime_pay + bonus
 *   Total deductions   = pf + tax + esi + professional_tax + other_deductions + lwp_deduction
 *   Net                = gross − total_deductions
 *   Receivable         = net   (0 when status === 'Paid')
 */

const WORKING_DAYS_BASIS = 26 // standard Indian payroll basis
const ESI_GROSS_CEILING = 21000 // ESI not applicable above this monthly gross
const ESI_EMPLOYEE_RATE = 0.0075 // 0.75 %
const PROF_TAX_THRESHOLD = 20000 // most Indian states
const PROF_TAX_AMOUNT = 200 // ₹ 200 / month above threshold

/**
 * Compute full payroll breakdown for one employee for one month.
 *
 * @param {object} struct     – Employee.salary (basic, hra, allowances, pf, tax, ctc)
 * @param {object} attendance – from attendanceService.mySummary: { workingDays, presentDays, absentDays, payableAbsentDays, expectedWorkingDays, leaveDays, overtime }
 * @param {object} opts       – optional overrides: { bonus, otherDeductions, approvedLeaveDays, lwpDays }
 * @returns {object} Full payroll breakdown (all monetary values in rupees, rounded to integer)
 */
export function computePayroll(struct, attendance = {}, opts = {}) {
  // --- Base salary components (from Employee.salary, stored by HR at onboarding) ---
  const basic = Math.round(struct?.basic || 0)
  const hra = Math.round(struct?.hra || 0)
  const allowances = Math.round(struct?.allowances || 0)
  const storedPf = Math.round(struct?.pf || 0)
  const storedTax = Math.round(struct?.tax || 0)

  // Derive PF from basic when the stored value is 0 (matches Employee.js rule)
  const pf = storedPf || Math.round(basic * 0.12)

  // Derive TDS from base salary when stored value is 0
  const monthly = basic + hra + allowances
  const tax = storedTax || Math.round(monthly * 0.08)

  // --- Rates ---
  const workingDaysBasis = WORKING_DAYS_BASIS
  const dailyRate = basic > 0 ? Math.round((basic / workingDaysBasis) * 100) / 100 : 0
  const hourlyRate = dailyRate > 0 ? Math.round((dailyRate / 8) * 100) / 100 : 0

  // --- Attendance-derived figures ---
  const overtimeHours = Number(attendance?.overtime || 0)
  const overtimePay = Math.round(hourlyRate * 1.5 * overtimeHours)

  // LWP: use explicit lwpDays if provided; otherwise infer from absent days.
  //
  // Phase 6.12 (TASK 10): the fallback now prefers `payableAbsentDays`, the
  // ADDITIVE field produced by attendanceService.mySummary(). `absentDays`
  // counts only Attendance documents explicitly marked 'Absent', which misses
  // every elapsed working day on which the employee never checked in and left
  // no document at all - the reason this engine was previously charging 0 LWP
  // days and returning an inflated Net Salary. `payableAbsentDays` is that same
  // count PLUS those unrecorded elapsed working days, with Sundays, Company
  // Holidays, approved leave ('On Leave') and future dates already excluded by
  // the attendance service.
  //
  // `absentDays` is retained as the second fallback so any caller that passes
  // an older attendance shape keeps its exact previous behaviour. The formula
  // itself is unchanged - this engine remains the ONE place payroll money is
  // calculated.
  const lwpDays = Number(opts?.lwpDays ?? attendance?.payableAbsentDays ?? attendance?.absentDays ?? 0)
  const lwpDeduction = Math.round(dailyRate * lwpDays)

  // Optional extras
  const bonus = Math.round(Number(opts?.bonus || 0))
  const otherDeductions = Math.round(Number(opts?.otherDeductions || 0))

  // --- Gross = base + overtime + bonus (before deductions) ---
  const gross = basic + hra + allowances + overtimePay + bonus

  // --- ESI (employee share 0.75 %, only when gross ≤ ceiling) ---
  const esi = gross <= ESI_GROSS_CEILING ? Math.round(gross * ESI_EMPLOYEE_RATE) : 0

  // --- Professional Tax (slab) ---
  const professionalTax = gross > PROF_TAX_THRESHOLD ? PROF_TAX_AMOUNT : 0

  // --- Net ---
  const totalDeductions = pf + tax + esi + professionalTax + otherDeductions + lwpDeduction
  const net = Math.max(0, gross - totalDeductions)

  // --- Yearly projections (12 × monthly net) ---
  const yearlyNet = net * 12
  const yearlyCTC = (struct?.ctc || monthly * 12)

  return {
    // Rates
    dailyRate,
    hourlyRate,
    // Earnings
    basic,
    hra,
    allowances,
    overtime_hours: overtimeHours,
    overtime_pay: overtimePay,
    bonus,
    gross,
    // Deductions
    pf,
    tax,
    esi,
    professional_tax: professionalTax,
    other_deductions: otherDeductions,
    lwp_days: lwpDays,
    lwp_deduction: lwpDeduction,
    total_deductions: totalDeductions,
    // Net
    net,
    // Projections
    yearly_net: yearlyNet,
    yearly_ctc: yearlyCTC,
  }
}

/**
 * Merge a computed breakdown onto an existing Payroll document's fields.
 * Only fills in fields that are currently 0 / null / undefined.
 * This allows HR-manually-entered values to take precedence.
 */
export function fillPayrollGaps(payrollDoc, computed) {
  const fill = (field, value) => {
    if (payrollDoc[field] == null || payrollDoc[field] === 0) payrollDoc[field] = value
  }
  fill('basic', computed.basic)
  fill('hra', computed.hra)
  fill('allowances', computed.allowances)
  fill('pf', computed.pf)
  fill('tax', computed.tax)
  fill('esi', computed.esi)
  fill('professional_tax', computed.professional_tax)
  fill('bonus', computed.bonus)
  fill('daily_rate', computed.dailyRate)
  fill('hourly_rate', computed.hourlyRate)
  fill('overtime_hours', computed.overtime_hours)
  fill('overtime_pay', computed.overtime_pay)
  fill('lwp_days', computed.lwp_days)
  fill('lwp_deduction', computed.lwp_deduction)
  fill('other_deductions', computed.other_deductions)
  // Always recompute gross/net/total from the (now filled) components
  payrollDoc.gross = (payrollDoc.basic||0) + (payrollDoc.hra||0) + (payrollDoc.allowances||0) + (payrollDoc.overtime_pay||0) + (payrollDoc.bonus||0)
  payrollDoc.total_deductions = (payrollDoc.pf||0) + (payrollDoc.tax||0) + (payrollDoc.esi||0) + (payrollDoc.professional_tax||0) + (payrollDoc.other_deductions||0) + (payrollDoc.lwp_deduction||0)
  payrollDoc.net = Math.max(0, payrollDoc.gross - payrollDoc.total_deductions)
  return payrollDoc
}
