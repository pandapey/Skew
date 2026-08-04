import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader, Select, Button, Modal, Loader, Badge } from '@/components/ui'
import { KanbanBoard } from '@/features/projects/KanbanBoard'
import { TaskModal } from '@/features/projects/TaskModal'
import { ProgressBar } from '@/features/projects/ProgressBar'
import { CommentsPanel } from '@/features/projects/CommentsPanel'
import {
  PROJECT_WRITE_ROLES, PRIORITY_TONE, TYPE_TONE, TASK_STATUS_TONE,
} from '@/features/projects/constants'
import { formatDate } from '@/utils'

export default function Board() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)

  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })
  const [projectId, setProjectId] = useState('')
  useEffect(() => { if (!projectId && projects.length) setProjectId(projects[0].id) }, [projects, projectId])

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: () => projectApi.tasks({ project: projectId }),
    enabled: !!projectId,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detail, setDetail] = useState(null)

  const activeProject = projects.find((p) => p.id === projectId)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project-tasks', projectId] })
    qc.invalidateQueries({ queryKey: ['project-stats'] })
    qc.invalidateQueries({ queryKey: ['projects-all'] })
  }

  const moveMut = useMutation({
    mutationFn: ({ id, status }) => projectApi.moveTask(id, status),
    onSuccess: (_r, v) => { toast.success(`Moved to ${v.status}`); invalidate() },
    onError: () => toast.error('Could not move task'),
  })
  const saveMut = useMutation({
    mutationFn: (values) => (editing ? projectApi.updateTask(editing.id, values) : projectApi.createTask({ ...values, project: projectId })),
    onSuccess: () => { toast.success(editing ? 'Task updated' : 'Task created — team notified'); setModalOpen(false); invalidate() },
    onError: () => toast.error('Could not save task'),
  })

  const openAdd = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (t) => { setEditing(t); setDetail(null); setModalOpen(true) }

  return (
    <div>
      <PageHeader
        title="Kanban Board"
        subtitle="Drag tasks across columns to update status."
        actions={
          <div className="flex gap-2">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-48"
              options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            {canWrite && <Button icon={FiPlus} onClick={openAdd} disabled={!projectId}>Add Task</Button>}
          </div>
        }
      />

      {isLoading ? <Loader label="Loading board…" /> : (
        <KanbanBoard tasks={tasks} onMove={(id, status) => moveMut.mutate({ id, status })} onCardClick={setDetail} />
      )}

      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(v) => saveMut.mutate(v)}
        editing={editing}
        saving={saveMut.isPending}
        members={activeProject?.members || []}
        projectName={activeProject?.name}
      />

      {/* Task detail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Task Details" size="lg"
        footer={<>{canWrite && detail && <Button variant="ghost" onClick={() => openEdit(detail)}>Edit</Button>}<Button onClick={() => setDetail(null)}>Close</Button></>}>
        {detail && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={TYPE_TONE[detail.type]}>{detail.type}</Badge>
              <Badge tone={TASK_STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <Badge tone={PRIORITY_TONE[detail.priority]}>{detail.priority}</Badge>
              {detail.type === 'Bug' && <Badge tone="danger">{detail.severity}</Badge>}
            </div>
            <h3 className="text-lg font-semibold">{detail.title}</h3>
            <p className="mt-1 text-sm text-muted">{detail.description || 'No description.'}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Assignee', detail.assignee || '—'], ['Reporter', detail.reporter || '—'], ['Story Points', detail.storyPoints || '—'], ['Due', formatDate(detail.dueDate)]].map(([l, v]) => (
                <div key={l}><p className="text-xs text-muted">{l}</p><p className="text-sm font-medium">{v}</p></div>
              ))}
            </div>
            <div className="mt-4"><ProgressBar value={detail.progress} showLabel /></div>
            <div className="mt-6 border-t border-app pt-4">
              <h4 className="mb-3 text-sm font-semibold">Comments</h4>
              <CommentsPanel projectId={detail.project} taskId={detail.id} taskTitle={detail.title} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
