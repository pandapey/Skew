// Phase 6.7 (TASK 4 + TASK 5) — shared salary DOCUMENT layer.
// Phase 6.8 (TASK 2) — this file is now the ONE shared salary mapper /
// view-model consumed by every salary surface: the Salary page (MySalary),
// the Salary History page, the Salary Report (which also carries the former
// Salary Slip content — see TASK 3), the dashboard SalaryWidget/SalarySummaryCard,
// and PDF export. No page may redefine this mapping.
//
// WHY THIS FILE EXISTS (and why it is not a second payroll engine):
// Every salary surface needs the SAME field mapping, the SAME data source and
// the SAME PDF/print behaviour. Without a shared layer each page would grow
// its own copy of "which key is HRA / which key is ESI", which is exactly the
// duplication the brief forbids. So the mapping lives here ONCE.
//
// CRITICAL: there is NO payroll arithmetic in this file beyond `Number(x || 0)`
// coercion for display and simple period ROLLUPS (summing already-computed
// monthly totals into quarterly/yearly report rows for read-only reporting).
// Every underlying figure - gross, each deduction, totalDeductions, net - is
// read STRAIGHT off the payload produced by the one and only payroll engine,
// server/src/services/payrollEngine.js -> computePayroll(), surfaced by
// GET /hr/payroll/me/salary. Nothing is recalculated on the client; the
// monthly/quarterly/yearly rollup below only ADDS already-server-computed
// numbers together for display grouping, it never derives PF/ESI/tax/gross/
// net/etc. from raw inputs.
//
// Data flow (unchanged by Phase 6.8):
//   MongoDB (Payroll + Employee.salary + Attendance)
//     -> attendanceService.mySummary() + payrollEngine.computePayroll()
//     -> GET /hr/payroll/me/salary  (protect; scoped to the session identity)
//     -> hrApi.payroll.mySalary()
//     -> react-query key ['my-salary']   (SHARED across every salary surface)
//     -> this shared mapper
//     -> UI (MySalary, SalaryHistory, SalaryReport, SalaryWidget, SalarySummaryCard)

import { useQuery } from '@tanstack/react-query'
import { hrApi } from '@/api/services'
import { formatDate } from '@/utils'
import { exportToPdf } from '@/utils/export'
import { COMPANY_NAME } from '@/constants'

// Reuses the EXACT query key already used by pages/MySalary.jsx and
// features/dashboard/widgets/SalaryWidget.jsx, so navigating between any
// salary surface serves the cached payload - no extra request, no chance of
// two pages disagreeing about a figure.
export function useMySalary() {
  return useQuery({ queryKey: ['my-salary'], queryFn: () => hrApi.payroll.mySalary() })
}

// Earnings / deductions field maps. Keys are the snake_case keys returned by
// computePayroll() and passed through by the /payroll/me/salary handler.
export const EARNING_FIELDS = [
  { key: 'basic', label: 'Basic Salary' },
  { key: 'hra', label: 'HRA' },
  { key: 'allowances', label: 'Allowances' },
  { key: 'overtime_pay', label: 'Overtime' },
  { key: 'bonus', label: 'Bonus' },
]

export const DEDUCTION_FIELDS = [
  { key: 'pf', label: 'Provident Fund (PF)' },
  { key: 'esi', label: 'ESI' },
  { key: 'professional_tax', label: 'Professional Tax' },
  { key: 'tax', label: 'TDS / Income Tax' },
  { key: 'lwp_deduction', label: 'Leave Deduction (LWP)' },
  { key: 'other_deductions', label: 'Other Deductions' },
]

const amount = (v) => Number(v || 0)

// Read-only projection of the payload. No summing, no rates, no formulas.
export const lineItems = (current, fields) =>
  fields.map((f) => ({ key: f.key, label: f.label, amount: amount(current?.[f.key]) }))

export const earningsOf = (current) => lineItems(current, EARNING_FIELDS)
export const deductionsOf = (current) => lineItems(current, DEDUCTION_FIELDS)

// Totals come from the server payload - they are NOT re-derived here.
export const grossOf = (current) => amount(current?.gross)
export const totalDeductionsOf = (current) => amount(current?.totalDeductions)
export const netOf = (current) => amount(current?.net)

export const payPeriodOf = (current) =>
  current?.month || 'Current period \u00b7 not yet processed'

export const paymentDateOf = (current) =>
  current?.paymentDate ? formatDate(current.paymentDate) : 'Not paid yet'

export const paymentStatusOf = (current) => current?.status || 'Not Processed'

export const generatedOn = () => formatDate(new Date(), 'DD MMM YYYY, hh:mm A')

// Native browser print. Chosen deliberately over adding html2canvas/react-to-print:
// the project had NO print utility at all (verified by grep), and pulling in a
// new dependency for this would be heavier than the @media print rules added to
// client/src/index.css. Elements marked `.no-print` are hidden when printing.
export function printDocument() {
  window.print()
}

// PDF download. Reuses the EXISTING generator in client/src/utils/export.js
// (jsPDF + autotable + the Skew branded header band). Phase 6.8 (TASK 5):
// this remains the ONLY salary PDF code path — both the Salary Report (which
// now also carries the former Salary Slip content) and the Salary History
// "View Details" export call this same function. No second PDF generator is
// introduced anywhere.
export const SALARY_PDF_COLUMNS = [
  { header: 'Section', accessor: 'section' },
  { header: 'Component', accessor: 'component' },
  { header: 'Amount (INR)', accessor: 'amount' },
]

export function salaryPdfRows(identity, current) {
  return [
    { section: 'Employee', component: 'Name', amount: identity?.name || '\u2014' },
    { section: 'Employee', component: 'Employee ID', amount: identity?.empCode || '\u2014' },
    { section: 'Employee', component: 'Department', amount: identity?.department || '\u2014' },
    { section: 'Employee', component: 'Designation', amount: identity?.designation || '\u2014' },
    { section: 'Period', component: 'Pay Period', amount: payPeriodOf(current) },
    ...earningsOf(current).map((l) => ({ section: 'Earnings', component: l.label, amount: l.amount })),
    { section: 'Earnings', component: 'Gross Salary', amount: grossOf(current) },
    ...deductionsOf(current).map((l) => ({ section: 'Deductions', component: l.label, amount: l.amount })),
    { section: 'Deductions', component: 'Total Deductions', amount: totalDeductionsOf(current) },
    { section: 'Net', component: 'Net Salary', amount: netOf(current) },
    { section: 'Payment', component: 'Payment Status', amount: paymentStatusOf(current) },
    { section: 'Payment', component: 'Payment Date', amount: paymentDateOf(current) },
  ]
}

export function downloadSalaryPdf(identity, current, { kind = 'Salary Report' } = {}) {
  const rows = salaryPdfRows(identity, current)
  if (!rows.length) return
  const period = payPeriodOf(current).replace(/[^a-zA-Z0-9]+/g, '-')
  const file = `${kind.replace(/\s+/g, '-')}-${identity?.empCode || 'employee'}-${period}.pdf`
  exportToPdf(file, rows, SALARY_PDF_COLUMNS, {
    title: `${kind} \u00b7 ${identity?.name || ''}`.trim(),
    subtitle: `${COMPANY_NAME} \u00b7 ${payPeriodOf(current)}`,
  })
}

// ---------------------------------------------------------------------------
// Phase 6.8 (TASK 2 + TASK 3) — Salary History mapping.
//
// Moved here, verbatim in behaviour, from the old inline "Salary History" /
// "Salary Reports" cards on pages/MySalary.jsx so the Salary History page can
// reuse the EXACT same parsing + aggregation instead of a second copy. This is
// read-only period ROLLUP of already-computed history rows (from GET
// /hr/payroll/me/salary), never a recalculation of an individual month's
// payroll.
// ---------------------------------------------------------------------------

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Parse a Payroll.month label into { monthIdx, year }. Supports "July 2026",
// "Jul 2026" and "2026-07"; returns nulls when unparseable (never guesses).
export function parseMonthLabel(label) {
  if (!label) return { monthIdx: null, year: null }
  const iso = /^(\d{4})-(\d{2})/.exec(label)
  if (iso) return { monthIdx: Number(iso[2]) - 1, year: Number(iso[1]) }
  const parts = String(label).trim().split(/\s+/)
  if (parts.length === 2) {
    const idx = MONTHS.findIndex((m) => m.toLowerCase().startsWith(parts[0].toLowerCase()))
    const yr = Number(parts[1])
    if (idx >= 0 && yr) return { monthIdx: idx, year: yr }
  }
  return { monthIdx: null, year: null }
}

// Enrich raw history rows (server payload) with parsed month/year, used for
// grouping, filtering and search across the Salary History page.
export const withParsedMonth = (history) =>
  (history || []).map((r) => ({ ...r, ...parseMonthLabel(r.month) }))

export const HISTORY_EXPORT_COLUMNS = [
  { header: 'Month', accessor: 'month' },
  { header: 'Gross', accessor: (r) => r.gross },
  { header: 'PF', accessor: (r) => r.pf },
  { header: 'Tax', accessor: (r) => r.tax },
  { header: 'Deductions', accessor: (r) => r.deductions },
  { header: 'Net Salary', accessor: (r) => r.net },
  { header: 'Status', accessor: 'status' },
  { header: 'Payment Date', accessor: (r) => (r.paymentDate ? formatDate(r.paymentDate) : 'Not paid') },
]

export const SALARY_REPORT_GRANULARITIES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
]

// Builds the Monthly / Quarterly / Yearly "Salary Reports" table shown on the
// Salary History page. Quarterly/yearly rows are a straight SUM of the
// already-computed monthly `gross` / `deductions` / `net` figures — read-only
// display rollup, not a payroll recalculation.
export function buildSalaryReport(history, granularity) {
  const parsed = withParsedMonth(history)
  if (granularity === 'monthly') {
    return {
      rows: parsed,
      columns: [
        { key: 'month', header: 'Month' },
        { key: 'gross', header: 'Gross' },
        { key: 'deductions', header: 'Deductions' },
        { key: 'net', header: 'Net Salary' },
      ],
      exportCols: [
        { header: 'Month', accessor: 'month' },
        { header: 'Gross', accessor: (r) => r.gross },
        { header: 'Deductions', accessor: (r) => r.deductions },
        { header: 'Net', accessor: (r) => r.net },
      ],
    }
  }
  const bucket = {}
  parsed.forEach((r) => {
    if (r.year == null) return
    const key = granularity === 'quarterly' ? `Q${Math.floor(r.monthIdx / 3) + 1} ${r.year}` : String(r.year)
    bucket[key] ??= { period: key, gross: 0, deductions: 0, net: 0, count: 0 }
    bucket[key].gross += r.gross || 0
    bucket[key].deductions += r.deductions || 0
    bucket[key].net += r.net || 0
    bucket[key].count += 1
  })
  const rows = Object.values(bucket)
  return {
    rows,
    columns: [
      { key: 'period', header: granularity === 'quarterly' ? 'Quarter' : 'Year' },
      { key: 'count', header: 'Months' },
      { key: 'gross', header: 'Gross' },
      { key: 'deductions', header: 'Deductions' },
      { key: 'net', header: 'Net Salary' },
    ],
    exportCols: [
      { header: granularity === 'quarterly' ? 'Quarter' : 'Year', accessor: 'period' },
      { header: 'Months', accessor: 'count' },
      { header: 'Gross', accessor: (r) => r.gross },
      { header: 'Deductions', accessor: (r) => r.deductions },
      { header: 'Net', accessor: (r) => r.net },
    ],
  }
}
