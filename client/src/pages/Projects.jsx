import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  FiFolder, FiActivity, FiCheckCircle, FiAlertCircle, FiFlag,
  FiTrendingUp, FiArrowRight, FiColumns, FiPlus,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { PageHeader, Card, CardHeader, StatCard, Badge, Avatar, Loader, Button, EmptyState } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { PROJECT_SECTIONS, PROJECT_STATUS_TONE, PRIORITY_TONE, PROJECT_WRITE_ROLES, MANAGER_HIDDEN_SECTION_KEYS } from '@/features/projects/constants'
import { cn, formatDate } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function Projects() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)
  const isEmployee = hasRole(ROLES.EMPLOYEE)
  const isManager = user?.role === ROLES.MANAGER
  const isAdmin = user?.role === ROLES.ADMIN
  const visibleSections = (isManager || isAdmin)
    ? PROJECT_SECTIONS.filter((sec) => !MANAGER_HIDDEN_SECTION_KEYS.includes(sec.key))
    : PROJECT_SECTIONS
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('newProject') !== '1') return
    const incomingClient = searchParams.get('client') || ''
    searchParams.delete('newProject')
    searchParams.delete('client')
    setSearchParams(searchParams, { replace: true })
    if (canWrite) {
      navigate(`/projects/new${incomingClient ? `?client=${encodeURIComponent(incomingClient)}` : ''}`, { replace: true })
    }
  }, [searchParams, canWrite, setSearchParams, navigate])

  const { data: stats, isLoading, isError: statsError, error: statsErr } = useQuery({ queryKey: ['project-stats'], queryFn: projectApi.stats, enabled: !isEmployee })
  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })


  if (isLoading) return <Loader label="Loading projects…" />

  if (isEmployee) {
    if (projectsLoading) return <Loader label="Loading your projects…" />
    const mine = projects || []
    return (
      <div>
        <PageHeader title="My Projects" subtitle="Projects you're assigned to." />
        {mine.length === 0 ? (
          <Card>
            <EmptyState title="No projects assigned to you" description="When you're added to a project, it will appear here." icon={FiFolder} />
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {mine.map((p, i) => (
              <motion.button
                key={p.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
onClick={() => navigate(`/projects/${p.code || p.id}`)}
                className="text-left"
              >
                <Card className="h-full transition hover:-translate-y-0.5 hover:border-primary hover:shadow-card">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
                      <p className="font-semibold">{p.name}</p>
                    </div>
                    <Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted">
                      <span>Progress</span><span>{p.progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${p.progress}%`, backgroundColor: p.color }} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <Badge tone={PRIORITY_TONE[p.priority]}>{p.priority}</Badge>
                    <span className="text-xs text-muted">{formatDate(p.deadline, 'DD MMM')}</span>
                  </div>
                </Card>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (statsError || !stats) {
    return (
      <div>
        <PageHeader title="Project Management" subtitle="Projects, sprints, tasks and delivery tracking." />
        <Card>
          <EmptyState
            icon={FiAlertCircle}
            title="Project statistics could not be loaded"
            description={statsErr?.response?.data?.message || statsErr?.message || 'The project statistics service did not respond. Please retry, and contact an administrator if this persists.'}
          />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Project Management"
        subtitle="Projects, sprints, tasks and delivery tracking."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" icon={FiColumns} onClick={() => navigate('/projects/board')}>Open Board</Button>
            {canWrite && (
              <Button icon={FiPlus} onClick={() => navigate('/projects/new')}>
                New Project
              </Button>
            )}
          </div>
        }
      />

    
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={stats.totalProjects} icon={FiFolder} />
        <StatCard label="Active" value={stats.activeProjects} icon={FiActivity} tone="primary" />
        <StatCard label="Tasks Done" value={`${stats.doneTasks}/${stats.totalTasks}`} icon={FiCheckCircle} tone="success" onClick={() => navigate('/projects/board')} />
        <StatCard label="Open Bugs" value={stats.openBugs} icon={FiAlertCircle} tone="danger" onClick={() => navigate('/projects/bugs')} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open Tasks" value={stats.openTasks} icon={FiFolder} tone="warning" onClick={() => navigate('/projects/board')} />
        <StatCard
          label="Milestones"
          value={`${stats.milestonesReached}/${stats.totalMilestones}`}
          icon={FiFlag}
          tone="accent"
          onClick={visibleSections.some((s) => s.key === 'milestones') ? () => navigate('/projects/milestones') : undefined}
        />
        <StatCard label="Completed" value={stats.completedProjects} icon={FiCheckCircle} tone="success" />
        <StatCard label="Avg Progress" value={`${stats.avgProgress}%`} icon={FiTrendingUp} tone="primary" />
      </div>

      {/* Charts */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Tasks by Status" />
          <BarsChart data={stats.tasksByStatus.map((s) => ({ name: s.name, tasks: s.value }))} xKey="name" bars={[{ key: 'tasks', color: '#2563EB' }]} />
        </Card>
        <Card>
          <CardHeader title="Projects by Status" />
          <DonutChart data={stats.byStatus} />
        </Card>
      </div>

      {/* Project cards */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-muted">Projects</h2>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p, i) => (
          <motion.button
            key={p.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            onClick={() => navigate(`/projects/${p.code || p.id}`)}
            className="text-left"
          >
            <Card className="h-full transition hover:-translate-y-0.5 hover:border-primary hover:shadow-card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">{p.client}</p>
                  </div>
                </div>
                <Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted">
                  <span>Progress</span><span>{p.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${p.progress}%`, backgroundColor: p.color }} />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {(p.members || []).slice(0, 4).map((m, mi) => <Avatar key={mi} name={m.name} size={26} className="ring-2 ring-[var(--surface)]" />)}
                  {(p.members || []).length > 4 && <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/10 text-[10px] dark:bg-white/10">+{p.members.length - 4}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={PRIORITY_TONE[p.priority]}>{p.priority}</Badge>
                  <span className="text-xs text-muted">{formatDate(p.deadline, 'DD MMM')}</span>
                </div>
              </div>
            </Card>
          </motion.button>
        ))}
      </div>

      {/* Section grid */}
      <h2 className="mb-3 text-sm font-semibold text-muted">Tools</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleSections.map((s, i) => (
          <motion.button key={s.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} onClick={() => navigate(s.path)} className="group text-left">
            <Card className="h-full transition hover:-translate-y-0.5 hover:border-primary hover:shadow-card">
              <div className="flex items-start justify-between">
                <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', TONE_BG[s.tone])}><s.icon className="h-5 w-5" /></div>
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
