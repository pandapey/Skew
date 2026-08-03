import { useQuery } from '@tanstack/react-query'
import { FiUsers, FiKey, FiActivity, FiBarChart2, FiTrendingUp } from 'react-icons/fi'
import { PageHeader, Card, CardHeader, StatCard, Loader } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { adminApi } from '@/api/adminApi'
import { formatNumber, pctChange } from '@/utils'

export default function Analytics() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-analytics'], queryFn: adminApi.analytics })

  if (isLoading || !data) return <Loader label="Crunching analytics…" />

  const userGrowth = data.userGrowth || []
  const apiKeyUsage = data.apiKeyUsage || []
  const logVolume = data.logVolume || []
  const activeSessionTrend = data.activeSessionTrend || []

  const totalUsers = userGrowth.length ? userGrowth[userGrowth.length - 1].users : 0
  // Real growth: latest month vs the previous month in the series (hidden when
  // there isn't enough history to compare).
  const growthPct = userGrowth.length >= 2
    ? pctChange(userGrowth[userGrowth.length - 1].users, userGrowth[userGrowth.length - 2].users)
    : undefined
  const totalCalls = apiKeyUsage.reduce((s, k) => s + k.calls, 0)
  const totalLogs = logVolume.reduce((s, d) => s + d.info + d.warn + d.error, 0)
  const peakSession = activeSessionTrend.length ? Math.max(...activeSessionTrend.map((s) => s.sessions)) : 0

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Platform usage, growth and system trends." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={formatNumber(totalUsers)} icon={FiUsers} trend={growthPct} />
        <StatCard label="API Calls" value={formatNumber(totalCalls)} icon={FiKey} tone="accent" />
        <StatCard label="Log Events" value={formatNumber(totalLogs)} icon={FiActivity} tone="warning" />
        <StatCard label="Peak Sessions" value={peakSession} icon={FiTrendingUp} tone="success" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="User Growth" subtitle="Registered accounts" />
          <BarsChart data={data.userGrowth} xKey="month" bars={[{ key: 'users', color: '#2563EB' }]} />
        </Card>
        <Card>
          <CardHeader title="Role Distribution" />
          <DonutChart data={data.roleDistribution} />
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Log Volume" subtitle="By level, this week" />
          <BarsChart data={data.logVolume} xKey="day" bars={[{ key: 'info', color: '#06B6D4' }, { key: 'warn', color: '#F59E0B' }, { key: 'error', color: '#EF4444' }]} />
        </Card>
        <Card>
          <CardHeader title="API Key Usage" subtitle="Calls per key" />
          <BarsChart data={data.apiKeyUsage} xKey="name" bars={[{ key: 'calls', color: '#10B981' }]} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Module Usage" subtitle="Active screens (% of sessions)" />
          <BarsChart data={data.moduleUsage} xKey="name" bars={[{ key: 'value', color: '#8B5CF6' }]} />
        </Card>
        <Card>
          <CardHeader title="Live Session Trend" subtitle="Sessions by hour" />
          <BarsChart data={data.activeSessionTrend} xKey="hour" bars={[{ key: 'sessions', color: '#2563EB' }]} />
        </Card>
      </div>
    </div>
  )
}
