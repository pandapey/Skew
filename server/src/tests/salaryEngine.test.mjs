// Deterministic salary/payroll verification harness.
// Executes the REAL modules from the project (no re-implementation):
//   server/src/services/payrollEngine.js  -> computePayroll / fillPayrollGaps
//                                            parsePayrollMonth /
//                                            comparePayrollMonthDesc
//   server/src/utils/leaveDays.js         -> countWorkingDays (the working-day
//                                            counter used by the attendance
//                                            module)
// Both are pure ESM with no external dependencies, so they run without MongoDB.
//
// Phase 7.2 (TASK 3) — OVERTIME REMOVED — current rules:
//   Fixed 30-day salary month (EVERY month, every attendance shape).
//   Gross Monthly Salary  = monthly = ctc/12            (fixed)
//   Net Monthly Salary    = monthly − PF − ESI          (fixed)
//   Daily Payable Rate    = Net Monthly Salary / 30     (prices LOP days)
//   Daily Payable Amount  = Net Monthly Salary / 30     (prices earned days)
//   Payable Days          = present days + approved PAID leave
//   Receivable (base)     = Daily Payable Amount × Payable Days  (starts at ₹0)
//   Current Receivable    = Receivable + Overtime Pay   (Overtime REMOVED, so
//                                                        this is the final figure)
//   Receivable Total      = Current Receivable (alias)
//   Gross                 = monthly ONLY — bonus is a separate line and NEVER
//                           folds into gross (nor net)
//   LOP Pay               = LOP Days × Daily Payable Rate — a member of
//                           Total Deduction (PF + ESI + LOP Pay)
//   Payable Gross         = monthly (NOT reduced by LOP — never double-charged)
//   Net                   = max(0, monthly − Total Deduction)
//   Overtime Pay          = REMOVED — overtime_hours / overtime_pay are pinned
//                           to 0 and no option can produce overtime any more.
//   Professional Tax / TDS: not applied (tax = 0, professional_tax = 0).
//
// Reference worked example from the brief (Annual CTC ₹1,20,000):
//   monthly = 10000 ; basic = 5000 ; pf = 600 ; esi = 75 ; net_monthly = 9325 ;
//   daily payable rate = 310.83 ; daily payable amount = 310.83 ;
//   1 earned day -> ₹311 ; 7 earned days -> ₹2,176 ; 30 -> ₹9,325 ;
//   3 LOP days -> LOP Pay ₹932 -> Total Deduction ₹1,607 -> Net ₹8,393.

import {
  computePayroll, fillPayrollGaps, parsePayrollMonth, comparePayrollMonthDesc,
} from '../services/payrollEngine.js'
import { countWorkingDays } from '../utils/leaveDays.js'

let pass = 0
let fail = 0
const results = []
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`)
}
function checkTrue(name, cond, detail = '') {
  cond ? pass++ : fail++
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// ---------------------------------------------------------------------------
// SALARY STRUCTURE under the project's own rule (Employee.js pre-save hook):
//   monthly = ctc/12 ; basic = 50% of monthly ; pf = 12% of basic ;
//   esi = 0.75% of the FIXED monthly gross (below the 21000 ceiling)
// CTC 1,200,000 -> monthly 100000, basic 50000, pf 6000, esi 0 (over ceiling)
// ---------------------------------------------------------------------------
const CTC = 1200000
const monthly = Math.round(CTC / 12)
const struct = {
  ctc: CTC,
  monthly,
  basic: Math.round(monthly * 0.5),
  pf: Math.round(Math.round(monthly * 0.5) * 0.12),
  esi: 0, // above the ESI ceiling at this CTC — see the ESI section below
}
check('structure derivation matches Employee.js rule',
  [struct.basic, struct.pf],
  [50000, 6000])

// PHASE SALARY MONTHLY RECEIVABLE: the salary month is ALWAYS 30 days.
const NET_MONTHLY = struct.monthly - struct.pf                     // 94000 (esi 0 over ceiling)
const PAYABLE_RATE = Math.round((NET_MONTHLY / 30) * 100) / 100  // 3133.33 (LOP pricing, Net-based)
const PAYABLE_AMOUNT = Math.round((NET_MONTHLY / 30) * 100) / 100   // 3133.33
const GROSS = struct.monthly                                        // 100000 (FIXED gross)

// ===========================================================================
// TASK 5 — REMOVED DEDUCTIONS (PT and TDS only; LOP is a real deduction now)
// ===========================================================================
{
  const att = { expectedWorkingDays: 26, presentDays: 26, paidLeaveDays: 0, leaveDays: 0,
    absentDays: 0, unrecordedDays: 0, unpaidLeaveDays: 0, payableAbsentDays: 0, overtime: 0 }
  const p = computePayroll(struct, att)
  check('T5 professional tax is not applied', p.professional_tax, 0)
  check('T5 TDS/tax is not applied', p.tax, 0)
  check('T5 LOP deduction is 0 with no unpaid days', p.lwp_deduction, 0)
  check('T5 total deductions = pf + esi + other + lwp only', p.total_deductions, struct.pf)
  check('T5 payable gross = FULL fixed monthly (LOP no longer reduces it)', p.payable_gross, struct.monthly)
  check('T5 net = monthly - deductions', p.net, struct.monthly - struct.pf)
  checkTrue('T5 net identity holds', p.net === p.payable_gross - p.total_deductions)
  check('T5 net monthly salary = gross - pf - esi', p.net_monthly_salary, NET_MONTHLY)
  check('T5 the 30-day basis applies even when the period is 26 days', p.scheduled_working_days, 30)
}
{
  // Absences MUST now flow into Total Deduction via LOP Pay.
  const att = { expectedWorkingDays: 26, presentDays: 21, paidLeaveDays: 0, leaveDays: 0,
    absentDays: 2, unrecordedDays: 3, unpaidLeaveDays: 0, payableAbsentDays: 5, overtime: 0 }
  const p = computePayroll(struct, att)
  check('T5 LOP days COUNTED from payableAbsentDays', p.lwp_days, 5)
  // daily payable rate = 94000/30 = 3133.33 -> 5 x 3133.33 = 15666.65 -> 15667
  check('T5 LOP Pay = 5 x 3133.33 (Net-based rate)', p.lwp_deduction, 15667)
  check('T5 payable gross NOT reduced by LOP (charged once, in deductions)', p.payable_gross, struct.monthly)
  check('T5 total deductions includes LOP Pay', p.total_deductions, struct.pf + 15667)
  check('T5 net reduced exactly once by LOP', p.net, struct.monthly - (struct.pf + 15667))
}
{
  // A stored payslip carrying the old deductions must not smuggle them back in
  // through fillPayrollGaps (the `fill`-only-when-empty trap).
  const computed = computePayroll(struct, { expectedWorkingDays: 26, presentDays: 24, paidLeaveDays: 0, payableAbsentDays: 2, overtime: 0 })
  const stored = {
    basic: 50000, pf: 6000,
    tax: 8000, professional_tax: 200, lwp_deduction: 3846,
    gross: 100000, net: 41954,
  }
  const merged = fillPayrollGaps({ ...stored }, computed)
  check('T5 stored TDS forced to 0 on merge', merged.tax, 0)
  check('T5 stored professional tax forced to 0 on merge', merged.professional_tax, 0)
  // lwp_days was NOT in `stored` -> filled from computed (2 days);
  // rate = 94000/30 = 3133.33 -> 2 x 3133.33 = 6266.66 -> 6267.
  check('T5 LOP Pay RECOMPUTED on merge from merged lwp_days', merged.lwp_deduction, 6267)
  check('T5 HR-entered basic still preserved', merged.basic, 50000)
  check('T5 merged total = pf + esi + other + lwp (no PT/TDS)', merged.total_deductions,
    merged.pf + merged.esi + merged.other_deductions + merged.lwp_deduction)
  checkTrue('T5 merged net identity holds (monthly - deductions)',
    merged.net === merged.monthly - merged.total_deductions,
    `net=${merged.net} monthly=${merged.monthly} ded=${merged.total_deductions}`)
  check('T5 merged net monthly salary = gross - pf - esi', merged.net_monthly_salary, 94000)
  checkTrue('T5 the stored net was NOT allowed to survive', stored.net !== merged.net)
  checkTrue('T5 the stored full gross was NOT allowed to survive',
    merged.gross === merged.payable_gross) // gross = fixed monthly, never overtime/bonus
}

// ===========================================================================
// TASK 2 — CURRENT RECEIVABLE SALARY (30-day basis; Net Monthly ÷ 30 per day)
// ===========================================================================
const briefStruct = { ctc: 120000, monthly: 10000, basic: 5000, pf: 0, esi: 0 } // net monthly 9325
const earned = (presentDays) => computePayroll(
  briefStruct,
  { expectedWorkingDays: 30, presentDays, paidLeaveDays: 0, payableAbsentDays: 30 - presentDays, overtime: 0 },
)
{
  check('T2 daily payable rate = 9325/30 = 310.83 (Net-based)', earned(0).daily_payable_rate, 310.83)
  check('T2 daily payable amount = 9325/30 = 310.83 (Net-based)', earned(0).daily_payable_amount, 310.83)
  checkTrue('T2 both per-day figures now price from Net Monthly (rate = amount)',
    earned(0).daily_payable_rate === earned(0).daily_payable_amount)
  // Example A
  check('T2 Example A — 0 earned days -> current receivable 0', earned(0).current_receivable, 0)
  check('T2 Example A — receivable alias matches', earned(0).receivable, 0)
  // Example B
  check('T2 Example B — 1 earned day -> 311', earned(1).current_receivable, 311)
  // Example C
  check('T2 Example C — 2 earned days -> 622', earned(2).current_receivable, 622)
  check('T2 7 earned days -> 2176', earned(7).current_receivable, 2176)
  // PHASE SALARY RECEIVABLE + LOP + OVERTIME — required case: 10 earned days.
  check('T2 10 earned days -> 3108 (10 x 310.83)', earned(10).current_receivable, 3108)
  check('T2 15 earned days -> 4662', earned(15).current_receivable, 4662)
  check('T2 30 earned days -> full net monthly 9325', earned(30).current_receivable, 9325)
  checkTrue('T2 receivable grows monotonically with attendance',
    earned(0).current_receivable < earned(1).current_receivable && earned(1).current_receivable < earned(2).current_receivable)
}
{
  // Approved PAID leave is payable under the existing leave policy; approved
  // UNPAID leave and absences are not.
  const paid = computePayroll(briefStruct, { expectedWorkingDays: 30, presentDays: 10, paidLeaveDays: 5, overtime: 0 })
  check('T2 approved paid leave counts as payable', paid.payable_days, 15)
  check('T2 receivable includes paid leave days', paid.current_receivable, 4662)
  const unpaid = computePayroll(briefStruct, { expectedWorkingDays: 30, presentDays: 10, paidLeaveDays: 0, unpaidLeaveDays: 5, overtime: 0 })
  check('T2 unpaid leave is NOT payable', unpaid.payable_days, 10)
  check('T2 receivable excludes unpaid leave', unpaid.current_receivable, 3108)
}
{
  // The basis is ALWAYS 30 — a 24-working-day period still prices at /30.
  const p = computePayroll(struct, { expectedWorkingDays: 24, presentDays: 12, paidLeaveDays: 0, overtime: 0 })
  check('T2 the 30-day basis holds for ANY period day count', p.scheduled_working_days, 30)
  check('T2 payable rate = Net Monthly Salary / 30', p.daily_payable_rate, PAYABLE_RATE)
  checkTrue('T2 rate is NOT the basic-only dailyRate',
    p.daily_payable_rate !== p.dailyRate)
  const noAttendance = computePayroll(struct, {})
  check('T2 falls back to the 30-day basis with no attendance', noAttendance.scheduled_working_days, 30)
  check('T2 no attendance -> 0 payable days -> receivable 0', noAttendance.receivable, 0)
  check('T2 net monthly salary is fixed even with no attendance', noAttendance.net_monthly_salary, NET_MONTHLY)
}
{
  // TASK 1A worked example: monthly gross 10000 over a 30-day month.
  const thirtyDay = { ctc: 120000, monthly: 10000, basic: 5000, pf: 0, esi: 0 }
  const p = computePayroll(thirtyDay, { expectedWorkingDays: 30, presentDays: 2, paidLeaveDays: 0, overtime: 0 })
  check('T1A daily payable rate = 9325/30 = 310.83', p.daily_payable_rate, 310.83)
  check('T1A 2 payable days -> 622 (2 x 310.83)', p.receivable, 622)
}

// ===========================================================================
// Phase 7.2 (TASK 3) — OVERTIME REMOVED
// ===========================================================================
{
  // The engine must never produce overtime, no matter what the attendance
  // struct claims or which options are passed.
  const att = { expectedWorkingDays: 30, presentDays: 26, paidLeaveDays: 0, payableAbsentDays: 0, overtime: 5, overtimeRaw: 5 }
  const p = computePayroll(struct, att, { overtimeRatePerHour: 200 })
  check('REMOVED — overtime hours pinned to 0', p.overtime_hours, 0)
  check('REMOVED — raw hours pinned to 0', p.overtime_hours_raw, 0)
  check('REMOVED — rate pinned to 0', p.overtime_rate, 0)
  check('REMOVED — rate source reports the removal', p.overtime_rate_source, 'removed')
  check('REMOVED — overtime pay pinned to 0', p.overtime_pay, 0)
  check('REMOVED — current receivable = receivable (overtime adds nothing)', p.current_receivable, p.receivable)
  check('REMOVED — receivable_total = receivable', p.receivable_total, p.receivable)
  check('REMOVED — gross stays the fixed monthly (never overtime-inclusive)', p.gross, struct.monthly)
  checkTrue('REMOVED — a legacy rate option cannot resurrect overtime',
    p.overtime_pay === 0 && p.current_receivable === p.receivable)
}

// ===========================================================================
// PHASE SALARY MONTHLY RECEIVABLE — THE MANDATORY TEST CASES (TEST 1-9)
//
// The brief's rule set (₹10,000 monthly over the nominal 30-day month):
//   Daily Payable Rate    = 9325/30 = 310.83  (prices LOP days — Net-based)
//   Daily Payable Amount  = 9325/30 = 310.83   (prices earned days)
//   PF = 600 (12% of basic 5000), ESI = 75 (0.75% of 10000) -> 675 fixed.
//   Total Deduction       = PF + ESI + LOP Pay
//   Net                   = max(0, 10000 - Total Deduction)
//   Current Receivable    = 310.83 x payable days
// ===========================================================================
const LOP_STRUCT = { ctc: 120000, monthly: 10000, basic: 5000, pf: 0, esi: 0 }
const LOP_DAY = (present, lwp, paidLeave = 0) => ({
  expectedWorkingDays: 30, presentDays: present, paidLeaveDays: paidLeave,
  payableAbsentDays: lwp, overtime: 0,
})
{
  // TEST 1 — 0 earned days: current receivable MUST be 0 from day one (the
  // exact bug this phase fixes), while the FIXED Net Monthly Salary stays.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(0, 30))
  check('TEST 1 — daily payable rate = 9325/30 = 310.83', p.daily_payable_rate, 310.83)
  check('TEST 1 — daily payable amount = 9325/30 = 310.83', p.daily_payable_amount, 310.83)
  check('TEST 1 — net monthly salary is FIXED (9325)', p.net_monthly_salary, 9325)
  check('TEST 1 — current receivable = 0 with 0 earned days', p.current_receivable, 0)
  check('TEST 1 — receivable alias = 0', p.receivable, 0)
  check('TEST 1 — LOP Pay = 30 x 310.83 = 9325', p.lwp_deduction, 9325)
  check('TEST 1 — payable gross stays FULL 10000 (LOP is a deduction)', p.payable_gross, 10000)
  check('TEST 1 — total deduction = 675 + 9325 = 10000', p.total_deductions, 10000)
  check('TEST 1 — net floored at 0', p.net, 0)
}
{
  // TEST 2 — 1 earned day: exactly one day's worth of the net salary.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(1, 0))
  check('TEST 2 — 1 earned day -> 311', p.current_receivable, 311)
  check('TEST 2 — net monthly salary unchanged', p.net_monthly_salary, 9325)
}
{
  // TEST 3 — 2 earned days.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(2, 0))
  check('TEST 3 — 2 earned days -> 622', p.current_receivable, 622)
}
{
  // TEST 4 — 7 earned days (the brief's exact example).
  const p = computePayroll(LOP_STRUCT, LOP_DAY(7, 0))
  check('TEST 4 — 7 earned days -> 2176', p.current_receivable, 2176)
}
{
  // TEST 5 — 15 earned days: half the month.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(15, 0))
  check('TEST 5 — 15 earned days -> 4662', p.current_receivable, 4662)
}
{
  // TEST 6 — 30 earned days: the FULL net monthly salary.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(30, 0))
  check('TEST 6 — 30 earned days -> full 9325', p.current_receivable, 9325)
  check('TEST 6 — net = 9325 (brief target)', p.net, 9325)
  check('TEST 6 — total deduction = 675 only', p.total_deductions, 675)
  check('TEST 6 — gross (display) = full monthly', p.gross, 10000)
}
{
  // TEST 7 — fresh month / no attendance at all: the current receivable must
  // be 0 (the attendance service scopes the summary by year+month, so a new
  // month starts empty; at engine level "no attendance" is the same state).
  const p = computePayroll(LOP_STRUCT, {})
  check('TEST 7 — no attendance -> 0 earned days', p.payable_days, 0)
  check('TEST 7 — no attendance -> current receivable 0', p.current_receivable, 0)
  check('TEST 7 — fixed net monthly salary unaffected', p.net_monthly_salary, 9325)
}
{
  // TEST 8 — 3 LOP days: LOP Pay = 3 x 310.83 = 932, Total Deduction =
  // 675 + 932 = 1607, Net = 8393 (the brief's own worked example, Net-based).
  const p = computePayroll(LOP_STRUCT, LOP_DAY(27, 3))
  check('TEST 8 — LOP Pay = 3 x 310.83 = 932', p.lwp_deduction, 932)
  check('TEST 8 — total deduction = 675 + 932 = 1607', p.total_deductions, 1607)
  check('TEST 8 — payable gross NOT reduced (LOP charged once)', p.payable_gross, 10000)
  check('TEST 8 — net = 10000 - 1607 = 8393', p.net, 8393)
  check('TEST 8 — receivable = 27 earned days', p.current_receivable, 8392)
}
{
  // TEST 9 — Phase 7.2 (TASK 3): an attendance struct carrying overtime (and
  // a legacy rate option) must price ZERO overtime — the engine pins the OT
  // keys to 0 — so the receivable and gross never change.
  const p = computePayroll(LOP_STRUCT,
    { expectedWorkingDays: 30, presentDays: 22, paidLeaveDays: 0, payableAbsentDays: 0, overtime: 5 },
    { overtimeRatePerHour: 200 })
  check('TEST 9 — overtime pay = 0 (feature removed)', p.overtime_pay, 0)
  check('TEST 9 — gross = fixed monthly', p.gross, 10000)
  check('TEST 9 — receivable (base earned) = 22 x 310.83 = 6838', p.receivable, 6838)
  check('TEST 9 — current receivable = receivable = 6838', p.current_receivable, 6838)
  check('TEST 9 — receivable_total = current_receivable = 6838', p.receivable_total, 6838)
}
{
  // Case A — 0 present days, 30 LOP days -> nothing is payable.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(0, 30))
  check('CASE A — LOP deduction = 30 x 310.83 = 9325', p.lwp_deduction, 9325)
  check('CASE A — payable gross stays 10000 (deduction flow)', p.payable_gross, 10000)
  check('CASE A — net ≈ 0', p.net, 0)
  check('CASE A — receivable ≈ 0', p.receivable, 0)
}
{
  // Case B — 7 present days, 4 LOP days -> MUST NOT pay the full 10000.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(7, 4))
  check('CASE B — LOP deduction = 4 x 310.83 = 1243', p.lwp_deduction, 1243)
  check('CASE B — total deduction = 675 + 1243 = 1918', p.total_deductions, 1918)
  check('CASE B — net = 10000 - 1918 = 8082', p.net, 8082)
  check('CASE B — receivable = 7 x 310.83 = 2176', p.current_receivable, 2176)
}
{
  // Case C — full attendance, no LOP -> full salary.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(30, 0))
  check('CASE C — no LOP days', p.lwp_days, 0)
  check('CASE C — net = 9325 (brief target)', p.net, 9325)
  check('CASE C — receivable = full net monthly', p.current_receivable, 9325)
}
{
  // Case D — 15 present days, 15 LOP days -> half the month's LOP.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(15, 15))
  check('CASE D — LOP deduction = 15 x 310.83 = 4662', p.lwp_deduction, 4662)
  check('CASE D — total deduction = 675 + 4662 = 5337', p.total_deductions, 5337)
  check('CASE D — net = 10000 - 5337 = 4663', p.net, 4663)
}
{
  // Case E — approved PAID leave must NOT become LOP.
  const p = computePayroll(LOP_STRUCT, LOP_DAY(20, 0, 10))
  check('CASE E — paid leave is not LOP', p.lwp_days, 0)
  check('CASE E — payable days = 20 present + 10 paid leave = 30', p.payable_days, 30)
  check('CASE E — full receivable still earned', p.current_receivable, 9325)
  check('CASE E — net = 9325', p.net, 9325)
}
{
  // Case F — present + LOP together (Phase 7.2 TASK 3: the overtime member of
  // the attendance struct is ignored and never enters gross or receivable).
  const p = computePayroll(LOP_STRUCT,
    { expectedWorkingDays: 30, presentDays: 22, paidLeaveDays: 0, payableAbsentDays: 8, overtime: 5 },
    { overtimeRatePerHour: 200 })
  check('CASE F — LOP deduction = 8 x 310.83 = 2487', p.lwp_deduction, 2487)
  check('CASE F — total deduction = 675 + 2487 = 3162', p.total_deductions, 3162)
  check('CASE F — payable gross stays 10000', p.payable_gross, 10000)
  check('CASE F — overtime pay = 0 (feature removed)', p.overtime_pay, 0)
  check('CASE F — gross = fixed monthly 10000', p.gross, 10000)
  check('CASE F — net = 10000 - 3162 = 6838', p.net, 6838)
  check('CASE F — receivable (base earned) = 22 x 310.83 = 6838', p.receivable, 6838)
  check('CASE F — current receivable = 6838', p.current_receivable, 6838)
  check('CASE F — receivable_total = current_receivable = 6838', p.receivable_total, 6838)
}

// ===========================================================================
// Phase 7.2 (TASK 3) — REQUIRED OVERTIME-REMOVED CASES: any OT figure in the
// attendance struct prices 0 and never reaches the receivable or gross.
// ===========================================================================
{
  const base = { expectedWorkingDays: 30, presentDays: 20, paidLeaveDays: 0, payableAbsentDays: 0 }
  const otCase = (hours) => computePayroll(LOP_STRUCT, { ...base, overtime: hours, overtimeRaw: hours }, { overtimeRatePerHour: 100 })
  const zero = otCase(0)
  check('OT-removed — no overtime pay', zero.overtime_pay, 0)
  check('OT-removed — current receivable = base earned only (20 x 310.83 = 6217)', zero.current_receivable, 6217)
  check('OT-removed — gross = fixed monthly', zero.gross, 10000)
  const two = otCase(2)
  check('OT-removed — 2h claimed still prices 0 hours', two.overtime_hours, 0)
  check('OT-removed — 2h claimed still prices 0 pay', two.overtime_pay, 0)
  check('OT-removed — 2h claimed receivable unchanged = 6217', two.current_receivable, 6217)
  const three = otCase(3)
  check('OT-removed — 3h claimed still prices 0 hours', three.overtime_hours, 0)
  check('OT-removed — 3h claimed still prices 0 pay', three.overtime_pay, 0)
  check('OT-removed — 3h claimed receivable unchanged = 6217', three.current_receivable, 6217)
  const five = otCase(5)
  check('OT-removed — 5h claimed still prices 0 hours', five.overtime_hours, 0)
  check('OT-removed — 5h claimed still prices 0 pay', five.overtime_pay, 0)
  check('OT-removed — 5h claimed receivable unchanged = 6217', five.current_receivable, 6217)
  checkTrue('OT-removed — receivable identity holds (overtime adds nothing)',
    five.current_receivable === five.receivable + five.overtime_pay)
  check('OT-removed — gross = fixed monthly 10000', five.gross, 10000)
}
{
  // Edge cases — real attendance shapes still price on the 30-day basis.
  const realMonth = (present, lwp) => computePayroll(
    { ctc: 120000, monthly: 10000, basic: 5000, pf: 0, esi: 0 },
    { expectedWorkingDays: 26, presentDays: present, paidLeaveDays: 0, payableAbsentDays: lwp, overtime: 0 })
  // A real 26-working-day month with 0 present days deducts 26 LOP days
  // (26 x 310.83 = 8082) — on the 30-day basis that is NOT the whole month,
  // so the residual net stays 1243 (only 30 LOP days floor net at 0).
  const zeroReal = realMonth(0, 26)
  check('EDGE — real 0-present month LOP Pay', zeroReal.lwp_deduction, 8082)
  check('EDGE — real 0-present month net = 10000 - (675+8082) = 1243', zeroReal.net, 1243)
  check('EDGE — real 0-present month receivable 0', zeroReal.current_receivable, 0)
  check('EDGE — 30-day basis regardless of the 26-day period', zeroReal.scheduled_working_days, 30)
  // A real partial month: 7 present, 19 unpaid -> 19 x 310.83 = 5906.
  const partialReal = realMonth(7, 19)
  check('EDGE — real partial month LOP Pay', partialReal.lwp_deduction, 5906)
  check('EDGE — real partial month net = 3419', partialReal.net, 3419)
  check('EDGE — real partial month receivable = 2176', partialReal.current_receivable, 2176)
  // LOP beyond the month must floor at 0, never go negative.
  const over = computePayroll(LOP_STRUCT, LOP_DAY(0, 31))
  check('EDGE — LOP beyond the month floors net at 0', over.net, 0)
  check('EDGE — LOP beyond the month floors receivable at 0', over.receivable, 0)
  // Every case in this section reconciles: net = monthly - (675 + lwp).
  const identities = [0, 1, 4, 8, 15, 19, 26, 30].map((lwp) =>
    computePayroll(LOP_STRUCT, LOP_DAY(lwp < 30 ? 30 - lwp : 0, lwp)))
  checkTrue('EDGE — net always equals monthly - (pf + esi + lwp)',
    identities.every((p) => p.net === Math.max(0, 10000 - (675 + p.lwp_deduction))),
    identities.map((p) => `net=${p.net} lwp=${p.lwp_deduction}`).join(' | '))
  checkTrue('EDGE — payable gross is never reduced by LOP',
    identities.every((p) => p.payable_gross === 10000))
}
{
  // fillPayrollGaps — the stored-row display path must price LOP and the
  // receivable exactly like computePayroll.
  const computed = computePayroll(LOP_STRUCT, LOP_DAY(7, 4))
  const merged = fillPayrollGaps({
    monthly: 10000, basic: 5000, pf: 600, esi: 75,
    lwp_days: 4, lwp_deduction: 0, // stored 0 = written under the old full-salary bug
  }, computed)
  check('FILL — stored lwp_deduction=0 is recomputed from stored lwp_days', merged.lwp_deduction, 1243)
  check('FILL — payable gross on the stored row stays full 10000', merged.payable_gross, 10000)
  check('FILL — gross = fixed monthly (no overtime/bonus)', merged.gross, 10000)
  check('FILL — gross identity on the merged row', merged.gross, merged.payable_gross)
  check('FILL — total deductions = 600 + 75 + 1243 = 1918', merged.total_deductions, 1918)
  check('FILL — net = 10000 - 1918 = 8082', merged.net, 8082)
  check('FILL — net monthly salary fixed at 9325', merged.net_monthly_salary, 9325)
  check('FILL — receivable carried from computed (7 x 310.83)', merged.current_receivable, 2176)
  checkTrue('FILL — stored full salary does not survive', merged.net !== 9325 && merged.net !== 10000,
    `net=${merged.net}`)
}

// ===========================================================================
// Working-day counter (attendance module only — salary never uses it now)
// ===========================================================================
{
  // August 2026: 1st = Saturday. 31 days, 5 Sundays (2,9,16,23,30) -> 26.
  check('Aug 2026 working days excl. Sundays', countWorkingDays('2026-08-01', '2026-08-31'), 26)
  checkTrue('a Sunday-only range is 0 working days',
    countWorkingDays('2026-08-02', '2026-08-02') === 0)
  const holidays = new Set(['2026-08-15', '2026-08-17'])   // Sat + Mon
  check('working days excl. Sundays + 2 holidays',
    countWorkingDays('2026-08-01', '2026-08-31', holidays), 24)
  check('a holiday falling on a Sunday is not double-counted',
    countWorkingDays('2026-08-01', '2026-08-31', new Set(['2026-08-09'])), 26)
  check('Feb 2028 (leap) working days', countWorkingDays('2028-02-01', '2028-02-29'), 25)
  check('Feb 2026 working days', countWorkingDays('2026-02-01', '2026-02-28'), 24)
  check('inverted range yields 0', countWorkingDays('2026-08-31', '2026-08-01'), 0)
}

// ===========================================================================
// ESI — retained (the brief removes only PT / TDS), priced from the FIXED
  // monthly gross — which, since PHASE SALARY RECEIVABLE + LOP + OVERTIME,
  // IS `gross` (overtime/bonus are separate lines that never fold into it).
  {
    const small = { ctc: 240000, monthly: 20000, basic: 10000, pf: 1200, esi: 0 } // monthly 20000, under the 21000 ceiling
  const p = computePayroll(small, { expectedWorkingDays: 26, presentDays: 26, paidLeaveDays: 0, payableAbsentDays: 0, overtime: 0 })
  check('ESI small basic', p.basic, 10000)
  check('ESI at 0.75% below the ceiling', p.esi, Math.round(20000 * 0.0075))
  check('ESI still counts towards deductions', p.total_deductions, 1200 + Math.round(20000 * 0.0075))
  check('no professional tax even below the old threshold', p.professional_tax, 0)
  checkTrue('ESI net identity holds (monthly - deductions)', p.net === p.monthly - p.total_deductions)
  const big = computePayroll(struct, { expectedWorkingDays: 26, presentDays: 26, paidLeaveDays: 0, overtime: 0 })
  check('ESI not applicable above the ceiling', big.esi, 0)

  // The exact brief worked example: CTC 1,20,000 -> monthly (gross) 10000,
  // basic 5000 (50% of gross), pf 600, esi 75, total deductions 675, net 9325.
  const briefCtc = { ctc: 120000, monthly: 10000, basic: 5000, pf: 0, esi: 0 }
  const b = computePayroll(briefCtc, { expectedWorkingDays: 26, presentDays: 26, paidLeaveDays: 0, overtime: 0 })
  check('Brief example — monthly (gross)', b.monthly, 10000)
  check('Brief example — basic = 50% of gross', b.basic, 5000)
  check('Brief example — pf = 12% of basic', b.pf, 600)
  check('Brief example — esi = 0.75% of gross', b.esi, 75)
  check('Brief example — total deduction', b.total_deductions, 675)
  check('Brief example — net', b.net, 9325)
  check('Brief example — net monthly salary', b.net_monthly_salary, 9325)

  // Phase 7.2 (TASK 3): ESI (and the fixed Net) are priced off the FIXED
  // monthly gross — a legacy overtime value in the attendance struct (and a
  // legacy rate option) must not inflate the statutory ESI deduction, and
  // gross cannot grow with overtime because overtime is removed.
  const withOvertime = computePayroll(briefCtc, { expectedWorkingDays: 26, presentDays: 26, paidLeaveDays: 0, overtime: 20 }, { overtimeRatePerHour: 500 })
  check('ESI unaffected by a legacy overtime value', withOvertime.esi, 75)
  check('fixed Net unaffected by a legacy overtime value', withOvertime.net, 9325)
  check('gross stays the fixed monthly (overtime removed)', withOvertime.gross, briefCtc.monthly)
  check('overtime pay still 0 with a legacy rate option', withOvertime.overtime_pay, 0)
}

// ===========================================================================
// Other deductions / bonus (unrelated components must be untouched)
// ===========================================================================
{
  const att = { expectedWorkingDays: 26, presentDays: 26, paidLeaveDays: 0, payableAbsentDays: 0, overtime: 0 }
  const p = computePayroll(struct, att, { otherDeductions: 5000, bonus: 2500 })
  check('bonus does NOT lift gross (fixed monthly)', p.gross, GROSS)
  check('bonus is still reported as its own line', p.bonus, 2500)
  check('advance/other deduction still applied', p.other_deductions, 5000)
  check('total deductions', p.total_deductions, struct.pf + 0 + 0 + 5000)
  checkTrue('net identity holds (monthly - deductions)', p.net === struct.monthly - p.total_deductions)
}

// ===========================================================================
// Invariants
// ===========================================================================
{
  const p = computePayroll(struct, { expectedWorkingDays: 26, presentDays: 0, paidLeaveDays: 0, payableAbsentDays: 26, overtime: 0 },
    { otherDeductions: 999999 })
  checkTrue('net floored at 0', p.net === 0, `net=${p.net}`)
}
{
  const p = computePayroll({ ctc: 999999, monthly: 83333, basic: 41667, pf: 5000, esi: 0 },
    { expectedWorkingDays: 26, presentDays: 21, paidLeaveDays: 0, payableAbsentDays: 3, overtime: 7.5 })
  const moneyKeys = ['basic', 'overtime_pay', 'bonus', 'gross', 'payable_gross',
    'pf', 'esi', 'other_deductions', 'tax', 'professional_tax', 'lwp_deduction',
    'total_deductions', 'net', 'receivable', 'current_receivable', 'receivable_total']
  check('all money values are integers', moneyKeys.filter((k) => !Number.isInteger(p[k])), [])
  checkTrue('net identity holds with fractional overtime (monthly - deductions)',
    p.net === p.payable_gross - p.total_deductions,
    `net=${p.net} monthly=${p.monthly} ded=${p.total_deductions}`)
}

// ===========================================================================
// Payroll month ordering (SALARY BUG 3 regression, unchanged)
// ===========================================================================
{
  check('parse "July 2026"', parsePayrollMonth('July 2026'), { year: 2026, month: 6 })
  check('parse "Jul 2026"', parsePayrollMonth('Jul 2026'), { year: 2026, month: 6 })
  check('parse "2026-07"', parsePayrollMonth('2026-07'), { year: 2026, month: 6 })
  check('unparseable label yields nulls', parsePayrollMonth('whenever'), { year: null, month: null })

  const rows = [
    { month: 'February 2026' }, { month: 'September 2026' }, { month: 'March 2026' },
    { month: 'December 2025' }, { month: 'October 2026' }, { month: 'July 2026' },
  ]
  const lexicographic = [...rows].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
  const chronological = [...rows].sort(comparePayrollMonthDesc)
  check('chronological order',
    chronological.map((r) => r.month),
    ['October 2026', 'September 2026', 'July 2026', 'March 2026', 'February 2026', 'December 2025'])
  checkTrue('the old lexicographic sort picked the WRONG current month',
    lexicographic[0].month !== chronological[0].month,
    `old=${lexicographic[0].month} new=${chronological[0].month}`)
}

console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)