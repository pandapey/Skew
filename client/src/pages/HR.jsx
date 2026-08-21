import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FiBriefcase, FiUsers,
  FiDollarSign, FiArrowRight,
} from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { PageHeader, Card, StatCard, Loader } from '@/components/ui'
import { HR_SECTIONS, HR_ADMIN_HIDDEN_MODULES } from '@/features/hr/constants'
import { FINANCE_SECTIONS } from '@/features/finance/constants'
import FinanceOverview from '@/features/finance/FinanceOverview'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { cn, formatCurrency } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function HR() {
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const isAdmin = hasRole([ROLES.ADMIN])
  const sections = [
    ...HR_SECTIONS.filter(
      (s) => s.key !== 'finance' && (!isAdmin || !HR_ADMIN_HIDDEN_MODULES.includes(s.key))
    ),
    ...FINANCE_SECTIONS,
  ]
  const { data: stats, isLoading } = useQuery({ queryKey: ['hr-stats'], queryFn: hrApi.stats })

  if (isLoading) return <Loader label="Loading HR overview..." />

  return (
    <div>
      <PageHeader title="HR" subtitle="People, payroll, performance and the full employee lifecycle." />

      {/* Counts first - every statistic in one block */}
      <h2 className="mb-3 text-sm font-semibold text-muted">Statistics</h2>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Employees" value={stats.totalHeadcount} icon={FiUsers} />
        <StatCard label="Departments" value={stats.totalDepartments} icon={FiBriefcase} />
        <StatCard label="Monthly Payroll" value={formatCurrency(stats.monthlyPayroll)} icon={FiDollarSign} tone="success" />
      </div>
      <div className="mb-4">
        <FinanceOverview showModules={false} />
      </div>

      {/* Module cards second - HR and Finance modules in ONE grid */}
      <h2 className="mb-3 mt-6 text-sm font-semibold text-muted">Modules</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sections.map((s, i) => (
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