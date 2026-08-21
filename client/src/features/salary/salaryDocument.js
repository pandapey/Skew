import { useQuery } from '@tanstack/react-query'
import { hrApi } from '@/api/services'
import { formatDate } from '@/utils'
import { exportToPdf } from '@/utils/export'
import { COMPANY_NAME } from '@/constants'

export const SALARY_PORTAL_CONTEXT = 'salary-portal'

export function useMySalary({ portal = false } = {}) {
  return useQuery({
    queryKey: ['my-salary'],
    queryFn: () => hrApi.payroll.mySalary(portal ? { context: SALARY_PORTAL_CONTEXT } : {}),
  })
}

export const EARNING_FIELDS = [
  { key: 'monthly', label: 'Gross Salary' },
  { key: 'bonus', label: 'Bonus' },
]

export const DEDUCTION_FIELDS = [
  { key: 'pf', label: 'Provident Fund (PF)' },
  { key: 'esi', label: 'ESI' },
  { key: 'other_deductions', label: 'Other Deductions' },
  { key: 'lwp_deduction', label: 'Loss of Pay (LOP)' },
]

const amount = (v) => Number(v || 0)

// Read-only projection of the payload. No summing, no rates, no formulas.
export const lineItems = (current, fields) =>
  fields.map((f) => ({ key: f.key, label: f.label, amount: amount(current?.[f.key]) }))

export const earningsOf = (current) => lineItems(current, EARNING_FIELDS)
export const deductionsOf = (current) => lineItems(current, DEDUCTION_FIELDS)

// Totals come from the server payload - they are NOT re-derived here.
export const grossOf = (current) => amount(current?.gross)

export const totalEarningsOf = (current) =>
  earningsOf(current).reduce((sum, line) => sum + amount(line.amount), 0)

export const totalDeductionsOf = (current) => amount(current?.totalDeductions)

export const netOf = (current) => amount(current?.net_monthly_salary ?? current?.net)

export const payPeriodOf = (current) =>
  current?.month || 'Current period \u00b7 not yet processed'

export const paymentDateOf = (current) =>
  current?.paymentDate ? formatDate(current.paymentDate) : 'Not paid yet'

export const paymentStatusOf = (current) => current?.status || 'Not Processed'

export const generatedOn = () => formatDate(new Date(), 'DD MMM YYYY, hh:mm A')

export function printDocument() {
  window.print()
}

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

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

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

export const withParsedMonth = (history) =>
  (history || []).map((r) => ({ ...r, ...parseMonthLabel(r.month) }))

export const HISTORY_EXPORT_COLUMNS = [
  { header: 'Month', accessor: 'month' },
  { header: 'Gross', accessor: (r) => r.gross },
  { header: 'PF', accessor: (r) => r.pf },
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
