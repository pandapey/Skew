import { useQuery } from '@tanstack/react-query'
import { FiTrendingUp, FiTrendingDown, FiDollarSign, FiPercent } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, Loader } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { RevenueChart, DonutChart, BarsChart } from '@/components/charts/Charts'
import { formatCurrency } from '@/utils'

// Dedicated analytics view: cash-flow, category mix, budget vs actual and tax.
export default function Charts() {
  const { data: stats, isLoading } = useQuery({ queryKey: ['finance-stats'], queryFn: financeApi.stats })
  const { data: tax } = useQuery({ queryKey: ['finance-tax'], queryFn: financeApi.taxReport })

  if (isLoading || !stats) return <Loader label="Loading analytics…" />

  const taxData = (() => {
    if (!tax) return []
    const rates = [...new Set([...tax.outputRows.map((r) => r.rate), ...tax.inputRows.map((r) => r.rate)])].sort((a, b) => a - b)
    return rates.map((rate) => {
      const out = tax.outputRows.find((r) => r.rate === rate)
      const inp = tax.inputRows.find((r) => r.rate === rate)
      return { rate: `${rate}%`, output: out ? out.tax : 0, input: inp ? inp.tax : 0 }
    })
  })()

  const budgetData = stats.budgets.map((b) => ({ name: b.category, allocated: b.allocated, spent: b.spent }))

  return (
    <div>
      <PageHeader
        title="Finance Analytics"
        subtitle="Visualise cash flow, category mix, budgets and tax."
        actions={
          <ExportMenu
            rows={stats.monthlyTrend} filename="finance-cashflow" title="Cash Flow"
            columns={[
              { header: 'Month', accessor: 'month' }, { header: 'Revenue', accessor: 'revenue' },
              { header: 'Expense', accessor: 'expense' },
            ]}
          />
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Income" value={formatCurrency(stats.totalIncome)} icon={FiTrendingUp} tone="success" />
        <StatCard label="Total Expense" value={formatCurrency(stats.totalExpense)} icon={FiTrendingDown} tone="danger" />
        <StatCard label="Net Profit" value={formatCurrency(stats.netProfit)} icon={FiDollarSign} tone="primary" />
        <StatCard label="Profit Margin" value={`${stats.profitMargin}%`} icon={FiPercent} tone="accent" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Cash Flow" subtitle="Revenue vs Expense" />
          <RevenueChart data={stats.monthlyTrend} />
        </Card>
        <Card>
          <CardHeader title="Income by Category" />
          <DonutChart data={stats.incomeByCategory} />
        </Card>
        <Card>
          <CardHeader title="Expenses by Category" />
          <DonutChart data={stats.expenseByCategory} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Budget — Allocated vs Spent" />
          <BarsChart data={budgetData} xKey="name" bars={[{ key: 'allocated', color: '#2563EB' }, { key: 'spent', color: '#F59E0B' }]} />
        </Card>
      </div>

      {tax && (
        <Card>
          <CardHeader title="Tax by Rate" subtitle="Output vs Input" />
          <BarsChart data={taxData} xKey="rate" bars={[{ key: 'output', color: '#10B981' }, { key: 'input', color: '#EF4444' }]} />
        </Card>
      )}
    </div>
  )
}
