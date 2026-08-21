import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FiPaperclip, FiX } from 'react-icons/fi'
import { Modal, Input, Select, Textarea, Button } from '@/components/ui'
import { taskSchema } from './schemas'
import { TASK_STATUSES, TASK_TYPES, PRIORITIES, SEVERITIES, STORY_POINTS } from './constants'

const DEFAULTS = {
  title: '', description: '', type: 'Task', status: 'Todo', priority: 'Medium',
  severity: 'Major', assignee: '', storyPoints: 3, dueDate: '', project: '',
}

export function TaskModal({
  open, onClose, onSubmit, editing, saving, assignees = [], sprints, projectName,
  employeeMode = false, projects = [],
}) {
  const form = useForm({ resolver: zodResolver(taskSchema), defaultValues: DEFAULTS })
  const [pendingFiles, setPendingFiles] = useState([])
  const [tried, setTried] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (open) { form.reset(editing ? { ...DEFAULTS, ...editing } : DEFAULTS); setPendingFiles([]) }
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const isBug = form.watch('type') === 'Bug'

  // PHASE: EMPLOYEE TASK FORM — the two-step "pick a project, then open the
  // task form" flow is merged into ONE form: the project is a field inside the
  // modal itself. Callers that pass `projects` get the inline picker (with a
  // required guard); callers that don't (edit modes) are unchanged.
  const selectedProject = projects.find((p) => p.id === form.watch('project'))
  const projectRequired = projects.length > 0

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
    if (employeeMode) {
      const { dueDate: _ignored, ...rest } = v
      onSubmit({ ...rest, files: pendingFiles })
      return
    }
    onSubmit(v)
  })

  const requestSubmit = () => {
    if (projectRequired && !form.watch('project')) {
      setTried(true)
      return
    }
    submit()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${editing ? 'Edit' : 'Add'} Task${projectName || selectedProject?.name ? ` · ${projectName || selectedProject.name}` : ''}`}
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={(projectRequired && !form.watch('project')) || (employeeMode && projects.length === 0)} onClick={requestSubmit}>{editing ? 'Save' : 'Create'}</Button></>}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {projects.length > 0 ? (
          <div className="sm:col-span-2">
            <Select
              label="Project"
              placeholder="Select a project"
              error={projectRequired && tried && !form.watch('project') ? 'Please select a project' : undefined}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              {...form.register('project')}
            />
          </div>
        ) : (
          <p className="sm:col-span-2 mb-1 text-xs font-medium text-muted">
            You do not have access to any projects yet, so a task cannot be created.
          </p>
        )}
        <div className="sm:col-span-2"><Input label="Title" error={form.formState.errors.title?.message} {...form.register('title')} /></div>
        <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...form.register('description')} /></div>
        {!employeeMode && (
          <>
            <Select label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: t }))} {...form.register('type')} />
            <Select label="Status" options={TASK_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} />
            <Select label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: p }))} {...form.register('priority')} />
            {isBug
              ? <Select label="Severity" options={SEVERITIES.map((s) => ({ value: s, label: s }))} {...form.register('severity')} />
              : <Select label="Story Points" options={STORY_POINTS.map((p) => ({ value: p, label: `${p} pts` }))} {...form.register('storyPoints')} />}
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
        {sprints && <Select label="Sprint" options={[{ value: '', label: 'Backlog' }, ...sprints.map((s) => ({ value: s.id, label: s.name }))]} {...form.register('sprint')} />}
        {!employeeMode && <Input label="Due Date" type="date" {...form.register('dueDate')} />}
        {!employeeMode && isBug && <Select label="Story Points" options={STORY_POINTS.map((p) => ({ value: p, label: `${p} pts` }))} {...form.register('storyPoints')} />}
      </form>
    </Modal>
  )
}