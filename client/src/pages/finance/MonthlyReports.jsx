import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiCalendar, FiTrendingUp, FiTrendingDown, FiDollarSign } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, DataTable, Loader, Select } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { RevenueChart, BarsChart } from '@/components/charts/Charts'
import { formatCurrency } from '@/utils'

const YEARS = [2024, 2025, 2026, 2027]

export default function MonthlyReports() {
  const [year, setYear] = useState(2026)
  const { data: report, isLoading } = useQuery({
    queryKey: ['finance-period-month', year],
    queryFn: () => financeApi.periodReport('month', year),
  })

  if (isLoading || !report) return <Loader label="Building monthly report…" />

  const income = report.reduce((s, r) => s + (r.income || 0), 0)
  const expense = report.reduce((s, r) => s + (r.expense || 0), 0)
  const net = income - expense

  const chartData = report.map((r) => ({ month: r.period, revenue: r.income, expense: r.expense }))
  const netData = report.map((r) => ({ period: r.period, net: r.net }))

  const columns = [
    { key: 'period', header: 'Month', render: (r) => <span className="font-medium">{r.period}</span> },
    { key: 'income', header: 'Income', render: (r) => formatCurrency(r.income) },
    { key: 'expense', header: 'Expense', render: (r) => formatCurrency(r.expense) },
    { key: 'net', header: 'Net', render: (r) => <span className={r.net >= 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>{formatCurrency(r.net)}</span> },
    { key: 'count', header: 'Txns' },
  ]

  return (
    <div>
      <PageHeader
        title="Monthly Reports"
        subtitle="Month-wise profit & loss for the selected year."
        actions={
          <ExportMenu
            rows={report} filename={`monthly-report-${year}`} title={`Monthly Report ${year}`}
            columns={[
              { header: 'Month', accessor: 'period' }, { header: 'Income', accessor: 'income' },
              { header: 'Expense', accessor: 'expense' }, { header: 'Net', accessor: 'net' },
              { header: 'Txns', accessor: 'count' },
            ]}
          />
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select className="sm:w-40" value={year} onChange={(e) => setYear(Number(e.target.value))}
          options={YEARS.map((y) => ({ value: y, label: String(y) }))} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={`${year} Income`} value={formatCurrency(income)} icon={FiTrendingUp} tone="success" />
        <StatCard label={`${year} Expense`} value={formatCurrency(expense)} icon={FiTrendingDown} tone="danger" />
        <StatCard label={`${year} Net`} value={formatCurrency(net)} icon={FiDollarSign} tone="primary" />
        <StatCard label="Months" value={report.length} icon={FiCalendar} tone="accent" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Cash Flow" subtitle={`Monthly revenue vs expense — ${year}`} />
          <RevenueChart data={chartData} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Net per Month" />
          <BarsChart data={netData} xKey="period" bars={[{ key: 'net', color: '#06B6D4' }]} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Monthly Breakdown" />
        <DataTable columns={columns} data={report} empty="No data for this year" />
      </Card>
    </div>
  )
}
