import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiPrinter, FiDownload, FiFileText } from 'react-icons/fi'
import { Button, Loader, EmptyState, Card, CardHeader, Tabs } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { formatCurrency } from '@/utils'
// Phase 6.12 (TASK 9): SALARY_REPORT_GRANULARITIES + buildSalaryReport are
// IMPORTED, not reimplemented. They are the exact same helpers that used to
// back the "Salary Reports" card on the Salary History page, and they still
// live in the one shared salary mapper, features/salary/salaryDocument.js.
import {
  useMySalary, payPeriodOf, printDocument, downloadSalaryPdf,
  SALARY_REPORT_GRANULARITIES, buildSalaryReport,
} from '@/features/salary/salaryDocument'
import { SalaryHeader, SalaryDocumentLayout, SalaryTable } from '@/features/salary/components'

// Phase 6.7 (TASK 4) / Phase 6.8 (TASK 3) — Employee Salary Report.
//
// This is a PRESENTATION page only. It performs no payroll math: every figure
// is read from the ['my-salary'] payload that the one and only payroll engine
// (server/src/services/payrollEngine.js -> computePayroll) produced. All
// mapping comes from the shared salary mapper (features/salary/salaryDocument.js)
// and all layout comes from the shared SalaryDocumentLayout
// (features/salary/components.jsx).
//
// Phase 6.8 (TASK 3) ROOT CAUSE: the Salary page used to expose a SEPARATE
// "Salary Slip" widget/page (period-filtered payslip export) whose content
// — employee details, earnings/deductions ledger, net pay, signature block —
// duplicated most of this Report page, just laid out differently. FIX: Salary
// Slip's complete content (Salary Slip Information + Signature Section) is now
// part of THIS page via the shared SalaryDocumentLayout (showSignature=true),
// so the Salary Report is the single, complete salary document. The separate
// Salary Slip page/route has been removed — there is no remaining widget or
// route for it (verified by repo-wide search, see the Phase 6.8 report).
//
// RBAC: registered as route('/salary/report', SalaryReport, [ROLES.EMPLOYEE]),
// i.e. exactly the same guard as the existing '/salary' module, and the API it
// reads (GET /hr/payroll/me/salary) scopes strictly to the caller's own
// identity - it cannot return another employee's payroll.
export default function SalaryReport() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useMySalary()

  // Phase 6.12 (TASK 9): report granularity filter (Monthly / Quarterly /
  // Yearly). Declared before the early returns below so the hook order stays
  // stable across the loading / error / loaded renders.
  const [reportTab, setReportTab] = useState('monthly')
  const history = data?.history || []
  // Read-only period ROLLUP of already-computed monthly totals. buildSalaryReport
  // only SUMS gross/deductions/net figures that payrollEngine.computePayroll()
  // already produced server-side - it never re-derives PF, ESI, tax, LWP, gross
  // or net. No payroll arithmetic is performed in React.
  const report = useMemo(() => buildSalaryReport(history, reportTab), [history, reportTab])

  if (isLoading) return <Loader label="Loading your salary report\u2026" />

  const identity = data?.identity
  const current = data?.current
  const attendance = data?.attendance

  if (isError || !current) {
    return (
      <div>
        <SalaryHeader
          title="Salary Report"
          subtitle="Detailed breakdown of your current pay period."
          actions={
            <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/salary')}>
              Back to Salary
            </Button>
          }
        />
        <EmptyState
          icon={FiFileText}
          title="No salary data available yet"
          description="Your salary structure has not been set up and no payroll run exists for you yet. Please contact HR."
        />
      </div>
    )
  }

  // Same currency rendering the card used on its previous host page, so the
  // moved widget looks identical to before.
  const reportColumns = report.columns.map((c) => ({
    ...c,
    render: c.key === 'period' || c.key === 'month' || c.key === 'count'
      ? undefined
      : (r) => formatCurrency(r[c.key]),
  }))

  return (
    <div>
      <SalaryHeader
        title="Salary Report"
        subtitle={`Complete salary document \u00b7 ${payPeriodOf(current)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/salary')}>
              Back
            </Button>
            <Button variant="ghost" icon={FiPrinter} onClick={printDocument}>
              Print
            </Button>
            <Button
              icon={FiDownload}
              onClick={() => downloadSalaryPdf(identity, current, { kind: 'Salary Report' })}
            >
              Download PDF
            </Button>
          </div>
        }
      />

      {/* The single shared document shell (TASK 4). Includes Company
          Information, Employee Information, Payroll Details, Earnings,
          Deductions, Net Pay, Payment Status, Attendance context, Generated
          Date, Signature and Footer — i.e. the complete salary document,
          which now also carries the former Salary Slip content. */}
      <SalaryDocumentLayout
        identity={identity}
        current={current}
        attendance={attendance}
        kind="Salary Report"
        showSignature
        showAttendance
      />

      {/* Phase 6.12 (TASK 9): the "Salary Reports" widget MOVED here from the
          Salary History page (TASK 8), gaining the Monthly / Quarterly / Yearly
          filters this page was asked for. Nothing was duplicated: the rows, the
          columns and the export columns all come from the shared
          buildSalaryReport() rollup, and every underlying figure originates
          from the single ['my-salary'] payload produced by payrollEngine. */}
      <Card className="mt-4">
        <CardHeader
          title="Salary Reports"
          subtitle="Aggregated by period"
          action={<ExportMenu rows={report.rows} columns={report.exportCols} filename={`my-salary-${reportTab}`} title={`My Salary \u2014 ${reportTab}`} subtitle="Skew Enterprise Hub" />}
        />
        <div className="mb-4 overflow-x-auto">
          <Tabs items={SALARY_REPORT_GRANULARITIES} value={reportTab} onChange={setReportTab} />
        </div>
        <SalaryTable columns={reportColumns} data={report.rows} empty="No data for this report" />
      </Card>
    </div>
  )
}
