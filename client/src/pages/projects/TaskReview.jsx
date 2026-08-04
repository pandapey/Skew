import { useMemo, useState } from 'react'
// Phase 6.15 (TASK 6): useNavigate is back - HR (and every other lead role
// that lands here) gets a "View Task History" button again. Phase 6.9 (TASK 9)
// removed it because at the time it was the page's only navigation and had
// been moved to My Tasks; it is restored here rather than duplicated, reusing
// the identical /task-history route and TaskHistory.jsx page MyTasks.jsx
// already links to - no second Task History implementation.
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiCheck, FiX, FiInbox, FiPaperclip, FiClock, FiCornerUpLeft } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/features/notifications/NotificationContext'
import {
  // Phase 6.15 (TASK 6): Button is back for the "View Task History" action.
  PageHeader, Card, DataTable, Badge, Loader, EmptyState, StatCard, Button,
} from '@/components/ui'
import { DecisionDialog } from '@/components/DecisionDialog'
import { PRIORITY_TONE, TYPE_TONE } from '@/features/projects/constants'
import { formatDate } from '@/utils'

// Part 8 — Team Lead review page.
//
// Lists every task submitted for review that belongs to THIS lead (tasks they
// assigned, or tasks on a project they lead). The queue is computed server-side
// by GET /project/tasks/review-queue, so a lead can never see another lead's
// submissions. Approve and Reject both require a comment, enforced by the
// shared DecisionDialog in the UI and by a 422 in the service layer.

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
      // Phase 5.5 (Task 5): 'return' is a third outcome, not a rejection.
      const VERB = { approve: 'approved', reject: 'rejected', return: 'returned for rework' }
      toast.success(`Task ${VERB[v.action] || 'reviewed'} \u2014 employee notified`)
      // The per-employee notification is created server-side; this is the
      // reviewer's own in-session confirmation.
      notify({
        type: 'task',
        title: { approve: 'Task Approved', reject: 'Task Rejected', return: 'Task Returned' }[v.action] || 'Task Reviewed',
        body: `You ${VERB[v.action] || 'reviewed'} \u201c${v.title}\u201d. Comment: ${v.comment}`,
        sender: user?.name,
        link: '/projects/reviews',
        priority: 'normal',
      })
      setDecision(null)
      // Phase 6.2 (Task 3): same wrong-key defect as MyTasks.jsx - ['my-tasks']
      // matched no query, so the employee's list never reflected the lead's
      // approve/reject. ['tasks'] is the prefix useMyTasks() actually uses.
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

  const columns = [
    { key: 'title', header: 'Task', render: (t) => (
      <div className="flex items-center gap-2">
        <Badge tone={TYPE_TONE[t.type]}>{t.type}</Badge>
        <span className="font-medium">{t.title}</span>
      </div>
    ) },
    { key: 'project', header: 'Project', render: (t) => <span className="text-muted">{projectMap[t.project] || '\u2014'}</span> },
    { key: 'assignee', header: 'Submitted By', render: (t) => t.submission?.by || t.assignee || '\u2014' },
    { key: 'priority', header: 'Priority', render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge> },
    { key: 'submittedAt', header: 'Submitted', render: (t) => formatDateTime(t.submission?.at) },
    { key: 'comment', header: 'Comment', render: (t) => (
      <div className="max-w-xs">
        <p className="truncate text-sm">{t.submission?.comment || '\u2014'}</p>
        {t.submission?.attachment?.url && (
          <a
            href={t.submission.attachment.url}
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
        actions={<Button variant="ghost" icon={FiClock} onClick={() => navigate('/task-history')}>View Task History</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting Review" value={tasks.length} icon={FiInbox} tone="warning" />
        <StatCard
          label="Urgent"
          value={tasks.filter((t) => t.priority === 'Urgent' || t.priority === 'High').length}
          icon={FiClock}
          tone="danger"
        />
        <StatCard
          label="With Attachments"
          value={tasks.filter((t) => t.submission?.attachment?.url).length}
          icon={FiPaperclip}
          tone="accent"
        />
      </div>

      <Card>
        {isLoading ? (
          <Loader label="Loading submissions\u2026" />
        ) : tasks.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            description="When someone on your project submits a task, it will appear here."
          />
        ) : (
          <DataTable columns={columns} data={tasks} empty="No submissions awaiting review." />
        )}
      </Card>

      {/* Mandatory review comment */}
      <DecisionDialog
        open={!!decision}
        // DecisionDialog styles itself from a binary action, so 'return' is
        // mapped to the non-destructive branch and distinguished by its title.
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
