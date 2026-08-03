import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiInbox, FiZap } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader, Card, CardHeader, Select, Badge, Avatar, Loader } from '@/components/ui'
import { PROJECT_WRITE_ROLES, PRIORITY_TONE, TYPE_TONE, TASK_STATUS_TONE } from '@/features/projects/constants'
import { formatDate } from '@/utils'

function TaskRow({ task, sprints, canWrite, onAssign }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-app p-3">
      <Badge tone={TYPE_TONE[task.type]}>{task.type}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="text-xs text-muted">{task.storyPoints} pts · due {formatDate(task.dueDate, 'DD MMM')}</p>
      </div>
      <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
      <Badge tone={TASK_STATUS_TONE[task.status]}>{task.status}</Badge>
      <Avatar name={task.assignee} size={26} />
      {canWrite && (
        <Select
          value={task.sprint || ''}
          onChange={(e) => onAssign(task.id, e.target.value)}
          className="w-36"
          options={[{ value: '', label: 'Backlog' }, ...sprints.map((s) => ({ value: s.id, label: s.name }))]}
        />
      )}
    </div>
  )
}

export default function Backlog() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)

  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })
  const [projectId, setProjectId] = useState('')
  useEffect(() => { if (!projectId && projects.length) setProjectId(projects[0].id) }, [projects, projectId])

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['project-tasks', projectId], queryFn: () => projectApi.tasks({ project: projectId }), enabled: !!projectId })
  const { data: sprints = [] } = useQuery({ queryKey: ['project-sprints', projectId], queryFn: () => projectApi.sprints({ project: projectId }), enabled: !!projectId })

  const assignMut = useMutation({
    mutationFn: ({ id, sprint }) => projectApi.assignSprint(id, sprint),
    onSuccess: () => { toast.success('Task moved'); qc.invalidateQueries({ queryKey: ['project-tasks', projectId] }) },
  })
  const onAssign = (id, sprint) => assignMut.mutate({ id, sprint })

  const backlog = tasks.filter((t) => !t.sprint)

  return (
    <div>
      <PageHeader
        title="Backlog & Sprint Planning"
        subtitle="Groom the backlog and assign work to sprints."
        actions={<Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-48" options={projects.map((p) => ({ value: p.id, label: p.name }))} />}
      />

      {isLoading ? <Loader label="Loading backlog…" /> : (
        <div className="space-y-4">
          {/* Sprints */}
          {sprints.map((s) => {
            const items = tasks.filter((t) => t.sprint === s.id)
            const pts = items.reduce((sum, t) => sum + (t.storyPoints || 0), 0)
            return (
              <Card key={s.id}>
                <CardHeader
                  title={<span className="flex items-center gap-2"><FiZap className="text-primary" />{s.name}</span>}
                  subtitle={`${s.goal} · ${formatDate(s.startDate, 'DD MMM')} – ${formatDate(s.endDate, 'DD MMM')}`}
                  action={<div className="flex items-center gap-2"><Badge tone={s.status === 'Active' ? 'primary' : 'default'}>{s.status}</Badge><Badge tone="accent">{items.length} tasks · {pts} pts</Badge></div>}
                />
                <div className="space-y-2">
                  {items.length ? items.map((t) => <TaskRow key={t.id} task={t} sprints={sprints} canWrite={canWrite} onAssign={onAssign} />) : <p className="py-3 text-center text-xs text-muted">No tasks in this sprint</p>}
                </div>
              </Card>
            )
          })}

          {/* Backlog */}
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><FiInbox className="text-muted" />Backlog</span>} subtitle="Unscheduled tasks" action={<Badge tone="default">{backlog.length}</Badge>} />
            <div className="space-y-2">
              {backlog.length ? backlog.map((t) => <TaskRow key={t.id} task={t} sprints={sprints} canWrite={canWrite} onAssign={onAssign} />) : <p className="py-3 text-center text-xs text-muted">Backlog is empty</p>}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
