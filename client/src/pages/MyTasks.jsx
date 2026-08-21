import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useViewState } from '@/hooks/useViewState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiLayers, FiClock, FiLoader, FiCheckCircle,
  FiMessageSquare, FiPaperclip, FiCheckSquare, FiPlus, FiPlay, FiPause,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { useMyTasks } from '@/hooks/queries/useMyTasks'
import { TaskModal } from '@/features/projects/TaskModal'
import { activeSeconds, pausedSeconds, isTaskPaused, isTaskRunning } from '@/features/projects/taskTimer'
import {
  PageHeader, Card, StatCard, DataTable, Badge, SearchInput, Select, Modal, Loader,
  EmptyState, Button,
} from '@/components/ui'
import { fileUrl } from '@/features/files/constants'
import { formatDate } from '@/utils'

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return `${formatDate(value)} \u00b7 ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  if (!s) return '\u2014'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

// Live active-time display: wall time since start minus paused spans, refreshed
// every second — the same math the server records at submit time.
function RunningTimer({ task }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const paused = isTaskPaused(task)
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
        paused ? 'text-muted' : 'text-accent'
      }`}
    >
      <FiClock className={paused ? '' : 'animate-pulse'} />
      {formatDuration(activeSeconds(task, now))} {paused ? 'paused' : 'elapsed'}
    </span>
  )
}

// Working-time cell — ticks each second while running, frozen once completed.
function WorkingTimeCell({ task }) {
  const live = isTaskRunning(task) || isTaskPaused(task)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  const paused = isTaskPaused(task)
  const sec = task.completedAt ? task.durationSec : task.startedAt ? activeSeconds(task, now) : 0
  return (
    <span className={paused ? 'text-muted' : ''}>
      {formatDuration(sec)}
      {paused && <span className="ml-1 text-[10px] text-muted">(paused)</span>}
    </span>
  )
}

const CARDS = [
  { key: 'all', label: 'Assigned', icon: FiLayers, tone: 'primary' },
  { key: 'inprogress', label: 'In Progress', icon: FiLoader, tone: 'accent' },
  { key: 'completed', label: 'Completed', icon: FiCheckCircle, tone: 'success' },
]

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'start', label: 'Start' },
  { value: 'hold', label: 'Hold' },
  { value: 'complete', label: 'Complete' },
]

const matchesBucket = (t, bucket) => {
  if (bucket === 'all') return true
  if (bucket === 'inprogress') return t.status === 'In Progress'
  if (bucket === 'completed') return t.status === 'Done'
  return true
}

const makeFileForm = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return fd
}

// Current value for the status dropdown, derived from server state.
function statusValue(task) {
  if (task.submissionStatus === 'Approved' || task.status === 'Done') return 'complete'
  if (isTaskPaused(task)) return 'hold'
  if (task.startedAt) return 'start'
  return 'pending'
}

export default function MyTasks() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: tasks = [], isLoading } = useMyTasks()
  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: () => projectApi.all() })
  const projectMap = useMemo(() => {
    const m = {}
    ;(projects || []).forEach((p) => { m[p.id || p._id] = p.name })
    return m
  }, [projects])

  const [vs, patchVs] = useViewState('task-list-filters', {
    bucket: 'all', search: '', project: '', sortKey: 'createdAt', sortOrder: 'desc',
  })
  const bucket = vs.bucket
  const setBucket = (v) => patchVs({ bucket: v })
  const search = vs.search
  const setSearch = (v) => patchVs({ search: v })
  const projectFilter = vs.project
  const setProjectFilter = (v) => patchVs({ project: v })
  const sort = { key: vs.sortKey, order: vs.sortOrder }
  const setSort = (fn) => { const next = typeof fn === 'function' ? fn(sort) : fn; patchVs({ sortKey: next.key, sortOrder: next.order }) }
  const [commentsTaskId, setCommentsTaskId] = useState(null)
  const qc = useQueryClient()

  // PHASE: EMPLOYEE TASK — tasks the signed-in user assigned (server filter
  // `assignedBy`) are merged INTO the same list as the ones assigned to them:
  // one page, no tabs.
  const { data: assignedByMe = [], isLoading: byMeLoading } = useQuery({
    queryKey: ['tasks', 'assigned-by', user?._id],
    queryFn: () => projectApi.tasks({ assignedBy: user?.name }),
  })
  const data = useMemo(() => {
    const byId = new Map()
    for (const t of [...tasks, ...assignedByMe]) byId.set(t.id, t)
    return [...byId.values()]
  }, [tasks, assignedByMe])
  const loading = isLoading || byMeLoading

  // PHASE: EMPLOYEE MY TASK (REQUIREMENT 2) ROOT CAUSE FIX — Start/Pause/Resume
  // appeared to do nothing until a manual browser refresh.
  //
  // TRACE: the modal states held a TASK OBJECT SNAPSHOT taken when the modal
  // was opened. The mutations succeeded and invalidated the ['tasks', ...]
  // caches, so the list refetched — but the modal kept rendering its stale
  // snapshot object, whose `startedAt` was still null.
  //
  // FIX: the modals now store only the task ID and DERIVE the live task from
  // the fresh React Query data. The moment a status mutation resolves, the
  // derived task reflects the server state and the UI repaints with no refresh.
  const liveTask = (id) => (id ? data.find((t) => t.id === id) || null : null)
  const commentsTask = liveTask(commentsTaskId)

  const applyTaskUpdate = (task) => {
    if (!task?.id) return
    for (const key of [['tasks', 'mine', user?._id], ['tasks', 'assigned-by', user?._id]]) {
      qc.setQueryData(key, (old) =>
        Array.isArray(old) ? old.map((t) => (t.id === task.id ? { ...t, ...task } : t)) : old)
    }
  }

  const invalidateTaskCaches = () => {
    qc.invalidateQueries({ queryKey: ['tasks'], refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['task-review-queue'], refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['task-history'], refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['project-detail'], refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['projects-all'], refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' })
    qc.invalidateQueries({ queryKey: ['tasks', 'mine-count'], refetchType: 'active' })
  }

  const [createOpen, setCreateOpen] = useState(false)
  const { data: assignees = [] } = useQuery({ queryKey: ['project-assignees'], queryFn: () => projectApi.assignees() })

  const createMut = useMutation({
    mutationFn: async (values) => {
      const task = await projectApi.createTask({ ...values, project: values.project })
      for (const file of values.files || []) {
        await projectApi.uploadTaskAttachment(task.id, makeFileForm(file))
      }
      return task
    },
    onSuccess: () => {
      toast.success('Task assigned \u2014 the assignee has been notified')
      setCreateOpen(false)
      invalidateTaskCaches()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not assign this task'),
  })

  // PHASE: EMPLOYEE TASK STATUS — one mutation behind the details-modal status
  // dropdown (start / pending / hold / complete). The server owns the timer.
  const statusMut = useMutation({
    mutationFn: ({ id, status }) => projectApi.setTaskStatus(id, status),
    onSuccess: (updated, { status }) => {
      const VERB = { start: 'Task started \u2014 timer running', pending: 'Task set to pending', hold: 'Task on hold', complete: 'Task completed' }
      toast.success(VERB[status] || 'Task status updated')
      applyTaskUpdate(updated)
      invalidateTaskCaches()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not update the task status'),
  })

  // PHASE: EMPLOYEE TASK READ STATE — opening a task's details marks it read
  // (assignee-only, server-persisted). Only fires for the assignee's own
  // unread tasks in the "Assigned to Me" tab.
  const markViewedMut = useMutation({
    mutationFn: (id) => projectApi.markTaskViewed(id),
    onSuccess: (updated) => {
      applyTaskUpdate(updated)
      qc.invalidateQueries({ queryKey: ['tasks', 'mine-count'], refetchType: 'active' })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not update read status'),
  })

  const openTaskDetails = (id) => {
    setCommentsTaskId(id)
    const t = liveTask(id)
    if (t && !t.viewed && t.assignee === user?.name) markViewedMut.mutate(id)
  }

  const projectName = (t) => projectMap[t.project] || t.projectName || '\u2014'

  const counts = useMemo(() => ({
    all: data.length,
    inprogress: data.filter((t) => t.status === 'In Progress').length,
    completed: data.filter((t) => t.status === 'Done').length,
  }), [data])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = data
      .filter((t) => matchesBucket(t, bucket))
      .filter((t) => (projectFilter ? t.project === projectFilter : true))
      .filter((t) => (q ? (`${t.title} ${projectName(t)}`.toLowerCase().includes(q)) : true))
    const dir = sort.order === 'asc' ? 1 : -1
    out = [...out].sort((a, b) => {
      let av = a[sort.key]; let bv = b[sort.key]
      if (sort.key === 'project') { av = projectName(a); bv = projectName(b) }
      if (av == null) return 1
      if (bv == null) return -1
      return av > bv ? dir : av < bv ? -dir : 0
    })
    return out.map((t, i) => ({ ...t, sno: i + 1 }))
  }, [data, bucket, search, projectFilter, sort, projectMap])

  const toggleSort = (key) => setSort((s) => ({ key, order: s.key === key && s.order === 'asc' ? 'desc' : 'asc' }))

  const columns = [
    { key: 'sno', header: 'S.No', render: (t) => <span className="text-muted">{t.sno}</span> },
    { key: 'title', header: 'Task Name', sortable: true, render: (t) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{t.title}</span>
        {(t.attachments || []).length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted" title={`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`}>
            <FiPaperclip className="h-3.5 w-3.5" />{t.attachments.length}
          </span>
        )}
      </div>
    ) },
    { key: 'project', header: 'Project', sortable: true, render: (t) => <span className="text-muted">{projectName(t)}</span> },
    { key: 'createdAt', header: 'Assigned Date', sortable: true, render: (t) => formatDate(t.createdAt) },
    { key: 'startedAt', header: 'Started', sortable: true, render: (t) => formatDateTime(t.startedAt) },
    { key: 'durationSec', header: 'Working Time', render: (t) => <WorkingTimeCell task={t} /> },
    { key: 'actions', header: 'Action', render: (t) => (
      <div className="flex items-center gap-1.5">
        {t.assignee === user?.name
          ? (t.status === 'Done' || t.submissionStatus === 'Approved'
              ? <Badge tone="success">Completed</Badge>
              : t.submissionStatus === 'Submitted'
                ? <Badge tone="default">Awaiting Review</Badge>
                : isTaskPaused(t)
                ? <Button size="sm" icon={FiPlay} disabled={statusMut.isPending} onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: t.id, status: 'start' }) }}>Resume</Button>
                : isTaskRunning(t)
                  ? <Button size="sm" variant="ghost" icon={FiPause} disabled={statusMut.isPending} onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: t.id, status: 'hold' }) }}>Pause</Button>
                  : <Button size="sm" icon={FiPlay} disabled={statusMut.isPending} onClick={(e) => { e.stopPropagation(); statusMut.mutate({ id: t.id, status: 'start' }) }}>Start</Button>)
          : <span className="text-xs text-muted">Assigned to {t.assignee || '\u2014'}</span>}
      </div>
    ) },
    { key: 'comments', header: 'Details', render: (t) => (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openTaskDetails(t.id) }}
        className="inline-flex items-center gap-1 rounded-lg border border-app px-2 py-1 text-xs text-muted transition hover:border-primary hover:text-primary"
      >
        <FiMessageSquare className="h-3.5 w-3.5" /> View
      </button>
    ) },
  ]

  return (
    <div>
      <PageHeader
        title="My Tasks"
        subtitle="Tasks assigned to you and tasks you have assigned — all in one place."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={FiPlus} onClick={() => setCreateOpen(true)}>Assign Task</Button>
            <Button variant="ghost" icon={FiCheckSquare} onClick={() => navigate('/my-tasks/review')}>Task Review</Button>
            <Button variant="ghost" icon={FiClock} onClick={() => navigate('/my-tasks/history')}>Task History</Button>
          </div>
        )}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <button key={c.key} type="button" onClick={() => setBucket(c.key)} className="text-left focus:outline-none">
            <div className={`rounded-[20px] transition ${bucket === c.key ? 'ring-2 ring-primary' : ''}`}>
              <StatCard label={c.label} value={counts[c.key]} icon={c.icon} tone={c.tone} />
            </div>
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search tasks or projects\u2026" className="w-full sm:max-w-xs" />
          <Select
            label="Project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            className="w-full sm:w-56"
          />
        </div>

        {loading ? (
          <Loader label="Loading your tasks\u2026" />
        ) : data.length === 0 ? (
          <EmptyState title="No tasks found. Assign a task to get started." />
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            sort={sort}
            onSort={toggleSort}
            empty="No tasks match the current filters."
          />
        )}
      </Card>

      {commentsTask && (
        <TaskDetailsModal
          task={commentsTask}
          onClose={() => setCommentsTaskId(null)}
          onStatus={(status) => statusMut.mutate({ id: commentsTask.id, status })}
          busy={statusMut.isPending}
        />
      )}

      <TaskModal
        open={createOpen}
        employeeMode
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createMut.mutate(values)}
        saving={createMut.isPending}
        assignees={assignees}
      />
    </div>
  )
}

// PHASE: EMPLOYEE TASK DETAILS — the details modal shows only the essentials
// (title, description, time) and drives the status through a single dropdown:
// Start / Pending / Hold / Complete. Submission/review/progress widgets are
// removed from this surface.
function TaskDetailsModal({ task, onClose, onStatus, busy }) {
  const running = isTaskRunning(task)
  const paused = isTaskPaused(task)
  const live = running || paused
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  const submitted = task.submissionStatus === 'Submitted'
  const locked = task.submissionStatus === 'Approved' || task.status === 'Done' || submitted
  const attachments = task.attachments || []

  const current = submitted ? '' : statusValue(task)

  const change = (e) => {
    const value = e.target.value
    if (!value || value === current) return
    onStatus(value)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Task Details"
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(running || paused) && <RunningTimer task={task} />}
      </div>
      <h3 className="text-lg font-semibold">{task.title}</h3>
      <p className="mt-1 text-sm text-muted">{task.description || 'No description.'}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[['Started', formatDateTime(task.startedAt)], ['Working Time', formatDuration(task.completedAt ? task.durationSec : task.startedAt ? activeSeconds(task, now) : 0)], ['Paused', formatDuration(Math.round(pausedSeconds(task, now) / 1000))]].map(([l, v]) => (
          <div key={l}><p className="text-xs text-muted">{l}</p><p className="text-sm font-medium">{v}</p></div>
        ))}
      </div>

      <div className="mt-4 max-w-xs">
        <Select
          label="Status"
          value={current}
          onChange={change}
          disabled={locked || busy}
          loading={busy}
          options={submitted
            ? [{ value: '', label: 'Submitted \u2014 awaiting review' }]
            : STATUS_OPTIONS}
        />
      </div>

      {attachments.length > 0 && (
        <div className="mt-4 border-t border-app pt-4">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <FiPaperclip /> Attachments
            <Badge tone="default">{attachments.length}</Badge>
          </h4>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <a
                key={a.fileId || a.name}
                href={fileUrl(a.url)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-app px-2.5 py-1 text-xs text-muted transition hover:border-primary hover:text-primary"
              >
                <FiPaperclip className="h-3 w-3" />{a.name}
              </a>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}