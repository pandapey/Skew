// Phase 6.8 (TASK 1 + TASK 4) — shared Salary UI component library.
//
// Every dedicated salary surface (Salary, Salary History, Salary Report —
// which now also carries the former Salary Slip content) composes its screen
// from THESE building blocks instead of hand-rolling its own markup. This is
// what makes "ONE Salary Layout" true: SalaryDocumentLayout at the bottom of
// this file is the single shared document shell reused by the Salary Report
// page, the Salary History "View Details" drawer, and (via the same
// identity/current data) PDF export (features/salary/salaryDocument.js).
//
// All building blocks are read-only projections of the shared mapper
// (features/salary/salaryDocument.js) and reuse the EXISTING design-system
// primitives from @/components/ui — no new visual language is introduced.

import {
  Card, CardHeader, Badge, PageHeader, DataTable,
} from '@/components/ui'
import { formatCurrency } from '@/utils'
import { COMPANY_NAME } from '@/constants'
import {
  earningsOf, deductionsOf, grossOf, totalDeductionsOf, netOf,
  payPeriodOf, paymentDateOf, paymentStatusOf, generatedOn,
} from './salaryDocument'

// --- SalaryHeader ---------------------------------------------------------
// Thin wrapper over the shared PageHeader so every salary page declares its
// title/subtitle/actions the same way. `noPrint` wraps the header in the
// existing `.no-print` convention (see styles) used by Report/Slip printing.
export function SalaryHeader({ title, subtitle, actions, noPrint = true }) {
  const header = <PageHeader title={title} subtitle={subtitle} actions={actions} />
  return noPrint ? <div className="no-print">{header}</div> : header
}

// --- SalaryStatusCard ------------------------------------------------------
// Payment status badge, reused anywhere a status needs to render consistently.
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

// --- EmployeeSalaryInfo -----------------------------------------------------
// Employee identity block used on the Salary Report / History details.
// `layout="grid"` (Report-style Row grid) or `layout="compact"` (Slip-style
// Detail grid) selects presentation only — same identity fields either way.
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

// --- SalaryPeriodCard -------------------------------------------------------
// Compact "Pay Period + data source provenance" strip, used on Salary Report.
export function SalaryPeriodCard({ current }) {
  return (
    <SalaryRow
      label="Data Source"
      value={current?.source === 'payroll' ? 'Processed payroll run' : 'Salary structure (not yet processed)'}
    />
  )
}

// --- EarningsSection / DeductionsSection ------------------------------------
// Read-only projection of the shared mapper's earningsOf/deductionsOf. No
// arithmetic beyond the Number() coercion already done in the mapper.
export function EarningsSection({ current, note }) {
  const earnings = earningsOf(current)
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Earnings</h3>
      {earnings.map((l) => (
        <SalaryRow key={l.key} label={l.label} value={formatCurrency(l.amount)} />
      ))}
      <SalaryRow label="Gross Salary" value={formatCurrency(grossOf(current))} strong tone="success" />
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

// --- SalarySummaryCards ------------------------------------------------------
// The Salary page's StatCard grid, extracted so the card definitions live in
// exactly one place. Consumers pass the StatCard component (kept generic to
// avoid a circular import on @/components/ui) plus icon set.
export function buildSalarySummaryCards(current, attendance, icons) {
  const {
    FiDollarSign, FiTrendingUp, FiMinusCircle, FiCalendar, FiLogIn, FiClock,
    FiUmbrella, FiZap, FiShield, FiHeart, FiPercent, FiCreditCard,
  } = icons
  return [
    { label: 'Gross Salary', value: formatCurrency(current.gross), icon: FiDollarSign, tone: 'primary' },
    { label: 'Net Salary', value: formatCurrency(current.net), icon: FiTrendingUp, tone: 'success' },
    { label: 'Receivable Salary', value: formatCurrency(current.receivable), icon: FiCreditCard, tone: 'primary' },
    { label: 'Total Deductions', value: formatCurrency(current.totalDeductions), icon: FiMinusCircle, tone: 'danger' },
    { label: 'Working Days', value: attendance?.workingDays ?? 0, icon: FiCalendar, tone: 'primary' },
    { label: 'Present Days', value: attendance?.presentDays ?? 0, icon: FiLogIn, tone: 'success' },
    { label: 'Leave Days', value: attendance?.leaveDays ?? 0, icon: FiUmbrella, tone: 'accent' },
    { label: 'Overtime Hours', value: `${current.overtime_hours ?? attendance?.overtime ?? 0}h`, icon: FiZap, tone: 'warning' },
    { label: 'Overtime Pay', value: formatCurrency(current.overtime_pay ?? 0), icon: FiZap, tone: 'warning' },
    { label: 'PF', value: formatCurrency(current.pf), icon: FiShield, tone: 'accent' },
    { label: 'ESI', value: formatCurrency(current.esi ?? 0), icon: FiHeart, tone: 'accent' },
    { label: 'Professional Tax', value: formatCurrency(current.professional_tax ?? 0), icon: FiPercent, tone: 'warning' },
    { label: 'LWP Deduction', value: formatCurrency(current.lwp_deduction ?? 0), icon: FiMinusCircle, tone: 'danger' },
    { label: 'TDS / Tax', value: formatCurrency(current.tax), icon: FiPercent, tone: 'warning' },
    { label: 'Daily Rate', value: formatCurrency(current.daily_rate ?? 0), icon: FiClock, tone: 'default' },
    // Phase 6.12 (TASK 7): the 'Hourly Rate' card was REMOVED from this shared
    // builder, which is the SINGLE definition of the salary StatCard grid
    // (consumed by pages/MySalary.jsx and the My Profile -> Salary tab). Because
    // the list is defined exactly once, deleting the entry removes the widget
    // everywhere at once and the responsive grid simply reflows to close the
    // gap - there is no per-page card list to keep in sync and no empty slot
    // left behind. NOTE: this only drops the DISPLAY card. `hourly_rate` is
    // still computed by payrollEngine.computePayroll() and still returned by
    // GET /hr/payroll/me/salary, because overtime pay is derived from it
    // server-side; removing it from the engine would corrupt overtime.
  ]
}

// --- SalaryTable --------------------------------------------------------------
// Thin DataTable wrapper with the shared history column set, so the History
// page and any future salary list reuse the same column definitions.
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

// --- SalaryDocumentLayout -----------------------------------------------------
// THE single shared document shell (TASK 4). Used by:
//   * Salary Report page (full salary document, includes the former Salary
//     Slip content — TASK 3)
//   * Salary History "View Details" panel (same shell, historical record)
//   * PDF export shares the same underlying data (features/salary/salaryDocument.js)
//     even though the PDF itself is a tabular render via the existing
//     exportToPdf utility, not a re-implementation of this layout.
//
// Sections, in order: Company Information, Employee Information, Payroll
// Details/Period, Earnings, Deductions, Net Pay, Payment Status, Generated
// Date, Signature, Footer — exactly the shared-section list required by the
// brief. `showSignature` is on by default (Salary Report / payslip use), and
// can be turned off for lighter contexts if ever needed.
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
            <EarningsSection
              current={current}
              note={current?.overtime_hours ? (
                <p className="pt-2 text-xs text-muted">
                  Overtime is based on {current.overtime_hours} recorded hour(s) at 1.5\u00d7 the hourly rate.
                </p>
              ) : null}
            />
            <DeductionsSection
              current={current}
              note={current?.lwp_days ? (
                <p className="pt-2 text-xs text-muted">
                  Leave deduction covers {current.lwp_days} loss-of-pay day(s).
                </p>
              ) : null}
            />
          </div>

          {/* Net Pay + Payment Status */}
          <NetPayCard current={current} />

          {/* Attendance context (same payload, no extra request) */}
          {showAttendance && attendance ? (
            <section>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Attendance For This Period</h3>
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <SalaryRow label="Working Days" value={attendance.workingDays ?? '\u2014'} />
                <SalaryRow label="Present Days" value={attendance.presentDays ?? '\u2014'} />
                <SalaryRow label="Absent Days" value={attendance.absentDays ?? '\u2014'} />
                <SalaryRow label="Leave Days" value={attendance.leaveDays ?? '\u2014'} />
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
