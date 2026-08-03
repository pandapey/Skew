import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Modal, Input, Select, Textarea, Button } from '@/components/ui'
import { taskSchema } from './schemas'
import { TASK_STATUSES, TASK_TYPES, PRIORITIES, SEVERITIES, STORY_POINTS } from './constants'

const DEFAULTS = {
  title: '', description: '', type: 'Task', status: 'Todo', priority: 'Medium',
  severity: 'Major', assignee: '', storyPoints: 3, dueDate: '',
}

// Create / edit a task or bug. `members` seeds the assignee list; `sprints`
// (optional) lets the caller place the task into a sprint.
//
// Part 6: when a PROJECT LEAD (rather than Admin/Manager/HR) opens this form,
// the caller passes `restrictedToMembers` + `requireAssignee`. The assignee
// list is then exactly the project's own people — there is no "Unassigned"
// option and nobody outside the project can be chosen. The server enforces the
// same allow-list, so this is a usability guard rather than the security one.
export function TaskModal({
  open, onClose, onSubmit, editing, saving, members = [], sprints, projectName,
  requireAssignee = false, restrictedToMembers = false,
}) {
  const form = useForm({ resolver: zodResolver(taskSchema), defaultValues: DEFAULTS })

  useEffect(() => {
    if (open) form.reset(editing ? { ...DEFAULTS, ...editing } : DEFAULTS)
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const isBug = form.watch('type') === 'Bug'
  const assignee = form.watch('assignee')
  const memberNames = members.map((m) => m.name)
  const assigneeMissing = requireAssignee && !assignee

  const assigneeOptions = [
    ...(restrictedToMembers ? [] : [{ value: '', label: 'Unassigned' }]),
    ...members.map((m) => ({ value: m.name, label: m.name })),
  ]

  const submit = form.handleSubmit((v) => {
    // Block a submit that the server would reject anyway, with a clear reason.
    if (requireAssignee && !v.assignee) {
      form.setError('assignee', { message: 'Select a team member to assign this task to' })
      return
    }
    if (restrictedToMembers && v.assignee && !memberNames.includes(v.assignee)) {
      form.setError('assignee', { message: 'You can only assign tasks to members of this project' })
      return
    }
    onSubmit(v)
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${editing ? 'Edit' : 'Add'} Task${projectName ? ` · ${projectName}` : ''}`}
      size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} disabled={assigneeMissing} onClick={submit}>{editing ? 'Save' : 'Create'}</Button></>}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Input label="Title" error={form.formState.errors.title?.message} {...form.register('title')} /></div>
        <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...form.register('description')} /></div>
        <Select label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: t }))} {...form.register('type')} />
        <Select label="Status" options={TASK_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} />
        <Select label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: p }))} {...form.register('priority')} />
        {isBug
          ? <Select label="Severity" options={SEVERITIES.map((s) => ({ value: s, label: s }))} {...form.register('severity')} />
          : <Select label="Story Points" options={STORY_POINTS.map((p) => ({ value: p, label: `${p} pts` }))} {...form.register('storyPoints')} />}
        <Select
          label="Assignee"
          error={form.formState.errors.assignee?.message}
          options={assigneeOptions}
          {...form.register('assignee')}
        />
        {sprints && <Select label="Sprint" options={[{ value: '', label: 'Backlog' }, ...sprints.map((s) => ({ value: s.id, label: s.name }))]} {...form.register('sprint')} />}
        <Input label="Due Date" type="date" {...form.register('dueDate')} />
        {isBug && <Select label="Story Points" options={STORY_POINTS.map((p) => ({ value: p, label: `${p} pts` }))} {...form.register('storyPoints')} />}

        {restrictedToMembers && (
          <p className="text-xs text-muted sm:col-span-2">
            As the project lead you can assign this task only to people on this project
            ({memberNames.length} member{memberNames.length === 1 ? '' : 's'}).
          </p>
        )}
      </form>
    </Modal>
  )
}
