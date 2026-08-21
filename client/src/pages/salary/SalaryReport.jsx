import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FiArrowLeft, FiPrinter, FiDownload, FiFileText } from 'react-icons/fi'
import { Button, Loader, EmptyState, Card, CardHeader, Tabs } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { formatCurrency } from '@/utils'
import {
  useMySalary, payPeriodOf, printDocument, downloadSalaryPdf,
  SALARY_REPORT_GRANULARITIES, buildSalaryReport,
} from '@/features/salary/salaryDocument'
import { SalaryHeader, SalaryDocumentLayout, SalaryTable } from '@/features/salary/components'

export default function SalaryReport() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useMySalary({ portal: true })
  const [reportTab, setReportTab] = useState('monthly')
  const history = data?.history || []
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
            <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/profile/salary')}>
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
            <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/profile/salary')}>
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

      <SalaryDocumentLayout
        identity={identity}
        current={current}
        attendance={attendance}
        kind="Salary Report"
        showSignature
        showAttendance
      />

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
