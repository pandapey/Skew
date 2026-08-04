import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FiTrendingUp, FiTrendingDown, FiDollarSign, FiPercent, FiFileText,
  FiCreditCard, FiAlertCircle, FiArrowRight,
} from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { PageHeader, Card, CardHeader, StatCard, Loader } from '@/components/ui'
import { RevenueChart, DonutChart } from '@/components/charts/Charts'
import { FINANCE_SECTIONS } from '@/features/finance/constants'
import { cn, formatCurrency } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

// Finance dashboard / hub: KPIs, cash-flow + category charts, budget utilisation
// and a section grid that deep-links into every Finance sub-module.
export default function FinanceDashboard() {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery({ queryKey: ['finance-stats'], queryFn: financeApi.stats })

  if (isLoading || !stats) return <Loader label="Loading finance overview…" />

  const budgetPct = stats.totalBudget ? Math.round((stats.budgetSpent / stats.totalBudget) * 100) : 0

  return (
    <div>
      <PageHeader
        title="Finance Management"
        subtitle="Income, expenses, invoices, budgets and reports — end to end."
        actions={
          <button
            onClick={() => navigate('/finance/charts')}
            className="btn-ghost"
          >
            <FiArrowRight className="h-4 w-4" /> View Analytics
          </button>
        }
      />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Income" value={formatCurrency(stats.totalIncome)} icon={FiTrendingUp} tone="success" />
        <StatCard label="Total Expense" value={formatCurrency(stats.totalExpense)} icon={FiTrendingDown} tone="danger" />
        <StatCard label="Net Profit" value={formatCurrency(stats.netProfit)} icon={FiDollarSign} tone="primary" />
        <StatCard label="Profit Margin" value={`${stats.profitMargin}%`} icon={FiPercent} tone="accent" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Invoices" value={stats.totalInvoices} icon={FiFileText} />
        <StatCard label="Outstanding" value={formatCurrency(stats.outstandingAmount)} icon={FiAlertCircle} tone="warning" />
        <StatCard label="Overdue" value={formatCurrency(stats.overdueAmount)} icon={FiAlertCircle} tone="danger" />
        <StatCard label="Payments In" value={formatCurrency(stats.incomingPayments)} icon={FiCreditCard} tone="success" />
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Cash Flow" subtitle="Revenue vs Expense" />
          <RevenueChart data={stats.monthlyTrend} />
        </Card>
        <Card>
          <CardHeader title="Expenses by Category" />
          <DonutChart data={stats.expenseByCategory} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Budget Utilisation" subtitle={`${formatCurrency(stats.budgetSpent)} of ${formatCurrency(stats.totalBudget)} spent (${budgetPct}%)`} />
          <div className="space-y-3 pt-1">
            {stats.budgets.slice(0, 6).map((b) => {
              const pct = b.allocated ? Math.min(100, Math.round((b.spent / b.allocated) * 100)) : 0
              return (
                <div key={b.id || b.category}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium">{b.category}</span>
                    <span className="text-muted">{formatCurrency(b.spent)} / {formatCurrency(b.allocated)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                    <div className={cn('h-full rounded-full', pct > 100 || b.status === 'Over Budget' ? 'bg-danger' : pct > 85 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
        <Card>
          <CardHeader title="Income by Category" />
          <DonutChart data={stats.incomeByCategory} />
        </Card>
      </div>

      {/* Section grid */}
      <h2 className="mb-3 mt-6 text-sm font-semibold text-muted">Finance Modules</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {FINANCE_SECTIONS.map((s, i) => (
          <motion.button
            key={s.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => navigate(s.path)}
            className="group text-left"
          >
            <Card className="h-full transition hover:-translate-y-0.5 hover:border-primary hover:shadow-card">
              <div className="flex items-start justify-between">
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', TONE_BG[s.tone])}>
                  <s.icon className="h-5 w-5" />
                </div>
                <FiArrowRight className="text-muted transition group-hover:translate-x-1 group-hover:text-primary" />
              </div>
              <h3 className="mt-3 font-semibold">{s.label}</h3>
              <p className="text-sm text-muted">{s.desc}</p>
            </Card>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
