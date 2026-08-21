import {
  Card, CardHeader, Badge, PageHeader, DataTable,
} from '@/components/ui'
import { formatCurrency } from '@/utils'
import { COMPANY_NAME } from '@/constants'
import {
  earningsOf, deductionsOf, totalEarningsOf, totalDeductionsOf, netOf,
  payPeriodOf, paymentDateOf, paymentStatusOf, generatedOn,
} from './salaryDocument'

export function SalaryHeader({ title, subtitle, actions, noPrint = true }) {
  const header = <PageHeader title={title} subtitle={subtitle} actions={actions} />
  return noPrint ? <div className="no-print">{header}</div> : header
}

export function SalaryStatusCard({ status }) {
  const tone = status === 'Paid' ? 'success' : status === 'Pending' ? 'warning' : 'default'
  return <Badge tone={tone}>{status || 'Not Processed'}</Badge>
}

// --- Row / Detail primitives (shared by EmployeeSalaryInfo, sections, etc.) --
export function SalaryRow({ label, value, strong, tone }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-app py-2 last:border-0">
      <span className={strong ? 'text-sm font-semibold' : 'text-sm text-muted'}>{label}</span>
      <span
        className={
          strong
            ? `text-sm font-bold ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : ''}`
            : 'text-sm font-medium'
        }
      >
        {value}
      </span>
    </div>
  )
}

export function SalaryDetail({ label, value }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="min-w-[110px] text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

export function EmployeeSalaryInfo({ identity, current, layout = 'grid', extraRows = [] }) {
  if (layout === 'compact') {
    return (
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SalaryDetail label="Employee" value={identity?.name || '\u2014'} />
        <SalaryDetail label="Employee ID" value={identity?.empCode || '\u2014'} />
        <SalaryDetail label="Department" value={identity?.department || '\u2014'} />
        <SalaryDetail label="Designation" value={identity?.designation || '\u2014'} />
        <SalaryDetail label="Salary Month" value={payPeriodOf(current)} />
        <SalaryDetail label="Payment Date" value={paymentDateOf(current)} />
      </section>
    )
  }
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Employee Information</h3>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <SalaryRow label="Employee Name" value={identity?.name || '\u2014'} />
        <SalaryRow label="Employee ID" value={identity?.empCode || '\u2014'} />
        <SalaryRow label="Department" value={identity?.department || '\u2014'} />
        <SalaryRow label="Designation" value={identity?.designation || '\u2014'} />
        <SalaryRow label="Pay Period" value={payPeriodOf(current)} />
        {extraRows.map((r) => (
          <SalaryRow key={r.label} label={r.label} value={r.value} />
        ))}
      </div>
    </section>
  )
}

export function SalaryPeriodCard({ current }) {
  return (
    <SalaryRow
      label="Data Source"
      value={current?.source === 'payroll' ? 'Processed payroll run' : 'Salary structure (not yet processed)'}
    />
  )
}

export function EarningsSection({ current, note }) {
  const earnings = earningsOf(current)
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Earnings</h3>
      {earnings.map((l) => (
        <SalaryRow key={l.key} label={l.label} value={formatCurrency(l.amount)} />
      ))}
      <SalaryRow label="Total Earnings" value={formatCurrency(totalEarningsOf(current))} strong tone="success" />
      {note}
    </section>
  )
}

export function DeductionsSection({ current, note }) {
  const deductions = deductionsOf(current)
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Deductions</h3>
      {deductions.map((l) => (
        <SalaryRow key={l.key} label={l.label} value={formatCurrency(l.amount)} />
      ))}
      <SalaryRow label="Total Deductions" value={formatCurrency(totalDeductionsOf(current))} strong tone="danger" />
      {note}
    </section>
  )
}

// --- NetPayCard --------------------------------------------------------------
export function NetPayCard({ current }) {
  const status = paymentStatusOf(current)
  return (
    <section className="print-plain flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-app p-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Net Salary</p>
        <p className="text-2xl font-extrabold">{formatCurrency(netOf(current))}</p>
      </div>
      <div className="text-right">
        <p className="text-xs uppercase tracking-wide text-muted">Payment Status</p>
        <SalaryStatusCard status={status} />
        <p className="mt-1 text-xs text-muted">Payment Date: {paymentDateOf(current)}</p>
      </div>
    </section>
  )
}

export function SalarySummaryCard({ current }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-app bg-surface/60 px-4 py-2.5 shadow-floating-sm">
      <div className="text-right">
        <p className="text-[10px] uppercase tracking-wide text-muted">Salary Summary</p>
        <p className="text-sm font-bold">{payPeriodOf(current)}</p>
      </div>
      <SalaryStatusCard status={paymentStatusOf(current)} />
    </div>
  )
}

export function buildSalarySummaryCards(current, attendance, icons) {
  const {
    FiDollarSign, FiMinusCircle, FiCalendar, FiClock,
    FiShield, FiHeart, FiAlertCircle, FiWatch,
    FiTrendingUp, FiCreditCard,
  } = icons
  return [
    { label: 'Gross Salary', value: current.monthly ?? current.gross ?? 0, format: formatCurrency, icon: FiDollarSign, tone: 'primary' },

    { label: 'PF', value: current.pf ?? 0, format: formatCurrency, icon: FiShield, tone: 'accent' },

    { label: 'ESI', value: current.esi ?? 0, format: formatCurrency, icon: FiHeart, tone: 'accent' },

    { label: 'LOP', value: current.lwp_days ?? 0, icon: FiAlertCircle, tone: 'warning' },

    { label: 'Late Entry Days', value: attendance?.lateDays ?? 0, icon: FiWatch, tone: 'warning' },

    { label: 'Total Deduction', value: current.totalDeductions ?? 0, format: formatCurrency, icon: FiMinusCircle, tone: 'danger' },

    { label: 'Payable Days', value: current.payable_days ?? 0, icon: FiCalendar, tone: 'success' },

    { label: 'Net Monthly Salary', value: current.net_monthly_salary ?? current.net ?? 0, format: formatCurrency, icon: FiTrendingUp, tone: 'success' },

    { label: 'Daily Payable Amount', value: current.daily_payable_amount ?? current.daily_payable_rate ?? 0, format: formatCurrency, icon: FiClock, tone: 'default' },

    { label: 'Current Receivable Salary', value: current.current_receivable ?? current.receivable ?? 0, format: formatCurrency, icon: FiCreditCard, tone: 'primary' },

  ]
}

export function SalaryTable({ data, columns, empty = 'No salary records found', onRowClick }) {
  return <DataTable columns={columns} data={data} empty={empty} onRowClick={onRowClick} />
}

export function buildHistoryColumns({ onViewDetails } = {}) {
  return [
    { key: 'month', header: 'Month', render: (r) => <span className="font-medium">{r.month || '\u2014'}</span> },
    { key: 'gross', header: 'Gross', render: (r) => formatCurrency(r.gross) },
    { key: 'deductions', header: 'Deductions', render: (r) => formatCurrency(r.deductions) },
    { key: 'net', header: 'Net Salary', render: (r) => formatCurrency(r.net) },
    { key: 'status', header: 'Payment Status', render: (r) => <SalaryStatusCard status={r.status} /> },
    { key: 'paymentDate', header: 'Payment Date', render: (r) => (r.paymentDate ? r.paymentDate : '\u2014') },
    ...(onViewDetails
      ? [{
          key: 'actions',
          header: '',
          render: (r) => (
            <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onViewDetails(r) }}>
              View Details
            </button>
          ),
        }]
      : []),
  ]
}

export function SalaryDocumentLayout({
  identity,
  current,
  attendance,
  kind = 'Salary Report',
  showSignature = true,
  showAttendance = true,
  printAreaId = 'salary-print-area',
}) {
  const status = paymentStatusOf(current)
  return (
    <div id={printAreaId}>
      <Card className="print-plain overflow-hidden p-0">
        {/* Company Information */}
        <div className="print-band bg-primary px-6 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{COMPANY_NAME}</h2>
              <p className="text-xs opacity-90">Enterprise Office Management — {kind}</p>
            </div>
            <div className="text-right text-xs opacity-90">
              <p>Pay Period: {payPeriodOf(current)}</p>
              <p>Generated: {generatedOn()}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Employee Information + Payroll Details */}
          <EmployeeSalaryInfo
            identity={identity}
            current={current}
            extraRows={[{ label: 'Data Source', value: current?.source === 'payroll' ? 'Processed payroll run' : 'Salary structure (not yet processed)' }]}
          />

          {/* Earnings + Deductions (Salary Slip Information) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

            <EarningsSection current={current} />

            <DeductionsSection current={current} />
          </div>

          {/* Net Pay + Payment Status */}
          <NetPayCard current={current} />

          {/* Attendance context (same payload, no extra request) */}
          {showAttendance && attendance ? (
            <section>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Attendance For This Period</h3>

              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <SalaryRow label="Approved Leave Days" value={attendance.leaveDays ?? '\u2014'} />
                <SalaryRow label="Late Entry Days" value={attendance.lateDays ?? '\u2014'} />
                <SalaryRow label="Loss of Pay" value={current?.lwp_days ?? '\u2014'} />
                <SalaryRow label="Company Holidays" value={attendance.holidayDays ?? '\u2014'} />
                <SalaryRow label="Payable Days" value={current?.payable_days ?? 0} />
                <SalaryRow label="Daily Payable Amount" value={formatCurrency(current?.daily_payable_amount ?? 0)} />
                <SalaryRow label="Current Receivable Salary" value={formatCurrency(current?.current_receivable ?? current?.receivable ?? 0)} />
              </div>
            </section>
          ) : null}

          {/* Signature Section */}
          {showSignature ? (
            <section className="grid grid-cols-1 gap-8 pt-2 sm:grid-cols-2">
              <div>
                <div className="h-12 border-b border-app" />
                <p className="pt-2 text-xs text-muted">Employee Signature</p>
              </div>
              <div className="sm:text-right">
                <div className="h-12 border-b border-app" />
                <p className="pt-2 text-xs text-muted">Authorised Signatory \u00b7 {COMPANY_NAME}</p>
              </div>
            </section>
          ) : null}

          {/* Footer */}
          <p className="border-t border-app pt-4 text-center text-xs text-muted">
            This is a system-generated {kind.toLowerCase()} from {COMPANY_NAME}. Figures are sourced from the company
            payroll records and recorded attendance. Generated on {generatedOn()}. This document does not require a
            physical signature to be valid.
          </p>
        </div>
      </Card>
    </div>
  )
}

export { CardHeader }
