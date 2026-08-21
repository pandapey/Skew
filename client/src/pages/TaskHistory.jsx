import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiClock, FiFilter, FiRotateCcw, FiMessageSquare, FiPaperclip, FiPlus, FiCheck,
  FiEye,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import {
  PageHeader, Card, Badge, Select, Input, Button, Loader, EmptyState, DataTable, Modal,
} from '@/components/ui'
import { TaskModal } from '@/features/projects/TaskModal'
import { activeSeconds, isTaskPaused, isTaskRunning } from '@/features/projects/taskTimer'
import {
  TASK_EVENT_TONE, SUBMISSION_STATUSES, ASSIGNMENT_STATUS_TONE,
  TASK_STATUS_TONE, PRIORITY_TONE,
} from '@/features/projects/constants'
import { fileUrl } from '@/features/files/constants'
import { useViewState } from '@/hooks/useViewState'

const EMPTY_FILTERS = { project: '', status: '', from: '', to: '', mine: false }

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  if (!s) return '\u2014'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

// Live duration cell — ticks once a second only while the task is running.
function DurationCell({ task }) {
  const live = isTaskRunning(task) || isTaskPaused(task)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  const paused = isTaskPaused(task)
  const sec = task.completedAt
    ? task.durationSec
    : task.startedAt
      ? activeSeconds(task, now)
      : 0
  return (
    <span className={paused ? 'text-muted' : ''}>
      {formatDuration(sec)}
      {paused && <span className="ml-1 text-[10px] text-muted">(paused)</span>}
    </span>
  )
}

function TimelineEntry({ entry, last }) {
  return (
    <li className="relative flex gap-3 pb-4">
      {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />}
      <span className="relative z-10 mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-card bg-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TASK_EVENT_TONE[entry.event] || 'default'}>{entry.event}</Badge>
          <span className="text-sm font-medium">{entry.by}</span>
          <span className="text-xs text-muted">{formatDateTime(entry.at)}</span>
        </div>
        {(entry.from || entry.to) && (
          <p className="mt-1 text-xs text-muted">
            {entry.from ? `${entry.from} \u2192 ` : 'Assigned to '}{entry.to || '\u2014'}
          </p>
        )}
        {entry.comment && (
          <p className="mt-1 rounded-lg bg-muted/10 px-2.5 py-1.5 text-sm">{entry.comment}</p>
        )}
      </div>
    </li>
  )
}

const makeFileForm = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return fd
}

export default function TaskHistory() {
  const navigate = useNavigate()
  const { hasRole, user } = useAuth()
  const qc = useQueryClient()
  const isEmployee = hasRole(ROLES.EMPLOYEE)

  const [filters, patchFilters, resetFilters] = useViewState('filters', EMPTY_FILTERS)
  const set = (key) => (e) => {
    const value = e?.target?.type === 'checkbox' ? e.target.checked : (e?.target?.value ?? e)
    patchFilters({ [key]: value })
  }
  const [viewTask, setViewTask] = useState(null)

  const projectsQuery = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => projectApi.all(),
  })

  const params = useMemo(() => {
    const p = {}
    if (filters.project) p.project = filters.project
    if (filters.status) p.status = filters.status
    if (filters.from) p.from = filters.from
    if (filters.to) p.to = filters.to
    if (filters.mine) p.mine = 'true'
    return p
  }, [filters])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['task-history', params],
    queryFn: () => projectApi.taskHistory(params),
  })

  const rows = Array.isArray(data) ? data : []
  const projectOptions = useMemo(() => ([
    { value: '', label: 'All projects' },
    ...(projectsQuery.data || []).map((p) => ({ value: p.id, label: p.name })),
  ]), [projectsQuery.data])

  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  // Create-task flow (employee self-service, same as My Tasks) — the project
  // is chosen INSIDE the task form now, no separate picker step.
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
      toast.success('Task created \u2014 the assignee has been notified')
      setCreateOpen(false)
      qc.invalidateQueries({ queryKey: ['task-history'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['projects-all'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['tasks'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['project-detail'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not create this task'),
  })

  // PHASE: EMPLOYEE TASK READ STATE — opening a task's timeline marks it read.
  // Only fires for the assignee's own unread tasks; only touches the badge
  // count, never the timeline content.
  const markViewedMut = useMutation({
    mutationFn: (id) => projectApi.markTaskViewed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', 'mine-count'], refetchType: 'active' })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not update read status'),
  })

  const openTask = (t) => {
    setViewTask(t)
    if (!t.viewed && t.assignee === user?.name) markViewedMut.mutate(t.id)
  }

  const columns = [
    { key: 'sno', header: 'S.No', render: (t) => <span className="text-muted">{t.sno}</span> },
    { key: 'title', header: 'Task', render: (t) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{t.title}</span>
        {(t.attachments || []).length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted" title={`${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''}`}>
            <FiPaperclip className="h-3.5 w-3.5" />{t.attachments.length}
          </span>
        )}
      </div>
    ) },
    { key: 'projectName', header: 'Project', render: (t) => <span className="text-muted">{t.projectName || '\u2014'}</span> },
    { key: 'assignee', header: 'Assignee', render: (t) => t.assignee || '\u2014' },
    { key: 'startedAt', header: 'Started', render: (t) => formatDateTime(t.startedAt) },
    { key: 'durationSec', header: 'Duration', render: (t) => <DurationCell task={t} /> },
    { key: '_actions', header: '', className: 'text-right', render: (t) => (
      <Button variant="ghost" size="sm" icon={FiEye} onClick={() => openTask(t)}>
        View
      </Button>
    ) },
  ]

  return (
    <div>
      <PageHeader
        title="Task History"
        subtitle="Complete timeline of every task: assignment, acceptance, work and completion."
        icon={FiClock}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {isEmployee && (
              <>
                <Button icon={FiPlus} onClick={() => setCreateOpen(true)}>Create Task</Button>
                <Button variant="ghost" icon={FiCheck} onClick={() => navigate('/my-tasks')}>My Task</Button>
                <Button variant="ghost" icon={FiClock} onClick={() => navigate('/my-tasks/review')}>Task Review</Button>
              </>
            )}
            {dirty && (
              <Button variant="ghost" icon={FiRotateCcw} onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
        )}
      />

      <Card className="mb-4">
        <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <FiFilter className="h-3.5 w-3.5" /> Filters
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Project"
            value={filters.project}
            onChange={set('project')}
            options={projectOptions}
            loading={projectsQuery.isLoading}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={set('status')}
            options={[
              { value: '', label: 'All statuses' },
              ...SUBMISSION_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <Input label="From" type="date" value={filters.from} onChange={set('from')} />
          <Input label="To" type="date" value={filters.to} onChange={set('to')} />
        </div>
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-primary"
            checked={filters.mine}
            onChange={set('mine')}
          />
          Only tasks assigned to me
        </label>
        <p className="mt-2 text-xs text-muted">
          Date filters match when an event happened, not when the task was created, so long-running tasks still appear.
        </p>
      </Card>

      {isLoading ? (
        <Loader />
      ) : isError ? (
        <EmptyState
          title="Could not load task history"
          description={error?.response?.data?.message || error?.message || 'Please try again.'}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No task history found"
          description={dirty
            ? 'No tasks match these filters. Try widening the date range or clearing the project filter.'
            : 'Assign, submit or review a task to build its timeline.'}
        />
      ) : (
        <Card>
          <p className="mb-3 text-sm text-muted">
            {rows.length} task{rows.length === 1 ? '' : 's'}
          </p>
          <DataTable
            columns={columns}
            data={rows.map((r, i) => ({ ...r, sno: i + 1 }))}
            empty="No tasks match the current filters."
          />
        </Card>
      )}

      {viewTask && (
        <TaskTimelineModal task={viewTask} onClose={() => setViewTask(null)} />
      )}

      <TaskModal
        open={createOpen}
        employeeMode
        projects={projectsQuery.data || []}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createMut.mutate(values)}
        saving={createMut.isPending}
        assignees={assignees}
      />
    </div>
  )
}

function TaskTimelineModal({ task, onClose }) {
  const extraComments = [
    ...(task.submissionComments || []).map((c) => ({ ...c, kind: 'Submission' })),
    ...(task.reviewComments || []).map((c) => ({ ...c, kind: `Review \u00b7 ${c.status}` })),
    ...(task.comments || []).map((c) => ({ by: c.by, comment: c.body, at: c.at, kind: c.viaClientPortal ? 'Client' : 'Comment' })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  return (
    <Modal open onClose={onClose} title={task.title} size="lg">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={TASK_STATUS_TONE[task.status] || 'default'}>{task.status}</Badge>
        <Badge tone={ASSIGNMENT_STATUS_TONE[task.assignmentStatus] || 'default'}>
          {task.assignmentStatus || 'Assigned'}
        </Badge>
        {task.priority && <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>}
        <span className="text-xs text-muted">{task.projectName || 'Unknown project'}</span>
      </div>
      <p className="mb-3 text-sm text-muted">
        Assignee: {task.assignee || '\u2014'}
        {task.startedAt ? ` \u00b7 started ${formatDateTime(task.startedAt)}` : ''}
        {task.completedAt ? ` \u00b7 took ${formatDuration(task.durationSec)}` : ''}
        {task.pausedSec ? ` \u00b7 paused ${formatDuration(task.pausedSec)}` : ''}
      </p>
      {(task.attachments || []).length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-app p-2">
          {task.attachments.map((a) => (
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
      )}
      {(task.timeline || []).length === 0 ? (
        <p className="text-sm text-muted">No timeline events recorded for this task yet.</p>
      ) : (
        <ol className="list-none">
          {task.timeline.map((e, i) => (
            <TimelineEntry key={e.id || i} entry={e} last={i === task.timeline.length - 1} />
          ))}
        </ol>
      )}
      {extraComments.length > 0 && (
        <div className="mt-2 border-t pt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <FiMessageSquare className="h-3.5 w-3.5" /> Comments
          </p>
          <ul className="space-y-2">
            {extraComments.map((c, i) => (
              <li key={i} className="rounded-lg bg-muted/10 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.by}</span>
                  <Badge tone="default">{c.kind}</Badge>
                  <span className="text-xs text-muted">{formatDateTime(c.at)}</span>
                </div>
                <p className="mt-1 text-sm">{c.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}