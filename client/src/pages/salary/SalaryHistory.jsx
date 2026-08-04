import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiPrinter, FiDownload, FiFileText, FiX } from 'react-icons/fi'
// Phase 6.12 (TASK 8): `Tabs` and `formatCurrency` were dropped from these
// imports together with the "Salary Reports" card they existed to render here.
// They have zero other references in this file, so leaving them would have been
// dead imports.
import {
  Card, CardHeader, Select, SearchInput, Loader, EmptyState, Button, Modal,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
// Phase 6.12 (TASK 8): SALARY_REPORT_GRANULARITIES / buildSalaryReport are no
// longer imported HERE - they were not deleted, they are now consumed by
// pages/salary/SalaryReport.jsx instead. The shared builder in
// features/salary/salaryDocument.js remains the single aggregation source.
import {
  useMySalary, HISTORY_EXPORT_COLUMNS,
  withParsedMonth, downloadSalaryPdf, printDocument,
} from '@/features/salary/salaryDocument'
import {
  SalaryHeader, SalaryTable, buildHistoryColumns, SalaryDocumentLayout,
} from '@/features/salary/components'

// Phase 6.8 (TASK 3) — dedicated Salary History page.
//
// ROOT CAUSE this page fixes: the Salary page used to embed a full "Salary
// History" table AND a separate "Salary Reports" (Monthly/Quarterly/Yearly)
// block inline, duplicating exactly what a dedicated page should own, with
// its own copy of month parsing + rollup math. FIX: that functionality now
// lives here, reached via the Salary page's "Salary History" button, reusing
// the SAME ['my-salary'] react-query cache (no extra request) and the SAME
// shared mapper (features/salary/salaryDocument.js) for parsing/rollups — no
// salary logic is duplicated, and NO payroll figure is recalculated: every
// number rendered here (gross/deductions/net/pf/tax/status) is read straight
// from the payroll engine's payload.
//
// RBAC: registered as route('/salary/history', SalaryHistory, [ROLES.EMPLOYEE]),
// the SAME guard as '/salary' and '/salary/report'. The API it reads (GET
// /hr/payroll/me/salary) scopes strictly to the caller's own identity.
export default function SalaryHistory() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useMySalary()

  const identity = data?.identity
  const attendance = data?.attendance
  const history = data?.history || []

  // Phase 6.12 (TASK 8): `reportTab` removed - the Monthly/Quarterly/Yearly
  // granularity switch moved to the Salary Report page along with the widget.
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detailsRow, setDetailsRow] = useState(null)

  // Single shared parsing/aggregation source — features/salary/salaryDocument.js.
  const parsedHistory = useMemo(() => withParsedMonth(history), [history])

  // Filters: Payment Status + free-text Search (month label).
  const filteredHistory = useMemo(() => {
    return parsedHistory.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (search && !String(r.month || '').toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [parsedHistory, statusFilter, search])

  if (isLoading) return <Loader label="Loading your salary history\u2026" />

  if (isError) {
    return (
      <div>
        <SalaryHeader
          title="Salary History"
          subtitle="Monthly salary history, timeline and previous payroll records."
          actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/salary')}>Back to Salary</Button>}
        />
        <EmptyState icon={FiFileText} title="No salary history available" description="Please contact HR." />
      </div>
    )
  }

  const historyColumns = buildHistoryColumns({ onViewDetails: (r) => setDetailsRow(r) })

  return (
    <div>
      <SalaryHeader
        title="Salary History"
        subtitle="Monthly salary history, timeline, payment status and previous payroll records."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/salary')}>Back to Salary</Button>}
      />

      {/* Filters + Search */}
      <Card className="mb-4">
        <CardHeader title="Filters" subtitle="Narrow down your payroll records" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SearchInput placeholder="Search by month\u2026" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select
            label="Payment Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'Paid', label: 'Paid' },
              { value: 'Pending', label: 'Pending' },
            ]}
          />
        </div>
      </Card>

      {/* Monthly Salary History / Salary Timeline / Payment Status / Previous
          Payroll Records. Phase 6.12 (TASK 8): this is now the LAST block on the
          page, so its bottom margin was dropped - the removed "Salary Reports"
          card used to sit underneath it and no blank area is left behind. */}
      <Card>
        <CardHeader
          title="Monthly Salary History"
          subtitle="Salary timeline and payment status \u2014 previous payroll records"
          action={<ExportMenu rows={filteredHistory} columns={HISTORY_EXPORT_COLUMNS} filename="my-salary-history" title="My Salary History" subtitle="Skew Enterprise Hub" />}
        />
        <SalaryTable
          columns={historyColumns}
          data={filteredHistory}
          empty="No salary history matches the selected filters"
          onRowClick={(r) => setDetailsRow(r)}
        />
      </Card>

      {/* Phase 6.12 (TASK 8): the "Salary Reports" (Monthly/Quarterly/Yearly)
          card was REMOVED from this page and now lives on the Salary Report
          page, which is the surface actually named after it. It was not
          duplicated and its logic was not rewritten - SalaryReport.jsx imports
          the very same buildSalaryReport()/SALARY_REPORT_GRANULARITIES helpers
          from features/salary/salaryDocument.js that this page used to call. */}

      {/* View Details — reuses the SAME shared document layout as Salary Report,
          scoped to the selected historical record. */}
      {detailsRow && (
        <Modal open onClose={() => setDetailsRow(null)} title={`Salary Details \u2014 ${detailsRow.month || ''}`} size="xl">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2 no-print">
            <Button variant="ghost" size="sm" icon={FiPrinter} onClick={printDocument}>Print</Button>
            <Button
              size="sm"
              icon={FiDownload}
              onClick={() => downloadSalaryPdf(identity, detailsRow, { kind: 'Salary History Details' })}
            >
              Download PDF
            </Button>
            <Button variant="ghost" size="sm" icon={FiX} onClick={() => setDetailsRow(null)}>Close</Button>
          </div>
          <SalaryDocumentLayout
            identity={identity}
            current={detailsRow}
            kind="Salary History Details"
            showAttendance={false}
            showSignature={false}
            printAreaId="salary-history-detail-print-area"
          />
        </Modal>
      )}
    </div>
  )
}
