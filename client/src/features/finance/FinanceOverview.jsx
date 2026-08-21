import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FiTrendingUp, FiTrendingDown, FiDollarSign, FiPercent, FiFileText,
  FiCreditCard, FiAlertCircle,
} from 'react-icons/fi'
import { financeApi } from '@/api/services'
import { Card, StatCard, Loader } from '@/components/ui'
import { FINANCE_SECTIONS } from '@/features/finance/constants'
import { cn, formatCurrency } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function FinanceOverview({ showKpis = true, showModules = true }) {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery({ queryKey: ['finance-stats'], queryFn: financeApi.stats })

  if (isLoading || !stats) return <Loader label="Loading finance overview…" />

  return (
    <div>
      {showKpis && (
        <>
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
        </>
      )}

      {/* Section grid */}
      {showModules && (
        <>
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
                    <span className="text-muted transition group-hover:translate-x-1 group-hover:text-primary">›</span>
                  </div>
                  <h3 className="mt-3 font-semibold">{s.label}</h3>
                  <p className="text-sm text-muted">{s.desc}</p>
                </Card>
              </motion.button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
