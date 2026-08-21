import { useQuery } from '@tanstack/react-query'
import {
  FiUsers, FiTrello, FiTarget, FiUserCheck, FiPlus, FiArrowRight,
  FiTrendingUp, FiClock,
} from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { dashboardService } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { CardHeader, StatCard, Badge, Avatar, Button, CardSkeleton, PageHeader } from '@/components/ui'
import { RevenueChart, BarsChart } from '@/components/charts/Charts'
import { GlassChartContainer, GlassWidget } from '@/components/glass'
import { DateTimeWidget } from '@/features/dashboard/DateTimeWidget'
import { CheckInButton } from '@/features/attendance/CheckInCard'
import { cn, formatDate } from '@/utils'

export default function ClassicDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === ROLES.ADMIN
  const isManager = user?.role === ROLES.MANAGER
  const hidePendingLeave = isAdmin || isManager
  const hideRevenueChart = isManager
  const revenueSideIsMeetings = isAdmin
  const attendanceFullWidth = isAdmin || isManager
  const hideBottomRow = isAdmin
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.stats })

  const quickActions = [
    { label: 'Add Employee', to: '/employees', icon: FiUsers },
    { label: 'New Project', to: '/projects', icon: FiTrello },
    { label: 'Apply Leave', to: '/attendance/leave', icon: FiUserCheck },
  ]

  const quickActionsWidget = (
    <GlassWidget>
      <CardHeader title="Quick Actions" />
      <div className="grid grid-cols-2 gap-3">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.to)}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-app bg-black/[0.02] p-4 text-center text-sm font-medium transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 dark:bg-white/[0.03]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
              <a.icon className="h-5 w-5" />
            </span>
            {a.label}
          </button>
        ))}
      </div>
    </GlassWidget>
  )

  const meetingsWidget = (
    <GlassWidget>
      <CardHeader
        title="Upcoming Meetings"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/calendar')}>
            Calendar
          </Button>
        }
      />
      <div className="space-y-2.5">
        {!isLoading && !data?.meetings?.length && (
          <p className="py-6 text-center text-sm text-muted">No upcoming events. Add one in the calendar.</p>
        )}
        {data?.meetings?.map((m) => (
          <button
            type="button"
            key={m.id}
            onClick={() => navigate(m.start ? `/calendar?date=${String(m.start).slice(0, 10)}` : '/calendar')}
            className="flex w-full items-center gap-3 rounded-2xl border border-app p-3 text-left transition hover:border-primary/40 focus-visible:border-primary"
          >
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent/10 text-accent">
              <FiClock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.title}</p>
              <p className="text-xs text-muted">
                {m.time} \u00b7 {m.attendees} attendees
              </p>
            </div>
          </button>
        ))}
      </div>
    </GlassWidget>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0]} \ud83d\udc4b`}
        subtitle="Here's what's happening across your organization today."
        actions={
          (isManager)
            ? <CheckInButton />
            : (
              <Button icon={FiPlus} glow onClick={() => navigate('/projects/new')}>
                New Project
              </Button>
            )
        }
      />

      <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', hidePendingLeave ? 'xl:grid-cols-3' : 'xl:grid-cols-4')}>
        <StatCard label="Total Employees" value={data?.employees ?? '\u2014'} icon={FiUsers} trend={data?.trends?.employees} delay={0} onClick={() => navigate('/employees')} />
        <StatCard label="Active Projects" value={data?.projects ?? '\u2014'} icon={FiTrello} tone="accent" trend={data?.trends?.projects} delay={0.05} onClick={() => navigate('/projects')} />
        <StatCard label={(isAdmin || isManager) ? 'Clients' : 'Clients / Leads'} value={data?.clients ?? '\u2014'} icon={FiTarget} tone="success" trend={data?.trends?.clients} delay={0.1} onClick={() => navigate('/clients')} />
        {!hidePendingLeave && <StatCard label="Pending Leaves" value={data?.pendingLeaves ?? '\u2014'} icon={FiUserCheck} tone="warning" trend={data?.trends?.pendingLeaves} delay={0.15} onClick={() => navigate('/attendance/leave')} />}
      </div>

      {!hideRevenueChart && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassChartContainer
          className="lg:col-span-2"
          title="Revenue vs Expense"
          subtitle="Monthly cash flow"
          action={
            typeof data?.trends?.revenue === 'number' ? (
              <Badge tone={data.trends.revenue >= 0 ? 'success' : 'danger'}>
                <FiTrendingUp className="mr-1" />
                {data.trends.revenue >= 0 ? '+' : ''}{data.trends.revenue}%
              </Badge>
            ) : null
          }
        >
          {isLoading ? <CardSkeleton /> : <RevenueChart data={data.revenue} />}
        </GlassChartContainer>
        {revenueSideIsMeetings && meetingsWidget}
      </div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassChartContainer
          className={cn(attendanceFullWidth ? 'lg:col-span-3' : 'lg:col-span-2')}
          title="Weekly Attendance"
          subtitle="Present vs Absent"
        >
          {isLoading ? (
            <CardSkeleton />
          ) : (
            <BarsChart
              data={data.attendance}
              xKey="day"
              bars={[
                { key: 'present', color: '#10B981' },
                { key: 'absent', color: '#EF4444' },
              ]}
            />
          )}
        </GlassChartContainer>

        {!isAdmin && (
          <div className="space-y-4">{quickActionsWidget}</div>
        )}
      </div>

      {!hideBottomRow && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {!isAdmin && <GlassWidget>
          <CardHeader
            title="My Tasks"
            action={
              <div className="flex items-center gap-2">
                <Badge tone="primary">{data?.tasks?.length || 0}</Badge>
                <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/projects')}>
                  Projects
                </Button>
              </div>
            }
          />
          <div className="space-y-2.5">
            {!isLoading && !data?.tasks?.length && (
              <p className="py-6 text-center text-sm text-muted">No open tasks yet.</p>
            )}
            {data?.tasks?.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => navigate(t.projectId ? `/projects/${t.projectId}` : '/projects')}
                className="flex w-full items-center justify-between rounded-2xl border border-app p-3 text-left transition hover:border-primary/40 focus-visible:border-primary"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-8 w-1.5 flex-none rounded-full bg-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted">Due {formatDate(t.due)}</p>
                  </div>
                </div>
                <Badge>{t.priority}</Badge>
              </button>
            ))}
          </div>
        </GlassWidget>}

        {meetingsWidget}

        {!isAdmin && <GlassWidget key="recent-activity">
          <CardHeader title="Recent Activity" />
          <div className="space-y-3.5">
            {!isLoading && !data?.activities?.length && (
              <p className="py-6 text-center text-sm text-muted">No recent activity yet.</p>
            )}
            {data?.activities?.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <Avatar name={a.user} size={32} />
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{a.user}</span>{' '}
                    <span className="text-muted">{a.action}</span>
                  </p>
                  <p className="text-xs text-muted">{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassWidget>}
      </div>}

      {!isAdmin && <DateTimeWidget />}
    </div>
  )
}
