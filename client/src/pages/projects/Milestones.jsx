import { useState, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import toast from 'react-hot-toast'
import { FiPlus, FiFlag, FiEdit2, FiTrash2, FiCheckCircle, FiClock, FiAlertTriangle } from 'react-icons/fi'
import dayjs from 'dayjs'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import {
  PageHeader, Card, Select, Badge, Button, Loader, Modal, Input, Textarea,
  StatCard, ConfirmDialog,
} from '@/components/ui'
import { ProgressBar } from '@/features/projects/ProgressBar'
import { milestoneSchema } from '@/features/projects/schemas'
import { PROJECT_WRITE_ROLES, MILESTONE_STATUSES, MILESTONE_TONE } from '@/features/projects/constants'
import { formatDate } from '@/utils'

const DEFAULTS = { title: '', description: '', dueDate: '', status: 'Upcoming', progress: 0 }

export default function Milestones() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)

  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Fetch milestones per project (mock API is project-scoped), then merge.
  const results = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['project-milestones', p.id],
      queryFn: () => projectApi.milestones({ project: p.id }),
      enabled: projects.length > 0,
    })),
  })
  const loading = results.some((r) => r.isLoading)
  const projName = (id) => projects.find((p) => p.id === id)?.name || '—'

  const all = useMemo(() => results.flatMap((r) => r.data || []), [results])
  const milestones = all
    .filter((m) => (!projectFilter || m.project === projectFilter) && (!statusFilter || m.status === statusFilter))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [formProject, setFormProject] = useState('')

  const form = useForm({ resolver: zodResolver(milestoneSchema), defaultValues: DEFAULTS })

  const invalidate = (pid) => {
    qc.invalidateQueries({ queryKey: ['project-milestones', pid] })
    qc.invalidateQueries({ queryKey: ['project-stats'] })
  }
  const saveMut = useMutation({
    mutationFn: (values) => (editing ? projectApi.updateMilestone(editing.id, values) : projectApi.createMilestone({ ...values, project: formProject })),
    onSuccess: () => { toast.success(editing ? 'Milestone updated' : 'Milestone created'); setModalOpen(false); invalidate(editing ? editing.project : formProject) },
    onError: () => toast.error('Could not save milestone'),
  })
  const deleteMut = useMutation({
    mutationFn: (m) => projectApi.removeMilestone(m.id),
    onSuccess: (_r, m) => { toast.success('Milestone deleted'); setConfirm(null); invalidate(m.project) },
  })

  const openAdd = () => { setEditing(null); setFormProject(projectFilter || projects[0]?.id || ''); form.reset(DEFAULTS); setModalOpen(true) }
  const openEdit = (m) => { setEditing(m); setFormProject(m.project); form.reset({ ...DEFAULTS, ...m }); setModalOpen(true) }

  const reached = all.filter((m) => m.status === 'Reached').length
  const overdue = all.filter((m) => m.status !== 'Reached' && m.dueDate && dayjs(m.dueDate).isBefore(dayjs(), 'day')).length
  const upcoming = all.filter((m) => m.status === 'Upcoming' || m.status === 'In Progress').length

  return (
    <div>
      <PageHeader
        title="Milestones"
        subtitle="Track key delivery targets and progress across all projects."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-44" options={[{ value: '', label: 'All Projects' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40" options={[{ value: '', label: 'All Status' }, ...MILESTONE_STATUSES.map((s) => ({ value: s, label: s }))]} />
            {canWrite && <Button icon={FiPlus} onClick={openAdd} disabled={!projects.length}>New Milestone</Button>}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={all.length} icon={FiFlag} />
        <StatCard label="Reached" value={reached} icon={FiCheckCircle} tone="success" />
        <StatCard label="Upcoming" value={upcoming} icon={FiClock} tone="primary" />
        <StatCard label="Overdue" value={overdue} icon={FiAlertTriangle} tone="danger" />
      </div>

      {loading ? <Loader label="Loading milestones…" /> : milestones.length === 0 ? (
        <Card><p className="py-10 text-center text-sm text-muted">No milestones found</p></Card>
      ) : (
        <div className="relative space-y-4 before:absolute before:left-[19px] before:top-2 before:h-full before:w-px before:bg-app">
          {milestones.map((m) => {
            const isOverdue = m.status !== 'Reached' && m.dueDate && dayjs(m.dueDate).isBefore(dayjs(), 'day')
            return (
              <div key={m.id} className="relative flex gap-4">
                <span className={`z-10 mt-1 flex h-10 w-10 flex-none items-center justify-center rounded-full ${m.status === 'Reached' ? 'bg-success/10 text-success' : isOverdue ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary'}`}>
                  <FiFlag className="h-5 w-5" />
                </span>
                <Card className="flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{m.title}</p>
                      <p className="text-xs text-muted">{projName(m.project)} · due {formatDate(m.dueDate, 'DD MMM YYYY')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={isOverdue ? 'danger' : MILESTONE_TONE[m.status]}>{isOverdue ? 'Overdue' : m.status}</Badge>
                      {canWrite && (
                        <>
                          <button onClick={() => openEdit(m)} className="rounded p-1.5 text-muted hover:text-primary"><FiEdit2 className="h-4 w-4" /></button>
                          <button onClick={() => setConfirm(m)} className="rounded p-1.5 text-muted hover:text-danger"><FiTrash2 className="h-4 w-4" /></button>
                        </>
                      )}
                    </div>
                  </div>
                  {m.description && <p className="mt-2 text-sm text-muted">{m.description}</p>}
                  <div className="mt-3"><ProgressBar value={m.progress} showLabel /></div>
                </Card>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Milestone' : 'New Milestone'}
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button loading={saveMut.isPending} onClick={form.handleSubmit((v) => saveMut.mutate(v))}>{editing ? 'Save' : 'Create'}</Button></>}
      >
        <form onSubmit={form.handleSubmit((v) => saveMut.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Select label="Project" value={formProject} onChange={(e) => setFormProject(e.target.value)} disabled={!!editing} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          </div>
          <div className="sm:col-span-2"><Input label="Title" error={form.formState.errors.title?.message} {...form.register('title')} /></div>
          <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...form.register('description')} /></div>
          <Input label="Due Date" type="date" {...form.register('dueDate')} />
          <Select label="Status" options={MILESTONE_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} />
          <div className="sm:col-span-2"><Input label="Progress (%)" type="number" min={0} max={100} {...form.register('progress')} /></div>
        </form>
      </Modal>

      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => deleteMut.mutate(confirm)} title="Delete milestone?" message={`Delete "${confirm?.title}"?`} confirmLabel="Delete" loading={deleteMut.isPending} />
    </div>
  )
}
