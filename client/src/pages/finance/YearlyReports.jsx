import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiPieChart, FiTrendingUp, FiTrendingDown, FiDollarSign, FiPercent } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, DataTable, Loader, Select } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { BarsChart } from '@/components/charts/Charts'
import { formatCurrency } from '@/utils'

const YEARS = [2024, 2025, 2026, 2027]

export default function YearlyReports() {
  const [year, setYear] = useState(2026)
  const { data: annual, isLoading } = useQuery({
    queryKey: ['finance-period-year', year],
    queryFn: () => financeApi.periodReport('year', year),
  })
  const { data: monthly = [] } = useQuery({
    queryKey: ['finance-period-month-for-year', year],
    queryFn: () => financeApi.periodReport('month', year),
  })

  if (isLoading || !annual) return <Loader label="Building yearly report…" />

  const row = annual[0] || { period: String(year), income: 0, expense: 0, net: 0, count: 0 }
  const margin = row.income ? Math.round((row.net / row.income) * 100) : 0
  const chartData = monthly.map((r) => ({ period: r.period, income: r.income, expense: r.expense }))

  const columns = [
    { key: 'period', header: 'Year', render: (r) => <span className="font-medium">{r.period}</span> },
    { key: 'income', header: 'Income', render: (r) => formatCurrency(r.income) },
    { key: 'expense', header: 'Expense', render: (r) => formatCurrency(r.expense) },
    { key: 'net', header: 'Net', render: (r) => <span className={r.net >= 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>{formatCurrency(r.net)}</span> },
    { key: 'count', header: 'Txns' },
  ]

  return (
    <div>
      <PageHeader
        title="Yearly Reports"
        subtitle="Annual profit & loss summary."
        actions={
          <ExportMenu
            rows={annual} filename={`yearly-report-${year}`} title={`Yearly Report ${year}`}
            columns={[
              { header: 'Year', accessor: 'period' }, { header: 'Income', accessor: 'income' },
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
        <StatCard label={`${year} Income`} value={formatCurrency(row.income)} icon={FiTrendingUp} tone="success" />
        <StatCard label={`${year} Expense`} value={formatCurrency(row.expense)} icon={FiTrendingDown} tone="danger" />
        <StatCard label={`${year} Net`} value={formatCurrency(row.net)} icon={FiDollarSign} tone="primary" />
        <StatCard label="Margin" value={`${margin}%`} icon={FiPercent} tone="accent" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly Breakdown" subtitle={`Income vs expense through ${year}`} />
          <BarsChart data={chartData} xKey="period" bars={[{ key: 'income', color: '#10B981' }, { key: 'expense', color: '#EF4444' }]} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Annual Summary" />
        <DataTable columns={columns} data={annual} empty="No data for this year" />
      </Card>
    </div>
  )
}
