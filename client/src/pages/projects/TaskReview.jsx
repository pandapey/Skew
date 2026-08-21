import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiCheck, FiX, FiInbox, FiPaperclip, FiClock, FiCornerUpLeft, FiPlus,
  FiCheckCircle, FiXCircle, FiRotateCcw,
} from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { TaskModal } from '@/features/projects/TaskModal'
import {
  PageHeader, Card, DataTable, Badge, Loader, EmptyState, StatCard, Button, Select,
} from '@/components/ui'
import { DecisionDialog } from '@/components/DecisionDialog'
import { PRIORITY_TONE } from '@/features/projects/constants'
import { fileUrl } from '@/features/files/constants'
import { formatDate } from '@/utils'

const APPROVE_PRESETS = ['Approved.', 'Excellent work.', 'Approved. Please improve documentation.']
const REJECT_PRESETS = ['Rejected.', 'Missing API integration.', 'Needs redesign.']

function formatDateTime(value) {
  if (!value) return '\u2014'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '\u2014'
  return `${formatDate(value)} \u00b7 ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export default function TaskReview() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const [decision, setDecision] = useState(null)

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['task-review-queue'],
    queryFn: () => projectApi.reviewQueue(),
  })

  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: () => projectApi.all() })
  const projectMap = useMemo(() => {
    const m = {}
    ;(projects || []).forEach((p) => { m[p.id || p._id] = p.name })
    return m
  }, [projects])

  const reviewMut = useMutation({
    mutationFn: ({ id, action, comment }) => projectApi.reviewTask(id, action, comment),
    onSuccess: (_r, v) => {
      const VERB = { approve: 'approved', reject: 'rejected', return: 'returned for rework' }
      toast.success(`Task ${VERB[v.action] || 'reviewed'} \u2014 employee notified`)
      notify({
        type: 'task',
        title: { approve: 'Task Approved', reject: 'Task Rejected', return: 'Task Returned' }[v.action] || 'Task Reviewed',
        body: `You ${VERB[v.action] || 'reviewed'} \u201c${v.title}\u201d. Comment: ${v.comment}`,
        sender: user?.name,
        link: '/projects/reviews',
        priority: 'normal',
      })
      setDecision(null)
      qc.invalidateQueries({ queryKey: ['task-review-queue'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['projects-all'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['tasks'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['task-history'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['project-detail'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['project-stats'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not record the review'),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('')
  const { data: assignees = [] } = useQuery({ queryKey: ['project-assignees'], queryFn: () => projectApi.assignees() })

  // PHASE: EMPLOYEE TASK REVIEW — widget counts for review OUTCOMES (Approved /
  // Rejected / Reassigned) instead of the "with attachments" convenience count.
  // The full task list carries submissionStatus + assignmentStatus, so the
  // widgets reflect decisions made across the user's accessible scope.
  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: () => projectApi.tasks(),
  })
  const outcomeCounts = useMemo(() => ({
    approved: (allTasks || []).filter((t) => t.submissionStatus === 'Approved').length,
    rejected: (allTasks || []).filter((t) => t.submissionStatus === 'Rejected').length,
    reassigned: (allTasks || []).filter((t) => t.assignmentStatus === 'Reassigned').length,
  }), [allTasks])

  const filteredTasks = useMemo(
    () => (projectFilter ? tasks.filter((t) => t.project === projectFilter) : tasks),
    [tasks, projectFilter],
  )

  // Row index -> serial number, keyed by task object identity so the S.No
  // column matches the exact rows the DataTable renders (filtered by project).
  const snoMap = useMemo(
    () => new Map(filteredTasks.map((t, i) => [t, i + 1])),
    [filteredTasks],
  )

  const makeFileForm = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return fd
}

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
      qc.invalidateQueries({ queryKey: ['task-review-queue'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['projects-all'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['tasks'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['task-history'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['project-detail'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['project-stats'], refetchType: 'active' })
      qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not create this task'),
  })

  // PHASE: EMPLOYEE TASK REVIEW — the Priority column is REMOVED for the
  // Employee review surface (/my-tasks/review). Priority stays on the manager
  // review queue (/projects/reviews) and everywhere task creation/assignment
  // uses it; only the Employee view omits the column.
  const isEmployeeReview = user?.role === ROLES.EMPLOYEE
  const columns = [
    { key: 'sno', header: 'S.No', render: (t) => (
      <span className="text-muted">{snoMap.get(t) ?? '\u2014'}</span>
    ) },
    { key: 'title', header: 'Task', render: (t) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{t.title}</span>
      </div>
    ) },
    { key: 'project', header: 'Project', render: (t) => <span className="text-muted">{projectMap[t.project] || '\u2014'}</span> },
    { key: 'assignee', header: 'Submitted By', render: (t) => t.submission?.by || t.assignee || '\u2014' },
    ...(!isEmployeeReview
      ? [{ key: 'priority', header: 'Priority', render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge> }]
      : []),
    { key: 'submittedAt', header: 'Submitted', render: (t) => formatDateTime(t.submission?.at) },
    { key: 'comment', header: 'Comment', render: (t) => (
      <div className="max-w-xs">
        <p className="truncate text-sm">{t.submission?.comment || '\u2014'}</p>
        {t.submission?.attachment?.url && (
          <a
            href={fileUrl(t.submission.attachment.url)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <FiPaperclip className="h-3 w-3" />
            {t.submission.attachment.name || 'Attachment'}
          </a>
        )}
      </div>
    ) },
    { key: '_actions', header: '', className: 'text-right', render: (t) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          className="rounded-lg p-2 text-success transition hover:bg-success/10"
          onClick={() => setDecision({ task: t, action: 'approve' })}
          aria-label={`Approve ${t.title}`}
        >
          <FiCheck />
        </button>
        <button
          className="rounded-lg p-2 text-warning transition hover:bg-warning/10"
          onClick={() => setDecision({ task: t, action: 'return' })}
          aria-label={`Return ${t.title} for rework`}
          title="Return for rework"
        >
          <FiCornerUpLeft />
        </button>
        <button
          className="rounded-lg p-2 text-danger transition hover:bg-danger/10"
          onClick={() => setDecision({ task: t, action: 'reject' })}
          aria-label={`Reject ${t.title}`}
        >
          <FiX />
        </button>
      </div>
    ) },
  ]

  return (
    <div>
      <PageHeader
        title="Task Reviews"
        subtitle="Work submitted by your team, waiting on your approval."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={FiPlus} onClick={() => setCreateOpen(true)}>Create Task</Button>
            {user?.role === ROLES.EMPLOYEE && (
              <Button variant="ghost" icon={FiCheck} onClick={() => navigate('/my-tasks')}>My Task</Button>
            )}
            <Button variant="ghost" icon={FiClock} onClick={() => navigate('/my-tasks/history')}>View Task History</Button>
          </div>
        )}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Awaiting Review" value={tasks.length} icon={FiInbox} tone="warning" />
        <StatCard label="Approved" value={outcomeCounts.approved} icon={FiCheckCircle} tone="success" />
        <StatCard label="Rejected" value={outcomeCounts.rejected} icon={FiXCircle} tone="danger" />
        <StatCard label="Reassigned" value={outcomeCounts.reassigned} icon={FiRotateCcw} tone="accent" />
      </div>

      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Select
            label="Project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            options={[{ value: '', label: 'All projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            className="w-full sm:w-56"
          />
          {projectFilter && (
            <Button variant="ghost" icon={FiRotateCcw} onClick={() => setProjectFilter('')}>
              Reset
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loader label="Loading submissions\u2026" />
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            description="When someone on your project submits a task, it will appear here."
          />
        ) : (
          <DataTable columns={columns} data={filteredTasks} empty="No submissions awaiting review." />
        )}
      </Card>

      <TaskModal
        open={createOpen}
        employeeMode
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createMut.mutate(values)}
        saving={createMut.isPending}
        assignees={assignees}
      />

      <DecisionDialog
        open={!!decision}
        action={decision?.action === 'approve' ? 'approve' : 'reject'}
        title={{
          approve: 'Approve Submission',
          reject: 'Reject Submission',
          return: 'Return for Rework',
        }[decision?.action] || 'Review Submission'}
        subject={decision?.task
          ? `${decision.task.title} \u00b7 submitted by ${decision.task.submission?.by || decision.task.assignee}`
          : ''}
        suggestions={decision?.action === 'approve' ? APPROVE_PRESETS : REJECT_PRESETS}
        busy={reviewMut.isPending}
        onClose={() => setDecision(null)}
        onConfirm={(comment) => reviewMut.mutate({
          id: decision.task.id,
          action: decision.action,
          comment,
          title: decision.task.title,
        })}
      />
    </div>
  )
}
