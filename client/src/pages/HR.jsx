import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FiBriefcase, FiUsers, FiUserPlus, FiCalendar, FiFileText,
  FiDollarSign, FiTrendingUp, FiLogOut, FiArrowRight,
} from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { PageHeader, Card, StatCard, Loader, Badge } from '@/components/ui'
import { HR_SECTIONS } from '@/features/hr/constants'
import { cn, formatCurrency } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function HR() {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery({ queryKey: ['hr-stats'], queryFn: hrApi.stats })

  if (isLoading) return <Loader label="Loading HR overview…" />

  return (
    <div>
      <PageHeader title="HR Management" subtitle="Recruitment, payroll, performance and the full employee lifecycle." />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Headcount" value={stats.totalHeadcount} icon={FiUsers} />
        <StatCard label="Open Jobs" value={stats.openJobs} icon={FiUserPlus} tone="success" />
        <StatCard label="Interviews" value={stats.interviewsScheduled} icon={FiCalendar} tone="warning" />
        <StatCard label="Pending Offers" value={stats.pendingOffers} icon={FiFileText} tone="accent" />
      </div>
      {/* Phase 6.15 (TASK 2) ROOT CAUSE: "Headcount by Department" and
          "Recruitment Pipeline" were the only two widgets in this row (a
          lg:grid-cols-3 grid with nothing else in it), so removing them left a
          dead, empty row rather than a gap next to other content. Deleting the
          whole row - instead of leaving two empty Card slots - is what actually
          "removes the empty space" and rebalances the layout; the KPI grid
          above and the HR Modules grid below already fill the page width on
          every breakpoint, so nothing needs to expand to compensate. The
          underlying stats.headcountByDept / stats.byStage data and the
          hrApi.stats endpoint are untouched - Reports.jsx and HrReports.jsx
          still render the same charts from the same data for the roles that
          use them there, so no other role or page is affected. */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Departments" value={stats.totalDepartments} icon={FiBriefcase} />
        <StatCard label="Monthly Payroll" value={formatCurrency(stats.monthlyPayroll)} icon={FiDollarSign} tone="success" />
        <StatCard label="Pending Reviews" value={stats.pendingReviews} icon={FiTrendingUp} tone="warning" />
        <StatCard label="Attrition (Qtr)" value={stats.attrition} icon={FiLogOut} tone="danger" />
      </div>

      {/* Section grid */}
      <h2 className="mb-3 mt-6 text-sm font-semibold text-muted">HR Modules</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {HR_SECTIONS.map((s, i) => (
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
