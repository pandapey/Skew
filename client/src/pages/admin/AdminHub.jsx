import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FiUsers, FiShield, FiKey, FiActivity, FiDatabase, FiFileText,
  FiArrowRight, FiServer,
} from 'react-icons/fi'
import { PageHeader, Card, CardHeader, StatCard, Loader, Badge } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { adminApi } from '@/api/adminApi'
import { ADMIN_SECTIONS } from '@/features/admin/constants'
import { cn, formatBytes } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function AdminHub() {
  const navigate = useNavigate()
  const { data: stats, isLoading } = useQuery({ queryKey: ['admin-stats'], queryFn: adminApi.stats })
  const { data: health } = useQuery({ queryKey: ['admin-db-health'], queryFn: adminApi.dbHealth })
  const { data: analytics } = useQuery({ queryKey: ['admin-analytics'], queryFn: adminApi.analytics })

  if (isLoading) return <Loader label="Loading admin overview…" />

  const storagePct = health?.storageTotal ? Math.round((health.storageUsed / health.storageTotal) * 100) : 0

  return (
    <div>
      <PageHeader title="Admin Console" subtitle="Users, roles, plans, security, system health and platform configuration." />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={stats.totalUsers} icon={FiUsers} />
        <StatCard label="Active Sessions" value={stats.liveSessions} icon={FiActivity} tone="warning" />
        <StatCard label="API Keys" value={stats.activeApiKeys} icon={FiKey} tone="success" />
        <StatCard label="Roles" value={stats.totalRoles} icon={FiShield} tone="accent" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Audit Events" value={stats.auditCount} icon={FiFileText} />
        <StatCard label="System Errors" value={stats.systemErrors} icon={FiServer} tone="danger" />
        <StatCard label="DB Latency" value={`${stats.dbLatency}ms`} icon={FiDatabase} tone="success" />
        <StatCard label="Last Backup" value={stats.lastBackup.replace(' 0', ' ')} icon={FiServer} tone="accent" />
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="User Growth" subtitle="Registered accounts over time" />
          {analytics && <BarsChart data={analytics.userGrowth} xKey="month" bars={[{ key: 'users', color: '#2563EB' }]} />}
        </Card>
        <Card>
          <CardHeader title="Role Distribution" />
          {analytics && <DonutChart data={analytics.roleDistribution} />}
        </Card>
      </div>

      {/* Storage + sections */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Database Storage" />
          {health && (
            <div className="space-y-3">
              <div className="flex items-end justify-between">
                <p className="text-2xl font-bold">{formatBytes(health.storageUsed)}</p>
                <p className="text-sm text-muted">of {formatBytes(health.storageTotal)}</p>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div className="h-full rounded-full bg-primary" style={{ width: `${storagePct}%` }} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <Badge tone={health.status === 'Healthy' ? 'success' : 'warning'}>{health.status}</Badge>
                <span className="text-muted">{health.version}</span>
              </div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Admin Modules" subtitle="Jump to any configuration area" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ADMIN_SECTIONS.filter((s) => s.key !== 'dashboard').map((s, i) => (
              <motion.button
                key={s.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => navigate(s.path)}
                className="group flex items-center gap-3 rounded-xl border border-app p-3 text-left transition hover:border-primary hover:shadow-soft"
              >
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONE_BG[s.tone])}>
                  <s.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{s.label}</p>
                  <p className="truncate text-xs text-muted">{s.desc}</p>
                </div>
                <FiArrowRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-1 group-hover:text-primary" />
              </motion.button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
