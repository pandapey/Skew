import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiPrinter, FiDownload, FiFileText, FiX } from 'react-icons/fi'
import {
  Card, CardHeader, Select, SearchInput, Loader, EmptyState, Button, Modal,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import {
  useMySalary, HISTORY_EXPORT_COLUMNS,
  withParsedMonth, downloadSalaryPdf, printDocument,
} from '@/features/salary/salaryDocument'
import {
  SalaryHeader, SalaryTable, buildHistoryColumns, SalaryDocumentLayout,
} from '@/features/salary/components'

export default function SalaryHistory() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useMySalary({ portal: true })

  const identity = data?.identity
  const attendance = data?.attendance
  const history = data?.history || []

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detailsRow, setDetailsRow] = useState(null)

  const parsedHistory = useMemo(() => withParsedMonth(history), [history])

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
          actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/profile/salary')}>Back to Salary</Button>}
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
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/profile/salary')}>Back to Salary</Button>}
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
