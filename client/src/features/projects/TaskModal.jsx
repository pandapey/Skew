import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FiPaperclip, FiX } from 'react-icons/fi'
import { Modal, Input, Select, Textarea, Button } from '@/components/ui'
import { taskSchema } from './schemas'
import { TASK_STATUSES, TASK_TYPES, PRIORITIES, SEVERITIES } from './constants'

const DEFAULTS = {
  title: '', description: '', type: 'Task', status: 'Todo', priority: 'Medium',
  severity: 'Major', assignee: '', project: '',
}

export function TaskModal({
  open, onClose, onSubmit, editing, saving, assignees = [],
  employeeMode = false, projects = [], defaultProjectId = '', projectName = '',
}) {
  const form = useForm({ resolver: zodResolver(taskSchema), defaultValues: DEFAULTS })
  const [pendingFiles, setPendingFiles] = useState([])
  const fileInputRef = useRef(null)

  // When opened from a specific project (Board / ProjectDetail), lock the
  // task to that project so the form shows the current project instead of
  // falling back to "General Task".
  const lockedProjectId = defaultProjectId ? String(defaultProjectId) : ''
  const lockedProjectName = projectName
    || (projects.find((p) => String(p.id) === lockedProjectId)?.name)
    || ''

  useEffect(() => {
    if (open) {
      const initial = editing
        ? { ...DEFAULTS, ...editing, project: editing.project || lockedProjectId || '' }
        : { ...DEFAULTS, project: lockedProjectId || DEFAULTS.project }
      form.reset(initial); setPendingFiles([])
    }
  }, [open, editing, lockedProjectId])

  const isBug = form.watch('type') === 'Bug'

  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...assignees.map((m) => ({ value: m.name, label: m.name })),
  ]

  const pickFiles = (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setPendingFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const fresh = files.filter((f) => !seen.has(`${f.name}:${f.size}`))
      return [...prev, ...fresh].slice(0, 5)
    })
    e.target.value = ''
  }

  const submit = form.handleSubmit((v) => {
    // Locked project context wins over the dropdown value.
    const effectiveProject = lockedProjectId || (v.project && String(v.project).trim() ? String(v.project).trim() : '')
    const normalized = { ...v, project: effectiveProject || null }
    // Points / sprint / deadline were removed from the creation form.
    delete normalized.storyPoints
    delete normalized.sprint
    delete normalized.dueDate
    if (employeeMode) {
      onSubmit({ ...normalized, files: pendingFiles })
      return
    }
    onSubmit(normalized)
  })

  const requestSubmit = () => {
    submit()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${editing ? 'Edit' : 'Add'} Task`}
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={requestSubmit}>{editing ? 'Save' : 'Create'}</Button></>}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {lockedProjectId ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Project</p>
              <div className="rounded-xl border border-app bg-black/[0.02] px-3 py-2.5 text-sm font-medium dark:bg-white/[0.03]">
                {lockedProjectName || 'Current project'}
              </div>
              <input type="hidden" {...form.register('project')} value={lockedProjectId} />
            </div>
          ) : (
            <Select
              label="Project"
              placeholder="General Task"
              options={[{ value: '', label: 'General Task' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              {...form.register('project')}
            />
          )}
        </div>
        <div className="sm:col-span-2"><Input label="Title" error={form.formState.errors.title?.message} {...form.register('title')} /></div>
        <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...form.register('description')} /></div>
        {!employeeMode && (
          <>
            <Select label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: t }))} {...form.register('type')} />
            <Select label="Status" options={TASK_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} />
            <Select label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: p }))} {...form.register('priority')} />
            {isBug && <Select label="Severity" options={SEVERITIES.map((s) => ({ value: s, label: s }))} {...form.register('severity')} />}
          </>
        )}
        <Select
          label="Assignee"
          error={form.formState.errors.assignee?.message}
          options={assigneeOptions}
          {...form.register('assignee')}
        />
        {employeeMode && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Attachments</p>
            <input ref={fileInputRef} type="file" multiple hidden onChange={pickFiles} />
            <Button type="button" variant="ghost" icon={FiPaperclip} onClick={() => fileInputRef.current?.click()}>
              Add file
            </Button>
            {pendingFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {pendingFiles.map((f, i) => (
                  <div key={`${f.name}:${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-app px-2 py-1 text-xs">
                    <span className="flex min-w-0 items-center gap-1 truncate text-muted">
                      <FiPaperclip className="h-3 w-3 shrink-0" /> {f.name}
                      <span className="text-[10px]">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                      className="shrink-0 text-muted transition hover:text-danger"
                      aria-label={`Remove ${f.name}`}
                    >
                      <FiX className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
