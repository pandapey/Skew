import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiFolder, FiActivity, FiCheckCircle, FiAlertCircle, FiFlag,
  FiTrendingUp, FiArrowRight, FiColumns, FiPlus,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { PageHeader, Card, CardHeader, StatCard, Badge, Avatar, Loader, Button, EmptyState } from '@/components/ui'
import { BarsChart, DonutChart } from '@/components/charts/Charts'
import { ProjectModal } from '@/features/projects/ProjectModal'
import { PROJECT_SECTIONS, PROJECT_STATUS_TONE, PRIORITY_TONE, PROJECT_WRITE_ROLES, MANAGER_HIDDEN_SECTION_KEYS } from '@/features/projects/constants'
import { cn, formatDate } from '@/utils'

const TONE_BG = {
  primary: 'bg-primary/10 text-primary', accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning', danger: 'bg-danger/10 text-danger',
}

export default function Projects() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole, user } = useAuth()  // Phase 6.14 fix: `user` was missing; caused ReferenceError on every render
  const canWrite = hasRole(PROJECT_WRITE_ROLES)
  // Employees get a scoped, read-only "My Projects" view (#7). The org-wide
  // stats endpoint is skipped for them so no aggregate/finance data is fetched.
  const isEmployee = hasRole(ROLES.EMPLOYEE)
  // Phase 6.14 (TASK 4) ROOT CAUSE: the Tools grid mapped PROJECT_SECTIONS
  // unconditionally, so every write-capable role got an identical set of
  // cards. There was no Manager branch in this file at all. The section
  // list is filtered for Manager only; PROJECT_SECTIONS itself is untouched,
  // so Admin/HR/Employee still see Backlog, Sprint Planning and Milestones,
  // and the /projects/:id/backlog|sprints|milestones routes remain live.
  //
  // Phase 6.15 (TASK 3): HR has the exact same request (hide Backlog, Sprint
  // Planning and Milestones only for HR) with the exact same three keys, so
  // HR is added to the SAME deny-list check instead of introducing a second,
  // parallel HR-only constant/branch. Admin/Employee still fall through to
  // the unfiltered PROJECT_SECTIONS list, so they are unaffected.
  const isManager = user?.role === ROLES.MANAGER
  const isHR = user?.role === ROLES.HR
  // Phase 6.16 (TASK 2): Admin has the exact same request (hide Backlog,
  // Sprint Planning and Milestones only) with the exact same three keys, so
  // Admin is added to the SAME deny-list check instead of a third, parallel
  // Admin-only constant/branch. Employee still falls through to the
  // unfiltered PROJECT_SECTIONS list, so it is unaffected.
  const isAdmin = user?.role === ROLES.ADMIN
  const visibleSections = (isManager || isHR || isAdmin)
    ? PROJECT_SECTIONS.filter((sec) => !MANAGER_HIDDEN_SECTION_KEYS.includes(sec.key))
    : PROJECT_SECTIONS
  const [modalOpen, setModalOpen] = useState(false)

  // Phase 5.7 (Task 2): ?newProject=1 opens the create form straight away. The
  // param is stripped immediately, otherwise closing and reopening the page
  // would re-trigger the modal.
  //
  // Phase 5.9 (Task 4): the same effect now also carries `?client=<company>`.
  // When the user picks "New Client" inside the Project modal we leave this
  // route entirely for Admin -> Create User; after the client is saved that
  // form sends us back here with ?newProject=1&client=<company>. We reopen the
  // modal and hand the company name down as `presetClient` so the brand-new
  // client is auto-selected. The project values the user had already typed are
  // restored inside ProjectModal from sessionStorage (component state cannot
  // survive a route change, which is why the draft is not kept here).
  const [searchParams, setSearchParams] = useSearchParams()
  const [presetClient, setPresetClient] = useState('')
  useEffect(() => {
    if (searchParams.get('newProject') !== '1') return
    const incomingClient = searchParams.get('client') || ''
    if (canWrite) {
      setPresetClient(incomingClient)
      setModalOpen(true)
    }
    searchParams.delete('newProject')
    searchParams.delete('client')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, canWrite, setSearchParams])

  const { data: stats, isLoading } = useQuery({ queryKey: ['project-stats'], queryFn: projectApi.stats, enabled: !isEmployee })
  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })

  const createMut = useMutation({
    // Phase 5.7 (Task 1): when the modal captured a NEW client, provision the
    // client, the optional portal login, the project and finance in one atomic
    // server call. Selecting an existing client keeps the original endpoint.
    mutationFn: ({ __clientInfo, __createPortalLogin, ...values }) => (
      __clientInfo
        ? projectApi.createWithClient({
          client: __clientInfo,
          project: values,
          createPortalLogin: !!__createPortalLogin,
        })
        : projectApi.create(values)
    ),
    onSuccess: (res) => {
      // The unified endpoint returns { project, client, credentials, ... };
      // the plain endpoint returns the project row itself.
      const row = res?.project || res
      toast.success(res?.clientCreated ? 'Client and project created' : 'Project created')
      if (res?.credentials?.temporaryPassword) {
        toast.success(`Portal login: ${res.credentials.email} / ${res.credentials.temporaryPassword}`, { duration: 12000 })
      }
      setModalOpen(false)
      qc.invalidateQueries({ queryKey: ['projects-all'] })
      qc.invalidateQueries({ queryKey: ['project-stats'] })
      qc.invalidateQueries({ queryKey: ['admin-clients'] })
      if (row?.id) navigate(`/projects/${row.id}`)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not create project'),
  })

  if (isLoading) return <Loader label="Loading projects…" />

  // --- Employee view: ONLY the projects they're assigned to (projectApi.all is
  // membership-scoped server-side). No budget/finance, no other employees, no
  // charts/tools, no create/edit/delete controls. Other roles fall through to
  // the full management view below unchanged.
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
                onClick={() => navigate(`/projects/${p.id}`)}
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

  return (
    <div>
      <PageHeader
        title="Project Management"
        subtitle="Projects, sprints, tasks and delivery tracking."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" icon={FiColumns} onClick={() => navigate('/projects/board')}>Open Board</Button>
            {/* ---------------------------------------------------------------
                Phase 6.3 (TASK 1) - ONE SHARED PROJECT FORM

                ROOT CAUSE of "HR/Manager flow is better than Admin": this
                button branched on role. Admin was navigated away to
                /admin/users?add=client&role=Client&withProject=1, which rendered
                a SECOND, completely separate project form embedded inside
                pages/admin/Users.jsx (the `withProject` block: projName /
                projCode / projDescription / projLead / projPriority /
                projStatus / projBudget / projStartDate / projDeadline, with its
                own hand-rolled validation). HR and Manager instead got the
                shared <ProjectModal/>, which has the searchable client Select,
                the MultiSelect members picker, the colour picker and zod
                validation via projectSchema.

                So there really were two project creation forms with different
                UI, different fields and different validation, and Admin was
                routed to the weaker one.

                FIX: the role branch is deleted. Every PROJECT_WRITE_ROLE
                (Admin, Manager, HR) now opens the same <ProjectModal/> already
                rendered at the bottom of this page. The duplicate form in
                admin/Users.jsx is removed (see that file).

                RBAC is unchanged: the button is still gated by `canWrite`
                (PROJECT_WRITE_ROLES) and the modal still submits to the same
                endpoints, which remain authorize('Admin','Manager','HR').
                Admin loses no capability - it gains the better form. -------- */}
            {canWrite && (
              <Button icon={FiPlus} onClick={() => setModalOpen(true)}>
                New Project
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Projects" value={stats.totalProjects} icon={FiFolder} />
        <StatCard label="Active" value={stats.activeProjects} icon={FiActivity} tone="primary" />
        <StatCard label="Tasks Done" value={`${stats.doneTasks}/${stats.totalTasks}`} icon={FiCheckCircle} tone="success" />
        <StatCard label="Open Bugs" value={stats.openBugs} icon={FiAlertCircle} tone="danger" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open Tasks" value={stats.openTasks} icon={FiFolder} tone="warning" />
        <StatCard label="Milestones" value={`${stats.milestonesReached}/${stats.totalMilestones}`} icon={FiFlag} tone="accent" />
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
            onClick={() => navigate(`/projects/${p.id}`)}
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

      <ProjectModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setPresetClient('') }}
        onSubmit={(v) => createMut.mutate(v)}
        saving={createMut.isPending}
        presetClient={presetClient}
      />
    </div>
  )
}
