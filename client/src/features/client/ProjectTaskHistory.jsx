import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FiUserCheck, FiUserPlus, FiXCircle, FiCornerUpLeft, FiRefreshCw,
  FiCheckCircle, FiSend, FiThumbsUp, FiEye,
} from 'react-icons/fi'
import { clientService } from './clientService'
import { Card, CardHeader, Badge, Loader, EmptyState, DataTable, Modal, Button } from '@/components/ui'
import { fmtDateTime } from './constants'
import { TASK_STATUS_TONE, PRIORITY_TONE } from '../projects/constants'

const EVENT_ICON = {
  Assigned: FiUserPlus,
  Accepted: FiUserCheck,
  Rejected: FiXCircle,
  Returned: FiCornerUpLeft,
  Reassigned: FiRefreshCw,
  Completed: FiCheckCircle,
  Submitted: FiSend,
  Approved: FiThumbsUp,
}

const EVENT_TONE = {
  Assigned: 'primary',
  Accepted: 'success',
  Rejected: 'danger',
  Returned: 'warning',
  Reassigned: 'accent',
  Completed: 'success',
  Submitted: 'primary',
  Approved: 'success',
}

const shortTaskId = (id) => (id ? `TASK-${String(id).slice(-6).toUpperCase()}` : '—')

export default function ProjectTaskHistory({ projectId }) {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['client-project-task-history', projectId],
    queryFn: () => clientService.getProjectTaskHistory(projectId),
    enabled: !!projectId,
  })

  const [openTaskId, setOpenTaskId] = useState(null)
  const openTask = useMemo(
    () => tasks.find((t) => (t.id || t._id) === openTaskId) || null,
    [tasks, openTaskId],
  )

  const viewHistory = (t) => setOpenTaskId(t.id || t._id)

  const columns = [
    { key: 'title', header: 'Task Name', render: (t) => <span className="font-medium">{t.title}</span> },
    { key: 'taskId', header: 'Task ID', render: (t) => <span className="text-xs text-muted">{shortTaskId(t.id || t._id)}</span> },
    { key: 'assignedBy', header: 'Assigned By', render: (t) => t.assignedBy || '—' },
    { key: 'assignee', header: 'Assigned To', render: (t) => t.assignee || '—' },
    { key: 'status', header: 'Current Status', render: (t) => <Badge tone={TASK_STATUS_TONE[t.status]}>{t.status || '—'}</Badge> },
    { key: 'priority', header: 'Priority', render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority || '—'}</Badge> },
    { key: 'updatedAt', header: 'Last Updated', render: (t) => fmtDateTime(t.updatedAt) },
    {
      key: 'action',
      header: 'Action',
      render: (t) => (
        <Button
          variant="ghost"
          size="sm"
          icon={FiEye}
          onClick={(e) => { e.stopPropagation(); viewHistory(t) }}
        >
          View History
        </Button>
      ),
    },
  ]

  if (isLoading) return <Loader label="Loading task history..." />

  return (
    <Card>
      <CardHeader title="Task History" subtitle="Every task on this project, with its full audit trail" />
      {tasks.length === 0 ? (
        <EmptyState title="No task history yet" description="Tasks will appear here once your team starts work on this project." />
      ) : (
        <DataTable
          columns={columns}
          data={tasks}
          getRowId={(t) => t.id || t._id}
          onRowClick={viewHistory}
          empty="No task history yet"
        />
      )}

      <Modal
        open={!!openTask}
        onClose={() => setOpenTaskId(null)}
        title={openTask ? `Task History · ${openTask.title}` : 'Task History'}
        size="lg"
        footer={<Button variant="ghost" onClick={() => setOpenTaskId(null)}>Close</Button>}
      >
        {openTask && (
          (openTask.timeline || []).length === 0 ? (
            <EmptyState title="No history recorded" description="Nothing has happened on this task yet." />
          ) : (
            <div className="space-y-2.5">
              {openTask.timeline.map((h) => {
                const Icon = EVENT_ICON[h.event] || FiRefreshCw
                return (
                  <div key={h.id || `${h.event}-${h.at}`} className="flex items-start gap-3 rounded-xl border border-app p-3">
                    <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Badge tone={EVENT_TONE[h.event] || 'default'}>{h.event}</Badge>
                        <span className="text-xs text-muted">{fmtDateTime(h.at)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {h.by}{h.to ? ` \u2192 ${h.to}` : ''}
                      </p>
                      {h.comment && <p className="mt-1 text-sm">{h.comment}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </Modal>
    </Card>
  )
}
