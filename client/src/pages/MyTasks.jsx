import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useViewState } from '@/hooks/useViewState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import {
  FiLayers, FiClock, FiLoader, FiCheckCircle, FiAlertTriangle,
  FiMessageSquare, FiPaperclip, FiSend, FiCheckSquare,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useMyTasks } from '@/hooks/queries/useMyTasks'
import { TaskSubmitModal } from '@/features/projects/TaskSubmitModal'
import {
  PageHeader, Card, StatCard, DataTable, Badge, SearchInput, Select, Modal,
  ProgressBar, Loader, EmptyState, Button,
} from '@/components/ui'
import { PRIORITY_TONE, TASK_STATUS_TONE, TYPE_TONE, PRIORITIES, TASK_STATUSES } from '@/features/projects/constants'
import { formatDate } from '@/utils'

// Employee "My Tasks" module (Issue 5). Shows ONLY tasks assigned to the
// logged-in employee. Data comes from projectApi.tasks({ assignee: user.name })
// via the shared useMyTasks() hook — the backend already scopes tasks to
// projects the caller can access and filters by assignee, so no other
// employees' tasks are ever returned and no RBAC is changed.
//
// Task attachments: the ProjectTask schema stores no per-task file field
// (attachments live at the project level only), so an Attachments column is
// intentionally omitted rather than faked — documented in the Phase 3 report.
//
// Phase 4 (Part 7): an employee can now submit an assigned task for review from
// the task detail modal. A submission stores a mandatory comment plus the date
// and time, and is routed to the project lead who assigned the task. The lead's
// review verdict and comment come back into Task History (Part 8).
//
// Phase 6.2 (Task 2): the employee-side ACCEPT / DECLINE step was removed. A
// task assigned by a lead is now simply 'Assigned' and the employee's only
// actions are to work on it and submit it. The LEAD review workflow
// (submit -> approve / reject / return) is untouched and still lives in
// pages/projects/TaskReview.jsx + projectApi.reviewTask().

// Submission status -> badge tone, reused by the table and the detail modal.
const SUBMISSION_TONE = {
  'Not Submitted': 'default',
  Submitted: 'warning',
  Approved: 'success',
  Rejected: 'danger',
}

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return `${formatDate(value)} \u00b7 ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

const CARDS = [
  { key: 'all', label: 'Assigned', icon: FiLayers, tone: 'primary' },
  { key: 'pending', label: 'Pending', icon: FiClock, tone: 'warning' },
  { key: 'inprogress', label: 'In Progress', icon: FiLoader, tone: 'accent' },
  { key: 'completed', label: 'Completed', icon: FiCheckCircle, tone: 'success' },
  { key: 'overdue', label: 'Overdue', icon: FiAlertTriangle, tone: 'danger' },
]

const isOverdue = (t) => t.dueDate && t.status !== 'Done' && dayjs(t.dueDate).isBefore(dayjs(), 'day')

// Map a task to the dashboard bucket used by the filter cards.
const matchesBucket = (t, bucket) => {
  if (bucket === 'all') return true
  if (bucket === 'pending') return t.status === 'Todo'
  if (bucket === 'inprogress') return t.status === 'In Progress'
  if (bucket === 'completed') return t.status === 'Done'
  if (bucket === 'overdue') return isOverdue(t)
  return true
}

export default function MyTasks() {
  // Phase 6.12 (TASK 3) ROOT CAUSE: `useNavigate` was imported at the top of
  // this file (line 2) but the hook was NEVER CALLED, so the `navigate`
  // identifier referenced by the "Task Review" and "Task History" header
  // buttons below resolved to nothing at all. Clicking either button threw
  // ReferenceError: navigate is not defined, which React swallowed inside the
  // onClick handler - so both buttons simply appeared dead, with no route, no
  // permission and no API ever being reached. The routes themselves already
  // exist and are correctly registered in routes/index.jsx
  // (route('/projects/reviews', TaskReview) and route('/task-history',
  // TaskHistory), both defaulting to STAFF_ROLES, which includes Employee),
  // and both target pages scope their data SERVER-SIDE from req.user. So the
  // fix is this single missing declaration - no new page, no new route, no
  // RBAC change and no duplicated navigation helper.
  const navigate = useNavigate()
  const { data: tasks = [], isLoading } = useMyTasks()
  // Accessible projects -> id->name map so the table shows the project NAME
  // (tasks store only the project ObjectId).
  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: () => projectApi.all() })
  const projectMap = useMemo(() => {
    const m = {}
    ;(projects || []).forEach((p) => { m[p.id || p._id] = p.name })
    return m
  }, [projects])

  // Phase 5.7 (Task 7): persist filter/sort/bucket so Back restores the list.
  const [vs, patchVs] = useViewState('filters', { bucket: 'all', search: '', status: '', priority: '', sortKey: 'dueDate', sortOrder: 'asc' })
  const bucket = vs.bucket
  const setBucket = (v) => patchVs({ bucket: v })
  const search = vs.search
  const setSearch = (v) => patchVs({ search: v })
  const status = vs.status
  const setStatus = (v) => patchVs({ status: v })
  const priority = vs.priority
  const setPriority = (v) => patchVs({ priority: v })
  const sort = { key: vs.sortKey, order: vs.sortOrder }
  const setSort = (fn) => { const next = typeof fn === 'function' ? fn(sort) : fn; patchVs({ sortKey: next.key, sortOrder: next.order }) }
  const [commentsTask, setCommentsTask] = useState(null)
  const [submitTask, setSubmitTask] = useState(null)
  const qc = useQueryClient()

  // Part 7: submit an assigned task for the project lead's review.
  const submitMut = useMutation({
    mutationFn: ({ id, payload }) => projectApi.submitTask(id, payload),
    onSuccess: () => {
      toast.success('Task submitted \u2014 your project lead has been notified')
      setSubmitTask(null)
      setCommentsTask(null)
      // Phase 6.2 (Task 3) ROOT CAUSE C - WRONG QUERY KEY.
      // This invalidated ['my-tasks'], but the list on screen is served by
      // useMyTasks() under ['tasks', 'mine', user._id] (hooks/queries/useMyTasks.js).
      // TanStack matches keys by PREFIX, so ['my-tasks'] never matched anything
      // and the table kept the pre-submission row until a manual refresh.
      // ['tasks'] is the real prefix, so it matches ['tasks','mine',<id>].
      qc.invalidateQueries({ queryKey: ['tasks'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['task-review-queue'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['task-history'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['project-detail'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not submit this task'),
  })

  const projectName = (t) => projectMap[t.project] || t.projectName || '\u2014'

  const counts = useMemo(() => ({
    all: tasks.length,
    pending: tasks.filter((t) => t.status === 'Todo').length,
    inprogress: tasks.filter((t) => t.status === 'In Progress').length,
    completed: tasks.filter((t) => t.status === 'Done').length,
    overdue: tasks.filter(isOverdue).length,
  }), [tasks])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = tasks
      .filter((t) => matchesBucket(t, bucket))
      .filter((t) => (status ? t.status === status : true))
      .filter((t) => (priority ? t.priority === priority : true))
      .filter((t) => (q ? (`${t.title} ${projectName(t)}`.toLowerCase().includes(q)) : true))
    const dir = sort.order === 'asc' ? 1 : -1
    out = [...out].sort((a, b) => {
      let av = a[sort.key]; let bv = b[sort.key]
      if (sort.key === 'project') { av = projectName(a); bv = projectName(b) }
      if (av == null) return 1
      if (bv == null) return -1
      return av > bv ? dir : av < bv ? -dir : 0
    })
    return out
  }, [tasks, bucket, status, priority, search, sort, projectMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSort = (key) => setSort((s) => ({ key, order: s.key === key && s.order === 'asc' ? 'desc' : 'asc' }))

  const columns = [
    { key: 'title', header: 'Task Name', sortable: true, render: (t) => (
      <div className="flex items-center gap-2">
        <Badge tone={TYPE_TONE[t.type]}>{t.type}</Badge>
        <span className="font-medium">{t.title}</span>
      </div>
    ) },
    { key: 'project', header: 'Project', sortable: true, render: (t) => <span className="text-muted">{projectName(t)}</span> },
    { key: 'priority', header: 'Priority', sortable: true, render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge> },
    { key: 'status', header: 'Status', sortable: true, render: (t) => (
      <Badge tone={isOverdue(t) ? 'danger' : TASK_STATUS_TONE[t.status]}>{isOverdue(t) ? 'Overdue' : t.status}</Badge>
    ) },
    { key: 'createdAt', header: 'Assigned Date', sortable: true, render: (t) => formatDate(t.createdAt) },
    { key: 'dueDate', header: 'Due Date', sortable: true, render: (t) => (t.dueDate ? formatDate(t.dueDate) : '\u2014') },
    { key: 'progress', header: 'Progress', render: (t) => <div className="w-28"><ProgressBar value={t.progress || 0} showLabel /></div> },
    { key: 'submissionStatus', header: 'Submission', render: (t) => (
      <Badge tone={SUBMISSION_TONE[t.submissionStatus] || 'default'}>{t.submissionStatus || 'Not Submitted'}</Badge>
    ) },
    { key: 'comments', header: 'Comments', render: (t) => (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setCommentsTask(t) }}
        className="inline-flex items-center gap-1 rounded-lg border border-app px-2 py-1 text-xs text-muted transition hover:border-primary hover:text-primary"
      >
        <FiMessageSquare className="h-3.5 w-3.5" /> View
      </button>
    ) },
  ]

  return (
    <div>
      {/* Phase 6.9 (TASK 9): My Tasks is the single Employee task hub. Task
          Review and Task History are reached from HERE, which is why the
          Employee's duplicate "Task Reviews" sidebar entry was removed in
          constants/navigation.js. Both buttons navigate to the EXISTING
          /projects/reviews and /task-history routes - neither page is
          reimplemented or duplicated, and both keep their own server-side
          scoping. */}
      <PageHeader
        title="My Tasks"
        subtitle="Every task assigned to you across your projects."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" icon={FiCheckSquare} onClick={() => navigate('/projects/reviews')}>Task Review</Button>
            <Button variant="ghost" icon={FiClock} onClick={() => navigate('/task-history')}>Task History</Button>
          </div>
        )}
      />

      {/* Dashboard cards — each filters the table below. */}
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((c) => (
          <button key={c.key} type="button" onClick={() => setBucket(c.key)} className="text-left focus:outline-none">
            <div className={`rounded-[20px] transition ${bucket === c.key ? 'ring-2 ring-primary' : ''}`}>
              <StatCard label={c.label} value={counts[c.key]} icon={c.icon} tone={c.tone} />
            </div>
          </button>
        ))}
      </div>

      <Card>
        {/* Search + filters (aligned, responsive, shared design system). */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search tasks or projects\u2026" className="w-full sm:max-w-xs" />
          <div className="grid grid-cols-2 gap-3 sm:flex sm:w-auto">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="All Statuses"
              options={[{ value: '', label: 'All Statuses' }, ...TASK_STATUSES.map((s) => ({ value: s, label: s }))]}
              className="sm:w-40"
            />
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              placeholder="All Priorities"
              options={[{ value: '', label: 'All Priorities' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))]}
              className="sm:w-40"
            />
          </div>
        </div>

        {isLoading ? (
          <Loader label="Loading your tasks\u2026" />
        ) : tasks.length === 0 ? (
          <EmptyState title="You don't have any assigned tasks." />
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
        <TaskCommentsModal
          task={commentsTask}
          projectName={projectName(commentsTask)}
          onClose={() => setCommentsTask(null)}
          onSubmitTask={() => setSubmitTask(commentsTask)}
        />
      )}

      {/* Part 7: submission dialog (mandatory comment + optional attachment) */}
      <TaskSubmitModal
        open={!!submitTask}
        task={submitTask}
        busy={submitMut.isPending}
        onClose={() => setSubmitTask(null)}
        onSubmit={(payload) => submitMut.mutate({ id: submitTask.id, payload })}
      />
    </div>
  )
}

// Read-only task detail + task-scoped comment thread. Comments are loaded on
// demand from the real GET /project/comments?task=<id> endpoint.
function TaskCommentsModal({ task, projectName, onClose, onSubmitTask }) {
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['task-comments', task.id],
    queryFn: () => projectApi.comments({ task: task.id }),
  })

  // An employee may submit while the task is not already awaiting review and
  // has not already been approved. The server re-checks assignee + state.
  const canSubmit = task.submissionStatus !== 'Submitted' && task.submissionStatus !== 'Approved'
  const history = [
    ...(task.submissionHistory || []).map((h) => ({ ...h, kind: 'submission' })),
    ...(task.reviewHistory || []).map((h) => ({ ...h, kind: 'review' })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at))

  return (
    <Modal
      open
      onClose={onClose}
      title="Task Details"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {canSubmit && <Button icon={FiSend} onClick={onSubmitTask}>Submit Task</Button>}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={TYPE_TONE[task.type]}>{task.type}</Badge>
        <Badge tone={TASK_STATUS_TONE[task.status]}>{task.status}</Badge>
        <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
      </div>
      <h3 className="text-lg font-semibold">{task.title}</h3>
      <p className="mt-1 text-sm text-muted">{task.description || 'No description.'}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Project', projectName], ['Assigned', formatDate(task.createdAt)], ['Due', task.dueDate ? formatDate(task.dueDate) : '\u2014'], ['Progress', `${task.progress || 0}%`]].map(([l, v]) => (
          <div key={l}><p className="text-xs text-muted">{l}</p><p className="text-sm font-medium">{v}</p></div>
        ))}
      </div>
      <div className="mt-4"><ProgressBar value={task.progress || 0} showLabel /></div>

      {/* Parts 7 & 8: submission + review trail, newest last. */}
      <div className="mt-6 border-t border-app pt-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FiCheckCircle /> Task History
          <Badge tone={SUBMISSION_TONE[task.submissionStatus] || 'default'}>
            {task.submissionStatus || 'Not Submitted'}
          </Badge>
        </h4>
        {history.length === 0 ? (
          <p className="py-3 text-sm text-muted">This task has not been submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {history.map((h, i) => (
              <div
                key={i}
                className={`rounded-xl border p-3 ${
                  h.kind === 'review'
                    ? h.status === 'Approved'
                      ? 'border-success/40 bg-success/5'
                      : 'border-danger/40 bg-danger/5'
                    : 'border-app'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {h.kind === 'review' ? `${h.status} by ${h.reviewer}` : `Submitted by ${h.by}`}
                  </span>
                  <span className="text-xs text-muted">{formatDateTime(h.at)}</span>
                </div>
                <p className="text-sm">{h.comment}</p>
                {h.attachment?.url && (
                  <a
                    href={h.attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <FiPaperclip className="h-3 w-3" />
                    {h.attachment.name || 'Attachment'}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-app pt-4">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FiMessageSquare /> Comments</h4>
        {isLoading ? (
          <Loader label="Loading comments\u2026" />
        ) : comments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No comments on this task yet.</p>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c.id || c._id} className="rounded-xl border border-app p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{c.author || c.user || 'Unknown'}</span>
                  <span className="text-xs text-muted">{formatDate(c.createdAt)}</span>
                </div>
                <p className="text-sm text-muted">{c.body || c.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
