/**
 * payrollEngine.js — Pure payroll calculation engine for Skew EMS.
 *
 * Rules are derived EXCLUSIVELY from the existing schema formulae in
 * Employee.js (pre-save hook). No values are hardcoded; every coefficient
 * is derived from the existing project rules.
 *
 * PHASE SALARY STRUCTURE REWORK — CURRENT RULES (this block supersedes every
 * historical description below wherever the two differ). HRA and Allowances
 * are REMOVED as separate paid components. The 50/50 Basic/gross RATIO is
 * unchanged — what changed is that nothing fills the other 50% any more;
 * Gross Monthly Salary and Basic Salary remain two distinct figures.
 *
 * Employee.salary pre-save rules (source of truth — see models/Employee.js):
 *   monthly (= gross) = ctc / 12
 *   basic             = monthly × 0.50   (Basic is HALF of gross; the other
 *                                        half is simply not paid out as a
 *                                        named component any more)
 *   pf                = basic × 0.12       (employee PF @ 12 % of BASIC)
 *   esi               = monthly × 0.0075   (employee ESI @ 0.75 % of the
 *                                           FIXED monthly GROSS — see the
 *                                           note below on why this is NOT
 *                                           the overtime-inclusive gross)
 *   tax               = 0                  (TDS removed, see TASK 5 below)
 *   net               = monthly − pf − esi  (Net is GROSS minus deductions,
 *                                           NOT Basic minus deductions — see
 *                                           the worked example below)
 *
 * Worked example (Annual CTC ₹1,20,000):
 *   monthly (gross) = 1,20,000 / 12 = ₹10,000
 *   basic   = 50% × 10,000 = ₹5,000
 *   pf      = 12% × 5,000 = ₹600
 *   esi     = 0.75% × 10,000 = ₹75
 *   total_deductions = 600 + 75 = ₹675
 *   net     = 10,000 − 675 = ₹9,325
 *
 * ESI IS DELIBERATELY COMPUTED FROM THE FIXED MONTHLY GROSS — the same
 * basis `gross` itself carries, since PHASE SALARY RECEIVABLE + LOP +
 * OVERTIME made Gross = the fixed monthly salary (overtime and bonus are
 * separate lines, never folded into gross or net). The FIXED MONTHLY SALARY
 * (Gross/Basic/PF/ESI/Net Monthly Salary) and the ATTENDANCE-BASED values
 * (Payable Days/LOP/Overtime/Current Receivable) are two separate concepts
 * that must never be mixed: PF and ESI are statutory deductions against the
 * person's fixed monthly package, not against whatever they happen to earn
 * in variable overtime that month. Pricing ESI (or Net) off overtime-
 * inclusive gross would make a statutory figure swing with how much
 * overtime someone worked, which is not how PF/ESI work and is not what the
 * brief's worked examples compute.
 *
 *   Daily rate          = basic / 30                       (payslip display)
 *   Hourly rate         = daily / 8
 *
 *   PHASE SALARY MONTHLY RECEIVABLE — THE THREE DISTINCT FIGURES:
 *   A. Gross Monthly Salary   = `monthly` (fixed, attendance-independent;
 *                               `gross` is THE SAME figure — see below)
 *   B. Net Monthly Salary     = monthly − pf − esi (`net_monthly_salary`,
 *                               fixed, attendance-independent — the ONLY
 *                               breakdown My Profile shows)
 *   C. Current Receivable     = payable_days × daily_payable_amount
 *                               (attendance-dependent, starts at ₹0 on the 1st
 *                               and grows with payable days)
 *
 *   30-DAY BASIS (PHASE SALARY MONTHLY RECEIVABLE): the salary month is
 *   ALWAYS exactly 30 days. The payroll basis is not the calendar month's
 *   own day count (28/29/30/31) and not the period's real working-day count:
 *   the denominator is a constant 30 for every month.
 *     Daily Payable Rate   = Net Monthly Salary / 30 (prices LOP days)
 *     Daily Payable Amount = Net Monthly Salary / 30 (prices current
 *                             receivable days — Net-based, see TASK 7)
 *
 *   TASK 2 — RECEIVABLE (attendance-based, entirely separate from the fixed
 *   monthly salary above)
 *   Payable days        = present_days + approved PAID leave days
 *   Daily payable amt   = net_monthly_salary / 30
 *   Current receivable  = daily_payable_amount × payable_days
 *   Final receivable    = Current Receivable (TASK 9 — Overtime removed)
 *
 *   Phase 7.2 (TASK 3) — OVERTIME REMOVED
 *   The Overtime feature (per-day OT hours, approval workflow, OT rate and
 *   OT pay) is retired. The payroll keys remain in the output as 0 so
 *   historical payslips and exports keep validating and keep reading zeros.
 *
 *   Gross               = monthly  (PHASE SALARY RECEIVABLE + LOP + OVERTIME:
 *                         Gross is the FIXED normal monthly salary ONLY.
 *                         Overtime pay and bonus are separate earning lines —
 *                         overtime enters the money once via Current
 *                         Receivable, a bonus is reported on its own line.
 *                         Overtime-inclusive gross is exactly what the brief
 *                         says must NOT exist)
 *   TASK 5 — Total deductions = pf + esi + other_deductions + LOP Pay
 *                         (Professional Tax and TDS/Tax are NOT applied)
 *   Net                 = max(0, monthly − total_deductions)
 *
 *   PHASE SALARY MONTHLY RECEIVABLE — LOP lives INSIDE Total Deduction now.
 *   Previously (PHASE LOP SALARY FIX) LOP reduced the payable base first and
 *   stayed OUT of `total_deductions`. The current rule keeps ONE deduction
 *   flow: LOP Pay Amount = LOP Days × Daily Payable Rate is a member of
 *   `total_deductions` and the payable base is NOT reduced a second time, so
 *   LOP is never double-counted. `net` comes out numerically identical to the
 *   old flow (monthly − lwp − pf − esi − other) while `total_deductions`
 *   literally shows PF + ESI + LOP Pay (+ other), per the brief.
 */

// ---------------------------------------------------------------------------
// PHASE SALARY/PROJECT AUDIT (SALARY BUG 3) — CHRONOLOGICAL PAYROLL MONTHS
//
// `Payroll.month` (models/hrModels.js) is a STRING label such as "July 2026",
// and every payroll read did `.sort({ month: -1 })`. That is a lexicographic
// sort, so descending order is  September > October > November > May > March >
// July > June > February > December > August > April  — not chronological.
// Consequences: GET /hr/payroll/me/salary took `history[0]` as the CURRENT
// period, so an employee's "current" payslip was whichever month happened to
// sort first alphabetically, and the Salary History table listed months in a
// meaningless order.
//
// The month label is payroll data, so its parser lives here beside the rest of
// the payroll rules rather than being restated at each call site. It accepts the
// same three forms the client-side parser in
// client/src/features/salary/salaryDocument.js already accepts ("July 2026",
// "Jul 2026", "2026-07") and never guesses: an unparseable label yields nulls
// and is sorted last instead of being silently reordered.
// ---------------------------------------------------------------------------
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** @returns {{ year: number|null, month: number|null }} month is 0-based. */
export function parsePayrollMonth(label) {
  if (!label) return { year: null, month: null }
  const text = String(label).trim()
  const iso = /^(\d{4})-(\d{2})/.exec(text)
  if (iso) {
    const m = Number(iso[2]) - 1
    return m >= 0 && m <= 11 ? { year: Number(iso[1]), month: m } : { year: null, month: null }
  }
  const parts = text.split(/\s+/)
  if (parts.length === 2) {
    const idx = MONTH_NAMES.findIndex((m) => m.startsWith(parts[0].toLowerCase()))
    const yr = Number(parts[1])
    if (idx >= 0 && Number.isFinite(yr) && yr > 0) return { year: yr, month: idx }
  }
  return { year: null, month: null }
}

/** Sort comparator: newest payroll month first; unparseable labels last. */
export function comparePayrollMonthDesc(a, b) {
  const pa = parsePayrollMonth(a?.month)
  const pb = parsePayrollMonth(b?.month)
  const ka = pa.year == null ? -Infinity : pa.year * 12 + pa.month
  const kb = pb.year == null ? -Infinity : pb.year * 12 + pb.month
  return kb - ka
}

// PHASE SALARY MONTHLY RECEIVABLE: the payroll month is EXACTLY 30 days,
// always, for every month. This single constant prices the Daily Payable Rate
// (Net Monthly Salary ÷ 30), the Daily Payable Amount (Net Monthly Salary ÷
// 30) and therefore LOP Pay and the Current Receivable Salary. Calendar-day
// counts (28/29/30/31) and the period's real working-day count are
// deliberately NOT used as salary denominators. The attendance service still
// reports `expectedWorkingDays` for the attendance module and for
// transparency, but no salary figure is priced from it.
const WORKING_DAYS_BASIS = 30
const ESI_GROSS_CEILING = 21000 // ESI not applicable above this monthly gross
const ESI_EMPLOYEE_RATE = 0.0075 // 0.75 %

// ---------------------------------------------------------------------------
// PHASE SALARY/BILLING (TASK 5) — PROFESSIONAL TAX AND TDS/TAX ARE NO LONGER
// APPLIED. PHASE SALARY MONTHLY RECEIVABLE — LOSS-OF-PAY IS A DEDUCTION AGAIN.
//
// PROF_TAX_THRESHOLD / PROF_TAX_AMOUNT are DELETED rather than left unused, so
// no dormant constant can be wired back in by accident. The deductions are
// handled as follows:
//
//   * professional_tax — no longer computed at all.
//   * tax (TDS)        — no longer derived, and a value STORED on an existing
//                        payroll document is no longer added to the total.
//   * lwp_deduction    — LOP Pay Amount = LOP Days × Daily Payable Rate
//                        (Net Monthly Salary ÷ 30), and it IS a member of
//                        `total_deductions` (PF + ESI + LOP Pay). The payable
//                        base is NOT reduced a second time, so LOP is charged
//                        exactly once.
//
// The `tax` / `professional_tax` KEYS are still returned (as 0) because
// Payroll documents, payslip history, the salary report and the exports all
// read them; removing the keys would break historical rows rather than merely
// stop applying the deductions. Returning a truthful 0 is what guarantees no
// hidden deduction survives — see `total_deductions` below, which is now the
// literal sum of the remaining valid components and cannot silently regain one.
//
// HISTORICAL DATA IS NOT DESTROYED: the Payroll schema keeps its `tax`,
// `professional_tax`, `lwp_days` and `lwp_deduction` paths, so what HR ran in
// previous months stays on disk exactly as recorded.
// ---------------------------------------------------------------------------

// PHASE SALARY/BILLING (TASK 3) — statutory-style daily overtime ceiling.
// Phase 7.2 (TASK 3): the Overtime feature is REMOVED — no attendance day can
// produce overtime any more, so the cap, the legacy multiplier and the
// dayOvertime/overtimeBreakdown helpers are deleted rather than left dormant.
//
// The payroll KEYS (`overtime_hours`, `overtime_rate`, `overtime_pay`,
// `overtime_hours_raw`, `overtime_rate_source`) are still returned as 0 — same
// reasoning as `tax`/`professional_tax` below: Payroll documents, payslip
// history, the salary report and the exports all read them, and removing the
// keys would break historical rows instead of merely stopping the payment.

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Compute full payroll breakdown for one employee for one month.
 *
 * @param {object} struct     – Employee.salary (basic, monthly, pf, esi, tax, ctc).
 *                              `monthly` is the Gross Monthly Salary; `basic`
 *                              is 50% of it — see the file header for why
 *                              there is no hra/allowances split any more.
 * @param {object} attendance – from attendanceService.mySummary: { workingDays, presentDays, absentDays, payableAbsentDays, expectedWorkingDays, leaveDays, lateDays, overtime (pinned to 0 since Phase 7.2) }
 * @param {object} opts       – optional overrides: { bonus, otherDeductions, approvedLeaveDays, lwpDays } (Phase 7.2: overtimeRatePerHour is removed — no option can produce overtime any more)
 * @returns {object} Full payroll breakdown (all monetary values in rupees, rounded to integer)
 */
export function computePayroll(struct, attendance = {}, opts = {}) {
  // --- Base salary components (from Employee.salary, stored by HR at onboarding) ---
  //
  // PHASE SALARY STRUCTURE REWORK: `hra` and `allowances` are REMOVED as
  // separate paid components. The 50/50 Basic/gross RATIO is unchanged —
  // Basic Salary and Gross Monthly Salary remain two distinct figures. This
  // mirrors Employee.js's own pre-save rule exactly
  // (`this.salary.basic = Math.round(monthly * 0.5)`), which is the other
  // half of this same structure and must never disagree with this engine.
  //
  // `monthly` (the fixed monthly GROSS) is read from `struct.monthly` when
  // present — the same stored field Employee.js's pre-save hook writes.
  // Falls back to `basic / 0.5` (i.e. `basic * 2`) when `monthly` is absent
  // (older stored rows saved before `monthly` existed, or a caller passing
  // only `{ basic }`), and finally to `ctc / 12` when only a bare CTC is
  // available (the "structure not yet set up" branch in hrRoutes.js).
  const basic = Math.round(struct?.basic || 0)
  const monthly = Math.round(
    struct?.monthly || (basic ? basic / 0.5 : 0) || (struct?.ctc ? struct.ctc / 12 : 0)
  )
  const storedPf = Math.round(struct?.pf || 0)
  const storedEsi = Math.round(struct?.esi || 0)
  // TASK 5: `struct.tax` is deliberately NOT read. It used to seed the TDS
  // deduction (`tax = storedTax || monthly × 0.08`); with TDS removed from the
  // calculation, reading it would only reintroduce a value that must not be
  // applied. Left out entirely rather than assigned-and-ignored, so no dead
  // variable suggests the deduction is still live.

  // Derive PF from basic when the stored value is 0 (matches Employee.js rule)
  const pf = storedPf || Math.round(basic * 0.12)

  // TASK 5: TDS is no longer derived and no longer applied. `storedTax` is read
  // only so an existing stored value can be reported as-is on historical rows;
  // it never reaches `total_deductions`.

  // ESI: 0.75% of the FIXED monthly GROSS (`monthly`) — NOT of Basic, and NOT
  // of the overtime/bonus-inclusive `gross` computed further down. See the
  // file header comment for why these must stay separate. Derived from the
  // stored value when present (matches Employee.js), falling back to the
  // formula so a struct that predates the `esi` field (or a test fixture)
  // still prices correctly.
  const esi = (storedEsi || (monthly <= ESI_GROSS_CEILING ? Math.round(monthly * ESI_EMPLOYEE_RATE) : 0))

  // --- THE FIXED NET MONTHLY SALARY (figure B in the file header) ---
  //
  // Gross Monthly Salary − PF − ESI. Attendance-independent: it is the full
  // month's take-home after the two statutory deductions, and it is the ONLY
  // breakdown My Profile shows (Gross − PF − ESI = Net Monthly Salary). LOP
  // does NOT appear here — it is a payslip deduction (member of
  // `total_deductions`), never a member of this fixed figure. It is computed
  // BEFORE the rates below because it is now the basis both per-day figures
  // are priced from.
  const netMonthlySalary = Math.max(0, monthly - pf - esi)

  // --- Rates (FIXED 30-DAY BASIS — PHASE SALARY MONTHLY RECEIVABLE) ---
  //
  // `scheduledWorkingDays` is ALWAYS 30. The payroll month is exactly 30 days
  // for every month (see WORKING_DAYS_BASIS above); the attendance service's
  // `expectedWorkingDays` (real working days, Sundays + Company Holidays
  // excluded) is still reported for the attendance module but is deliberately
  // NOT a salary denominator any more.
  const scheduledWorkingDays = WORKING_DAYS_BASIS

  const workingDaysBasis = WORKING_DAYS_BASIS
  const dailyRate = basic > 0 ? round2(basic / workingDaysBasis) : 0
  const hourlyRate = dailyRate > 0 ? round2(dailyRate / 8) : 0

  // THE PER-DAY PAYABLE RATE — the NET MONTHLY SALARY (Gross Monthly − PF −
  // ESI) divided by the 30-day salary month. This is the rate a LOP day is
  // priced at: each unpaid day costs the employee what a worked day is worth
  // at the NET level — the net receivable salary that day would actually
  // have paid out. (Pricing LOP off the gross charged the missed day AND a
  // full day's worth of statutory deductions on top of it.)
  const dailyPayableRate = scheduledWorkingDays > 0 ? round2(netMonthlySalary / scheduledWorkingDays) : 0

  // --- THE DAILY PAYABLE AMOUNT (TASK 7) ---
  //
  // Net Monthly Salary ÷ 30 — the per-day figure the CURRENT RECEIVABLE is
  // priced from. Both per-day figures are Net Monthly Salary ÷ 30: a worked
  // day earns Net/30 and a missed day costs Net/30, so a fully worked month
  // always nets exactly the fixed Net Monthly Salary.
  const dailyPayableAmount = scheduledWorkingDays > 0 ? round2(netMonthlySalary / scheduledWorkingDays) : 0

  // --- Attendance-derived figures ---
  //
  // Phase 7.2 (TASK 3): Overtime is REMOVED as a feature. The hours/rate/pay
  // keys are pinned to 0 (never derived from attendance) so every historical
  // consumer — Payroll documents, payslip history, salary report, exports —
  // keeps reading truthful zeros, exactly like `tax`/`professional_tax`.
  const overtimeHours = 0
  const overtimeHoursRaw = 0
  const overtimeRate = 0
  const overtimeRateSource = 'removed'
  const overtimePay = 0

  // LWP: use explicit lwpDays if provided; otherwise infer from absent days.
  //
  // Phase 6.12 (TASK 10): the fallback now prefers `payableAbsentDays`, the
  // ADDITIVE field produced by attendanceService.mySummary(). `absentDays`
  // counts only Attendance documents explicitly marked 'Absent', which misses
  // every elapsed working day on which the employee never checked in and left
  // no document at all. `payableAbsentDays` is that same count PLUS those
  // unrecorded elapsed working days, with Sundays, Company Holidays, approved
  // leave ('On Leave') and future dates already excluded by the attendance
  // service.
  //
  // `absentDays` is retained as the second fallback so any caller that passes
  // an older attendance shape keeps its exact previous behaviour. The formula
  // itself is unchanged - this engine remains the ONE place payroll money is
  // calculated.
  const lwpDays = Number(opts?.lwpDays ?? attendance?.payableAbsentDays ?? attendance?.absentDays ?? 0)
  const lwpDeduction = Math.round(lwpDays * dailyPayableRate)

  // Optional extras
  const bonus = Math.round(Number(opts?.bonus || 0))
  const otherDeductions = Math.round(Number(opts?.otherDeductions || 0))

  // --- Gross = monthly + overtime + bonus (display/reporting total) ---
  //
  // PHASE SALARY MONTHLY RECEIVABLE: `payableGross` is the FIXED monthly gross
  // — LOP no longer reduces it. LOP Pay is a member of `total_deductions`
  // below, so reducing the base here would charge it twice (the exact
  // double-count the brief warns against). The payslip therefore shows the
  // full monthly earnings with LOP as a deduction line, and `net` comes out
  // --- Gross = the FIXED normal monthly gross (PHASE SALARY RECEIVABLE + LOP +
  // OVERTIME) ---
  //
  // Gross Salary is the employee's normal monthly gross salary and NOTHING
  // else. Overtime Pay and Bonus are separate earning lines — they are NOT
  // folded into `gross` (and never into `net`). Overtime contributes to the
  // month's money exactly once, via `current_receivable` (see below); a bonus
  // is reported on its own line. The payslip's 'Gross Salary' row therefore
  // equals the 'Monthly Salary' line — the brief's worked example (Gross
  // ₹10,000 with ₹500 overtime must remain ₹10,000, NOT ₹10,500) is the rule.
  //
  // NOTE: `esi` and the fixed `net_monthly_salary` below are computed from
  // `monthly` (the FIXED monthly gross), the same basis `gross` now carries —
  // there is no variable-earnings figure anywhere in the statutory path.
  const payableGross = monthly
  const gross = monthly

  // TASK 5: the two removed deductions are pinned to 0 here so that every
  // downstream consumer reading these keys sees the truth, and so the total
  // below is provably free of them.
  const tax = 0
  const professionalTax = 0

  // --- Total deductions & Net ---
  //
  // PHASE SALARY MONTHLY RECEIVABLE — ONE AUTHORITATIVE DEDUCTION FLOW:
  //     Total Deduction = PF + ESI + LOP Pay (+ optional other deductions)
  // and
  //     Net = max(0, Gross Monthly Salary − Total Deduction)
  //
  // LOP is charged EXACTLY ONCE: it is a member of this total, and the payable
  // base (`payableGross`) is not reduced a second time. `otherDeductions` is
  // an explicit opt-in extra (e.g. a recovery) and is included here because —
  // unlike overtime/bonus — it is understood to apply against the fixed
  // package, matching its previous behaviour.
  //
  // Worked example (Annual CTC ₹1,20,000, full attendance): monthly=10,000,
  // basic=5,000, pf=600, esi=75, lwp=0, total_deductions=675, net=9,325 —
  // exactly the brief's target numbers. Same month with 3 LOP days:
  // lwp_deduction=932 (3 × ₹310.83 — Net Monthly ÷ 30), total_deductions=1,607,
  // net=8,393.
  const totalDeductions = pf + esi + otherDeductions + lwpDeduction
  const net = Math.max(0, monthly - totalDeductions)

  // -------------------------------------------------------------------------
  // TASK 2 — CURRENT RECEIVABLE SALARY.
  //
  // ROOT CAUSE of the reported bug: `receivable` was not a calculation at all.
  // routes/hrRoutes.js set it to `status === 'Paid' ? 0 : net`, i.e. the WHOLE
  // month's net salary from the first day of the month, regardless of how many
  // days had actually been worked. It could never start at ₹0 and could never
  // grow with attendance — the two behaviours the brief describes.
  //
  // It is now earned pay: the per-day payable AMOUNT (Net Monthly Salary ÷ 30)
  // × the days actually earned. `payableDays` = days present (Present / Late /
  // Early Exit, per attendanceService) PLUS approved PAID leave, which the
  // existing leave policy treats as payable (LeaveType.paid). Approved UNPAID
  // leave, recorded absences and unrecorded working days are all excluded —
  // they are simply days not earned.
  //
  // Worked examples from the brief (Net Monthly ₹9,325 over the 30-day basis
  // → ₹310.83/day): 0 days → ₹0 ; 1 day → ₹311 ; 2 days → ₹622 ; 7 days →
  // ₹2,176 ; 30 days → ₹9,325. Nothing here is hardcoded: both the amount and
  // the day count come from the stored salary structure and stored attendance.
  //
  // PHASE SALARY RECEIVABLE + LOP + OVERTIME — FINAL SEMANTICS
  // (Phase 7.2 TASK 3: Overtime removed — receivable is the final figure):
  //
  //   receivable          = earned normal pay  = round(dailyPayableAmount × payableDays)
  //   current_receivable  = receivable (overtime is removed and pinned to 0)
  //   receivable_total    = current_receivable (compat alias — same figure)
  //
  // Gross (above) deliberately excludes overtime and bonus; the receivable is
  // the one place attendance contributes to the month's money. The overtime
  // keys are still reported (as 0) so the UI and exports keep working.
  const presentDays = Math.max(0, Number(attendance?.presentDays || 0))
  const paidLeaveDays = Math.max(0, Number(attendance?.paidLeaveDays || 0))
  const payableDays = presentDays + paidLeaveDays
  const receivable = Math.round(dailyPayableAmount * payableDays)
  const currentReceivable = receivable + overtimePay
  const receivableTotal = currentReceivable

  // --- Yearly projections (12 × monthly net) ---
  const yearlyNet = net * 12
  const yearlyCTC = (struct?.ctc || monthly * 12)

  return {
    // Rates
    dailyRate,
    hourlyRate,
    // LOP PRICING: the per-day figure that prices a LOP day (Net Monthly
    // Salary ÷ 30 — the net receivable salary), kept for compatibility and
    // for the LOP explanation.
    daily_payable_rate: dailyPayableRate,
    // TASK 7: the per-day figure that actually prices an earned day
    // (Net Monthly Salary ÷ 30), plus the denominator it was derived from.
    daily_payable_amount: dailyPayableAmount,
    scheduled_working_days: scheduledWorkingDays,
    present_days: presentDays,
    paid_leave_days: paidLeaveDays,
    payable_days: payableDays,
    // Earnings — PHASE SALARY STRUCTURE REWORK: `hra`/`allowances` are no
    // longer returned. `monthly` is the FIXED Gross Monthly Salary (basic is
    // only 50% of it); see the file header. Any consumer that still reads
    // `.hra`/`.allowances` off this object needs to be updated, not this
    // object patched to keep emitting them.
    //
    // `monthly` is exposed here as its own key (identical to `gross` — see
    // the block above; `gross` no longer folds in overtime/bonus) so a
    // "Gross Salary" widget binds to the FIXED figure the brief's worked
    // example uses (₹10,000).
    monthly,
    basic,
    // PHASE SALARY MONTHLY RECEIVABLE: figure B — the FIXED Net Monthly
    // Salary (Gross − PF − ESI). Attendance-independent; My Profile and the
    // salary widgets bind to this, never to `net` (which additionally charges
    // LOP/other deductions for the payslip).
    net_monthly_salary: netMonthlySalary,
    // PHASE SALARY MONTHLY RECEIVABLE: the fixed monthly gross — LOP no
    // longer reduces it (LOP is a member of total_deductions now).
    payable_gross: payableGross,
    overtime_hours: overtimeHours,
    // TASK 3: hours worked beyond the shift BEFORE the 3h/day cap, so the UI can
    // show what was worked next to what is payable.
    // Phase 7.2 (TASK 3): Overtime removed — reported as 0.
    overtime_hours_raw: overtimeHoursRaw,
    // TASK 4
    overtime_rate: overtimeRate,
    overtime_rate_source: overtimeRateSource,
    overtime_pay: overtimePay,
    bonus,
    gross,
    // Deductions
    pf,
    esi,
    other_deductions: otherDeductions,
    // TASK 5: retained as keys, permanently 0, and excluded from
    // `total_deductions`. See the block comment at the top of this file.
    tax,
    professional_tax: professionalTax,
    lwp_days: lwpDays,
    // PHASE SALARY MONTHLY RECEIVABLE: LOP Pay Amount = LOP Days × Daily
    // Payable Rate, a REAL member of `total_deductions` (PF + ESI + LOP Pay).
    lwp_deduction: lwpDeduction,
    total_deductions: totalDeductions,
    // Net
    net,
    // TASK 2 — earned pay (PHASE SALARY RECEIVABLE + LOP + OVERTIME):
    // `receivable` = earned normal pay only (Daily Payable Amount × Payable
    // Days). `current_receivable` = receivable + overtime pay — the final
    // current-month figure, overtime included exactly once. `receivable_total`
    // is the same figure under the historical name.
    receivable,
    current_receivable: currentReceivable,
    receivable_total: receivableTotal,
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
  // PHASE SALARY STRUCTURE REWORK: `monthly` (the FIXED Gross Monthly
  // Salary) is now a real persisted `Payroll` schema field (see
  // models/hrModels.js) and is `fill`ed the same way `basic`/`pf`/`esi`
  // already are — an HR-entered value on a saved payslip is preserved, and a
  // row saved before this field existed gets it filled in from the freshly
  // computed breakdown, exactly like every other base salary component here.
  fill('monthly', computed.monthly)
  fill('basic', computed.basic)
  fill('pf', computed.pf)
  fill('esi', computed.esi)
  fill('bonus', computed.bonus)
  fill('daily_rate', computed.dailyRate)
  fill('hourly_rate', computed.hourlyRate)
  fill('other_deductions', computed.other_deductions)

  // TASK 3/4: overtime is ALWAYS taken from the computed breakdown rather than
  // `fill`ed. Phase 7.2 (TASK 3): the computed values are pinned to 0, so this
  // overwrite also zeroes any stored historical figure — the same guarantee
  // the tax/professional_tax overwrites below give.
  payrollDoc.overtime_hours = computed.overtime_hours
  payrollDoc.overtime_rate = computed.overtime_rate
  payrollDoc.overtime_pay = computed.overtime_pay

  // TASK 5: Professional Tax and TDS are FORCED to 0 on the merged result.
  // Using `fill` here would have been the exact "hidden deduction still
  // reducing Net" the brief warns about: `fill` is a no-op when a value is
  // already present, so a stored professional_tax of 200 (or a stored tax of
  // 8,000) would have survived the merge and stayed in the total below.
  // Overwriting is what guarantees the removal actually takes effect on rows
  // HR already ran.
  payrollDoc.tax = 0
  payrollDoc.professional_tax = 0
  // PHASE SALARY MONTHLY RECEIVABLE: `lwp_days` is `fill`ed like every other
  // base component (a stored HR-entered count is preserved; a missing/zero one
  // gets the computed attendance-derived count), and `lwp_deduction` is then
  // ALWAYS re-derived from the merged days × the computed daily payable rate
  // (Net Monthly Salary ÷ 30). A stored 0 — every row written while the
  // full-salary bug was live — or any stale stored figure must not survive
  // into the display; the same overwrite reasoning as the overtime lines
  // above.
  //
  // This does NOT rewrite history: `payrollDoc` is a plain object assembled
  // per-request in routes/hrRoutes.js for display, never the persisted Mongoose
  // document, so the stored row keeps its original figures.
  fill('lwp_days', computed.lwp_days)
  payrollDoc.lwp_deduction = Math.round((payrollDoc.lwp_days || 0) * (computed.daily_payable_rate || 0))

  // Always recompute gross/net/total from the (now filled) components.
  //
  // PHASE SALARY RECEIVABLE + LOP + OVERTIME: `payableGross` is the FIXED
  // monthly gross (LOP no longer reduces it — it is a member of
  // `total_deductions` below), matching computePayroll exactly. `gross` is the
  // SAME fixed monthly figure — overtime and bonus are separate lines and are
  // never folded into gross (nor net). `total_deductions` is the literal
  // PF + ESI + other + LOP Pay sum, and `net` is `monthly − total_deductions`
  // — one deduction flow, no double-counted LOP.
  const payableGross = payrollDoc.monthly || 0
  payrollDoc.payable_gross = payableGross
  payrollDoc.gross = payableGross
  // PHASE SALARY MONTHLY RECEIVABLE: Total Deduction = PF + ESI + LOP Pay
  // (+ other deductions). LOP is charged once, here, and not against the base.
  payrollDoc.total_deductions = (payrollDoc.pf || 0) + (payrollDoc.esi || 0)
    + (payrollDoc.other_deductions || 0) + (payrollDoc.lwp_deduction || 0)
  payrollDoc.net = Math.max(0, payableGross - payrollDoc.total_deductions)
  // Figure B — the FIXED Net Monthly Salary (Gross − PF − ESI), the figure
  // My Profile and the Net Monthly Salary widget bind to.
  payrollDoc.net_monthly_salary = Math.max(0, (payrollDoc.monthly || 0) - (payrollDoc.pf || 0) - (payrollDoc.esi || 0))

  // TASK 2/7 (PHASE SALARY RECEIVABLE + LOP + OVERTIME): receivable follows
  // the SAME rule as computePayroll — earned pay (Daily Payable Amount ×
  // Payable Days), plus overtime exactly once via current_receivable.
  payrollDoc.daily_payable_rate = computed.daily_payable_rate
  payrollDoc.daily_payable_amount = computed.daily_payable_amount
  payrollDoc.payable_days = computed.payable_days
  payrollDoc.receivable = computed.receivable
  payrollDoc.current_receivable = computed.current_receivable
  payrollDoc.receivable_total = computed.receivable_total
  return payrollDoc
}