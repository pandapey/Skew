import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'
import { FiPlus, FiZap, FiInbox, FiEdit2, FiTrash2 } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import {
  PageHeader, Card, Select, Badge, Avatar, Button, Loader, Modal,
  Input, Textarea, StatCard, ConfirmDialog,
} from '@/components/ui'
import { ProgressBar } from '@/features/projects/ProgressBar'
import { sprintSchema } from '@/features/projects/schemas'
import {
  PROJECT_WRITE_ROLES, SPRINT_STATUSES, PRIORITY_TONE, TYPE_TONE, TASK_STATUS_TONE,
} from '@/features/projects/constants'
import { formatDate } from '@/utils'

// A draggable task chip within backlog/sprint columns.
function TaskChip({ task, onDragStart, dragging }) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(task.id)}
      className={`cursor-grab rounded-xl border border-app bg-[var(--bg)] p-3 active:cursor-grabbing ${dragging ? 'opacity-50' : ''}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Badge tone={TYPE_TONE[task.type]}>{task.type}</Badge>
        <Badge tone={PRIORITY_TONE[task.priority]}>{task.priority}</Badge>
      </div>
      <p className="text-sm font-medium">{task.title}</p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5"><Avatar name={task.assignee} size={20} /><span className="text-xs text-muted">{task.storyPoints} pts</span></div>
        <Badge tone={TASK_STATUS_TONE[task.status]}>{task.status}</Badge>
      </div>
    </div>
  )
}

const DEFAULTS = { name: '', goal: '', startDate: '', endDate: '', status: 'Planned' }

export default function Sprints() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)

  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })
  const [projectId, setProjectId] = useState('')
  useEffect(() => { if (!projectId && projects.length) setProjectId(projects[0].id) }, [projects, projectId])

  const tasksKey = ['project-tasks', projectId]
  const sprintsKey = ['project-sprints', projectId]
  const { data: tasks = [], isLoading } = useQuery({ queryKey: tasksKey, queryFn: () => projectApi.tasks({ project: projectId }), enabled: !!projectId })
  const { data: sprints = [] } = useQuery({ queryKey: sprintsKey, queryFn: () => projectApi.sprints({ project: projectId }), enabled: !!projectId })

  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const form = useForm({ resolver: zodResolver(sprintSchema), defaultValues: DEFAULTS })

  const assignMut = useMutation({
    mutationFn: ({ id, sprint }) => projectApi.assignSprint(id, sprint),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
    onError: () => toast.error('Could not move task'),
  })
  const saveMut = useMutation({
    mutationFn: (values) => (editing ? projectApi.updateSprint(editing.id, values) : projectApi.createSprint({ ...values, project: projectId })),
    onSuccess: () => { toast.success(editing ? 'Sprint updated' : 'Sprint created'); setModalOpen(false); qc.invalidateQueries({ queryKey: sprintsKey }) },
    onError: () => toast.error('Could not save sprint'),
  })
  const deleteMut = useMutation({
    mutationFn: (id) => projectApi.removeSprint(id),
    onSuccess: () => { toast.success('Sprint deleted'); setConfirm(null); qc.invalidateQueries({ queryKey: sprintsKey }) },
  })

  const openAdd = () => { setEditing(null); form.reset(DEFAULTS); setModalOpen(true) }
  const openEdit = (s) => { setEditing(s); form.reset({ ...DEFAULTS, ...s }); setModalOpen(true) }

  const handleDrop = (target) => {
    if (dragId) {
      const task = tasks.find((t) => t.id === dragId)
      const nextSprint = target === 'backlog' ? '' : target
      if (task && (task.sprint || '') !== nextSprint) assignMut.mutate({ id: dragId, sprint: nextSprint })
    }
    setDragId(null); setOverCol(null)
  }

  const backlog = tasks.filter((t) => !t.sprint)
  const totalPts = tasks.reduce((s, t) => s + (t.storyPoints || 0), 0)
  const activeSprints = sprints.filter((s) => s.status === 'Active').length

  const dropProps = (col) => ({
    onDragOver: (e) => { e.preventDefault(); setOverCol(col) },
    onDragLeave: () => setOverCol((c) => (c === col ? null : c)),
    onDrop: () => handleDrop(col),
  })

  return (
    <div>
      <PageHeader
        title="Sprint Planning"
        subtitle="Plan sprints and drag tasks from the backlog to schedule work."
        actions={
          <div className="flex gap-2">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-48" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
            {canWrite && <Button icon={FiPlus} onClick={openAdd} disabled={!projectId}>New Sprint</Button>}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sprints" value={sprints.length} icon={FiZap} />
        <StatCard label="Active" value={activeSprints} icon={FiZap} tone="primary" />
        <StatCard label="Backlog Items" value={backlog.length} icon={FiInbox} tone="warning" />
        <StatCard label="Total Points" value={totalPts} icon={FiZap} tone="accent" />
      </div>

      {isLoading ? <Loader label="Loading sprints…" /> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {/* Backlog column */}
          <div {...dropProps('backlog')} className={`rounded-card border border-app border-t-4 border-t-slate-400 surface p-3 transition-colors ${overCol === 'backlog' ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}>
            <div className="mb-3 flex items-center justify-between px-1">
              <h4 className="flex items-center gap-2 text-sm font-semibold"><FiInbox className="text-muted" />Backlog</h4>
              <Badge tone="default">{backlog.length}</Badge>
            </div>
            <div className="min-h-[80px] space-y-2">
              {backlog.map((t) => <TaskChip key={t.id} task={t} dragging={dragId === t.id} onDragStart={setDragId} />)}
              {backlog.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">Backlog empty</p>}
            </div>
          </div>

          {/* Sprint columns */}
          {sprints.map((s) => {
            const items = tasks.filter((t) => t.sprint === s.id)
            const pts = items.reduce((sum, t) => sum + (t.storyPoints || 0), 0)
            const done = items.filter((t) => t.status === 'Done').length
            return (
              <div key={s.id} {...dropProps(s.id)} className={`rounded-card border border-app border-t-4 border-t-primary surface p-3 transition-colors ${overCol === s.id ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}>
                <div className="mb-1 flex items-start justify-between px-1">
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-semibold"><FiZap className="text-primary" />{s.name}</h4>
                    <p className="text-xs text-muted">{formatDate(s.startDate, 'DD MMM')} – {formatDate(s.endDate, 'DD MMM')}</p>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => openEdit(s)} className="rounded p-1 text-muted hover:text-primary"><FiEdit2 className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setConfirm(s)} className="rounded p-1 text-muted hover:text-danger"><FiTrash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
                <div className="mb-2 flex items-center justify-between px-1">
                  <Badge tone={s.status === 'Active' ? 'primary' : s.status === 'Completed' ? 'success' : 'default'}>{s.status}</Badge>
                  <span className="text-xs text-muted">{items.length} · {pts} pts</span>
                </div>
                <div className="mb-3 px-1"><ProgressBar value={items.length ? (done / items.length) * 100 : 0} height="h-1.5" /></div>
                <div className="min-h-[80px] space-y-2">
                  {items.map((t) => <TaskChip key={t.id} task={t} dragging={dragId === t.id} onDragStart={setDragId} />)}
                  {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted">Drop tasks here</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sprint modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Sprint' : 'New Sprint'}
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button loading={saveMut.isPending} onClick={form.handleSubmit((v) => saveMut.mutate(v))}>{editing ? 'Save' : 'Create'}</Button></>}
      >
        <form onSubmit={form.handleSubmit((v) => saveMut.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Sprint Name" error={form.formState.errors.name?.message} {...form.register('name')} /></div>
          <div className="sm:col-span-2"><Textarea label="Goal" rows={2} {...form.register('goal')} /></div>
          <Input label="Start Date" type="date" {...form.register('startDate')} />
          <Input label="End Date" type="date" {...form.register('endDate')} />
          <div className="sm:col-span-2"><Select label="Status" options={SPRINT_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} /></div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => deleteMut.mutate(confirm.id)} title="Delete sprint?" message={`Delete "${confirm?.name}"? Its tasks return to the backlog.`} confirmLabel="Delete" loading={deleteMut.isPending} />
    </div>
  )
}
