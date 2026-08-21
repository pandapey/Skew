import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiEdit2, FiPlus, FiCalendar, FiDollarSign, FiUser, FiTrash2,
  FiCheckCircle, FiAlertCircle, FiFlag, FiTrendingUp,
  FiCreditCard, FiRepeat, FiGlobe, FiAward,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import {
  PageHeader, Card, Tabs, Badge, Avatar, Button, Loader,
  StatCard, ConfirmDialog, Modal,
} from '@/components/ui'
import { KanbanBoard } from '@/features/projects/KanbanBoard'
import { ActivityFeed } from '@/features/projects/ActivityFeed'
import { TaskModal } from '@/features/projects/TaskModal'
import { ProjectModal } from '@/features/projects/ProjectModal'
import { CommentsPanel } from '@/features/projects/CommentsPanel'
import { FilesPanel } from '@/features/projects/FilesPanel'
import { MembersPanel } from '@/features/projects/MembersPanel'
import { ProgressBar } from '@/features/projects/ProgressBar'
import ProjectDocuments from '@/features/client/ProjectDocuments'
import { MeetingRequestsPanel } from '@/features/projects/MeetingRequestsPanel'
import {
  PROJECT_DETAIL_TABS, PROJECT_WRITE_ROLES, PROJECT_STATUS_TONE, PRIORITY_TONE,
  TYPE_TONE, TASK_STATUS_TONE, MILESTONE_TONE, MANAGER_HIDDEN_DETAIL_TAB_KEYS } from '@/features/projects/constants'
import { formatDate, formatCurrency } from '@/utils'

const EMPLOYEE_TAB_KEYS = ['overview', 'board', 'documents', 'meetings', 'comments']

const staffDocumentsApi = {
  list: (_user, projectId) => projectApi.documents(projectId),
  upload: (projectId, formData) => projectApi.uploadDocument(projectId, formData),
  remove: (projectId, docId) => projectApi.deleteDocument(projectId, docId),
  downloadUrl: (projectId, docId) => projectApi.downloadDocumentUrl(projectId, docId),
  keys: (projectId) => [
    ['project-documents', projectId],
    ['project-detail', projectId],
  ],
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)
  const isEmployee = hasRole(ROLES.EMPLOYEE)
  const isManager = hasRole(ROLES.MANAGER)
  const isAdmin = hasRole(ROLES.ADMIN)

  const [tab, setTab] = useState('overview')
  const [taskModal, setTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [taskDetail, setTaskDetail] = useState(null)
  const [editProject, setEditProject] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: project, isLoading, isError, error, refetch } = useQuery({ queryKey: ['project-detail', id], queryFn: () => projectApi.detail(id) })

  // Hook ORDER is sacred: every hook must run on every render. This assignee
  // pool was previously fetched AFTER the loading/error early-returns, so the
  // loading render called one fewer hook than the loaded render — React throws
  // "Rendered more hooks than during the previous render" on a cold-cache load
  // (which the error-boundary retry then papered over, looking like a 500 that
  // a refresh "fixed"). Moved above the returns so it always runs.
  const { data: assignees = [] } = useQuery({ queryKey: ['project-assignees'], queryFn: () => projectApi.assignees() })

  // The URL carries the human-readable Project ID (PRJ001); the tasks / sprints
  // / files / comments endpoints all key on the Mongo ObjectId, so everything
  // below the loaded project uses its resolved `id`.
  const projectId = project?.id || project?._id

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project-detail', id] })
    qc.invalidateQueries({ queryKey: ['project-activity', id] })
    qc.invalidateQueries({ queryKey: ['projects-all'] })
    qc.invalidateQueries({ queryKey: ['project-stats'] })
  }

  const moveMut = useMutation({
    mutationFn: ({ taskId, status }) => projectApi.moveTask(taskId, status),
    onSuccess: (_r, v) => { toast.success(`Moved to ${v.status}`); invalidate() },
    onError: () => toast.error('Could not move task'),
  })
  const saveTaskMut = useMutation({
    mutationFn: (values) => (editingTask ? projectApi.updateTask(editingTask.id, values) : projectApi.createTask({ ...values, project: projectId })),
    onSuccess: () => { toast.success(editingTask ? 'Task updated' : 'Task created — team notified'); setTaskModal(false); invalidate() },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save task'),
  })
  const saveProjectMut = useMutation({
    mutationFn: (values) => projectApi.update(projectId, values),
    onSuccess: () => { toast.success('Project updated'); setEditProject(false); invalidate() },
    onError: () => toast.error('Could not save project'),
  })
  const deleteMut = useMutation({
    mutationFn: () => projectApi.remove(projectId),
    onSuccess: () => { toast.success('Project deleted'); navigate('/projects') },
    onError: () => toast.error('Could not delete project'),
  })

  // PHASE: EMPLOYEE TASK READ STATE — opening a task's details from the board
  // or backlog marks it read (assignee-only, same rule as My Tasks) so the
  // unread badge decrements no matter where the assignee views the task.
  const markViewedMut = useMutation({
    mutationFn: (taskId) => projectApi.markTaskViewed(taskId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', 'mine-count'], refetchType: 'active' }) },
    onError: () => {},
  })

  if (isLoading) return <Loader label="Loading project…" />
  if (isError) {
    const status = error?.response?.status
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <FiAlertCircle className="h-6 w-6 text-danger" />
        </div>
        <h2 className="text-lg font-semibold">{status ? `Server error (${status})` : 'Could not load project'}</h2>
        <p className="mt-1 text-sm text-muted">{error?.response?.data?.message || 'Something went wrong while loading this project. Please try again.'}</p>
        <Button className="mt-5" onClick={() => refetch()}>Try again</Button>
      </div>
    )
  }
  if (!project) return <p className="py-10 text-center text-muted">Project not found.</p>

  const tasks = project.tasks || []
  const sprints = project.sprints || []
  const milestones = project.milestones || []
  const bugs = tasks.filter((t) => t.type === 'Bug')
  const doneTasks = tasks.filter((t) => t.status === 'Done').length
  const backlog = tasks.filter((t) => !t.sprint)

  const isLead = Boolean(user?.name) && project.lead === user.name
  const canManageTasks = true
  const isMember = (project?.members || []).some((m) => m?.name === user?.name)
  const canSeeMeetings = canWrite || isLead || isMember
  const visibleTabs = PROJECT_DETAIL_TABS.filter((t) => (t.key === 'meetings' ? canSeeMeetings : true))
  const roleFilteredTabs = (isManager || isAdmin)
    ? visibleTabs.filter((t) => !MANAGER_HIDDEN_DETAIL_TAB_KEYS.includes(t.key))
    : visibleTabs
  const detailTabs = isEmployee ? roleFilteredTabs.filter((t) => EMPLOYEE_TAB_KEYS.includes(t.key)) : roleFilteredTabs

  const openAddTask = () => { setEditingTask(null); setTaskModal(true) }
  const openEditTask = (t) => { setEditingTask(t); setTaskDetail(null); setTaskModal(true) }

  const openTaskDetail = (t) => {
    setTaskDetail(t)
    if (t?.assignee === user?.name && !t.viewed) markViewedMut.mutate(t.id)
  }

  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />{project.name}</span>}
        subtitle={`${project.code || ''}${project.client ? ` · ${project.client}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>{project.status}</Badge>
            <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>
            {canWrite && <Button variant="ghost" icon={FiEdit2} onClick={() => setEditProject(true)}>Edit</Button>}
            {canWrite && <Button variant="ghost" icon={FiTrash2} onClick={() => setConfirmDelete(true)}>Delete</Button>}
          </div>
        }
      />

      {/* PHASE: EMPLOYEE PROJECT PAGE (REQUIREMENTS 3-5) — the employee variant
          of this KPI row is REMOVED ENTIRELY (Tasks Done / My Tasks / Task
          Progress / Progress cards no longer render for employees; the overview
          tab's ProgressBar still shows the project's overall progress).
          Admin/Manager/HR keep the original org-wide widgets untouched. */}
      {!isEmployee && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Tasks Done" value={`${doneTasks}/${tasks.length}`} icon={FiCheckCircle} tone="success" />
          <StatCard label="Open Bugs" value={bugs.filter((b) => b.status !== 'Done').length} icon={FiAlertCircle} tone="danger" />
          <StatCard label="Milestones" value={`${milestones.filter((m) => m.status === 'Reached').length}/${milestones.length}`} icon={FiFlag} tone="accent" />
          <StatCard label="Progress" value={`${project.progress || 0}%`} icon={FiTrendingUp} tone="primary" />
        </div>
      )}

      <Card className="mb-4">
        <Tabs items={detailTabs} value={tab} onChange={setTab} className="mb-4" />

        {tab === 'overview' && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <p className="text-sm text-muted">{project.description || 'No description provided.'}</p>
              <div className="mt-4"><ProgressBar value={project.progress || 0} color={project.color} showLabel /></div>
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { l: 'Lead', v: project.lead || '—', i: FiUser },
                  { l: 'Start', v: formatDate(project.startDate, 'DD MMM YYYY'), i: FiCalendar },
                  { l: 'Deadline', v: formatDate(project.deadline, 'DD MMM YYYY'), i: FiCalendar },
                  ...(isEmployee ? [] : [{ l: 'Budget', v: formatCurrency(project.budget), i: FiDollarSign }]),
                  ...(isEmployee ? [] : [
                    { l: 'Advance Payment', v: formatCurrency(project.advancePayment), i: FiCheckCircle },
                    { l: 'Monthly Due', v: formatCurrency(project.monthlyDue), i: FiCreditCard },
                    { l: 'Billing Cycle', v: project.billingCycle || '—', i: FiRepeat },
                    { l: 'Payment Method', v: project.paymentMode || '—', i: FiCreditCard },
                  ]),
                  { l: 'Website', v: project.website || '—', i: FiGlobe },
                  { l: 'Plan', v: project.plan || '—', i: FiAward },
                ].map((x) => (
                  <div key={x.l}>
                    <p className="flex items-center gap-1 text-xs text-muted"><x.i className="h-3 w-3" />{x.l}</p>
                    <p className="mt-0.5 text-sm font-medium">{x.v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <h4 className="mb-2 text-sm font-semibold text-muted">Team</h4>
                <div className="flex flex-wrap gap-2">
                  {(project.members || []).map((m) => (
                    <span key={m.name} className="flex items-center gap-2 rounded-full border border-app py-1 pl-1 pr-3 text-sm">
                      <Avatar name={m.name} size={24} />{m.name}<Badge tone={m.role === 'Lead' ? 'primary' : 'default'}>{m.role}</Badge>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-muted">Recent Activity</h4>
              <ActivityFeed activity={(project.activity || []).slice(0, 6)} />
            </div>
          </div>
        )}

        {tab === 'board' && (
          <div>
            <div className="mb-4 flex justify-end">{canManageTasks && <Button icon={FiPlus} onClick={openAddTask}>Add Task</Button>}</div>
            <KanbanBoard tasks={tasks} onMove={(taskId, status) => moveMut.mutate({ taskId, status })} onCardClick={openTaskDetail} />
          </div>
        )}

        {tab === 'backlog' && (
          <div className="space-y-2">
            {backlog.length === 0 ? <p className="py-8 text-center text-sm text-muted">Backlog is empty</p> : backlog.map((t) => (
              <button key={t.id} onClick={() => openTaskDetail(t)} className="flex w-full items-center gap-3 rounded-xl border border-app p-3 text-left hover:border-primary">
                <Badge tone={TYPE_TONE[t.type]}>{t.type}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                <span className="text-xs text-muted">{t.storyPoints} pts</span>
                <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                <Avatar name={t.assignee} size={24} />
              </button>
            ))}
          </div>
        )}

        {tab === 'sprints' && (
          <div className="space-y-4">
            {sprints.length === 0 ? <p className="py-8 text-center text-sm text-muted">No sprints yet</p> : sprints.map((s) => {
              const items = tasks.filter((t) => t.sprint === s.id)
              const pts = items.reduce((sum, t) => sum + (t.storyPoints || 0), 0)
              const done = items.filter((t) => t.status === 'Done').length
              return (
                <div key={s.id} className="rounded-xl border border-app p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      <p className="text-xs text-muted">{s.goal} · {formatDate(s.startDate, 'DD MMM')} – {formatDate(s.endDate, 'DD MMM')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={s.status === 'Active' ? 'primary' : s.status === 'Completed' ? 'success' : 'default'}>{s.status}</Badge>
                      <Badge tone="accent">{items.length} tasks · {pts} pts</Badge>
                    </div>
                  </div>
                  <ProgressBar value={items.length ? (done / items.length) * 100 : 0} />
                </div>
              )
            })}
            <Button variant="ghost" icon={FiPlus} onClick={() => navigate('/projects/sprints')}>Manage sprints</Button>
          </div>
        )}

        {tab === 'milestones' && (
          <div className="space-y-3">
            {milestones.length === 0 ? <p className="py-8 text-center text-sm text-muted">No milestones yet</p> : milestones.map((m) => (
              <div key={m.id} className="rounded-xl border border-app p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium"><FiFlag className="text-warning" />{m.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={MILESTONE_TONE[m.status]}>{m.status}</Badge>
                    <span className="text-xs text-muted">{formatDate(m.dueDate, 'DD MMM YYYY')}</span>
                  </div>
                </div>
                <ProgressBar value={m.progress} />
              </div>
            ))}
          </div>
        )}

        {tab === 'documents' && <ProjectDocuments projectId={projectId} api={staffDocumentsApi} />}
        {tab === 'meetings' && canSeeMeetings && (
          <MeetingRequestsPanel projectId={projectId} project={project} canRequestMeeting={canWrite || isLead} />
        )}
        {tab === 'files' && <FilesPanel projectId={projectId} canWrite={canWrite} />}
        {tab === 'members' && <MembersPanel project={project} canWrite={canWrite} />}
        {tab === 'comments' && <CommentsPanel projectId={projectId} />}
        {tab === 'activity' && <ActivityFeed activity={project.activity || []} />}
      </Card>

      {canManageTasks && (
      <TaskModal
        open={taskModal}
        onClose={() => setTaskModal(false)}
        onSubmit={(v) => saveTaskMut.mutate(v)}
        editing={editingTask}
        saving={saveTaskMut.isPending}
        assignees={assignees}
        sprints={sprints}
        projectName={project.name}
      />
      )}

      {/* Task detail */}
      {taskDetail && (
        <TaskDetailModal task={taskDetail} projectId={projectId} canWrite={canManageTasks} onClose={() => setTaskDetail(null)} onEdit={() => openEditTask(taskDetail)} />
      )}

      {canWrite && (
        <ProjectModal open={editProject} onClose={() => setEditProject(false)} onSubmit={(v) => saveProjectMut.mutate(v)} editing={project} saving={saveProjectMut.isPending} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMut.mutate()}
        title="Delete project?"
        message={`This permanently deletes "${project.name}" and cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMut.isPending}
      />
    </div>
  )
}


function TaskDetailModal({ task, projectId, canWrite, onClose, onEdit }) {
  const formatDateTime = (value) => {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    return `${formatDate(value)} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  const formatDuration = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0))
    if (!s) return '—'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m ${s % 60}s`
  }
  return (
    <Modal open onClose={onClose} title="Task Details" size="lg"
      footer={<>{canWrite && <Button variant="ghost" onClick={onEdit}>Edit</Button>}<Button onClick={onClose}>Close</Button></>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={TYPE_TONE[task.type]}>{task.type}</Badge>
        <Badge tone={TASK_STATUS_TONE[task.status]}>{task.status}</Badge>
        <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
        {task.type === 'Bug' && <Badge tone="danger">{task.severity}</Badge>}
      </div>
      <h3 className="text-lg font-semibold">{task.title}</h3>
      <p className="mt-1 text-sm text-muted">{task.description || 'No description.'}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Assignee', task.assignee || '—'], ['Reporter', task.reporter || '—'], ['Story Points', task.storyPoints || '—'], ['Due', formatDate(task.dueDate)]].map(([l, v]) => (
          <div key={l}><p className="text-xs text-muted">{l}</p><p className="text-sm font-medium">{v}</p></div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Started', task.startedAt ? formatDateTime(task.startedAt) : '—'], ['Completed', task.completedAt ? formatDateTime(task.completedAt) : '—'], ['Duration', task.completedAt ? formatDuration(task.durationSec) : '—']].map(([l, v]) => (
          <div key={l}><p className="text-xs text-muted">{l}</p><p className="text-sm font-medium">{v}</p></div>
        ))}
      </div>
      <div className="mt-4"><ProgressBar value={task.progress} showLabel /></div>
      <div className="mt-6 border-t border-app pt-4">
        <h4 className="mb-3 text-sm font-semibold">Comments</h4>
        <CommentsPanel projectId={projectId} taskId={task.id} taskTitle={task.title} />
      </div>
    </Modal>
  )
}
