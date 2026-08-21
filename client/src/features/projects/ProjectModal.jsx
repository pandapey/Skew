import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Modal, Button } from '@/components/ui'
import { projectSchema } from './schemas'
import { ProjectFormFields, PROJECT_COLORS, PROJECT_FORM_DEFAULTS } from './ProjectFormFields'

export function ProjectModal({ open, onClose, onSubmit, editing, saving }) {
  const form = useForm({ resolver: zodResolver(projectSchema), defaultValues: PROJECT_FORM_DEFAULTS })
  const [memberNames, setMemberNames] = useState([])
  const [memberError, setMemberError] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])

  useEffect(() => {
    if (!open) return
    setMemberError('')
    form.reset(editing ? { ...PROJECT_FORM_DEFAULTS, ...editing } : { ...PROJECT_FORM_DEFAULTS })
    setMemberNames(editing ? (editing?.members || []).map((m) => m.name).filter(Boolean) : [])
    setColor(editing?.color || PROJECT_COLORS[0])
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit((values) => {
    if (memberNames.length === 0) {
      setMemberError('Select at least one member')
      return
    }
    setMemberError('')
    const lead = values.lead || memberNames[0] || ''
    // Persist the same { name, role } member shape the backend already expects.
    const members = memberNames.map((n) => ({ name: n, role: n === lead ? 'Lead' : 'Member' }))
    onSubmit({ ...values, lead, members, color })
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Project' : 'Project'}
      size="xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={submit}>Save</Button></>}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ProjectFormFields
          form={form}
          editing={editing}
          enabled={open}
          memberNames={memberNames}
          setMemberNames={setMemberNames}
          memberError={memberError}
          setMemberError={setMemberError}
          color={color}
          setColor={setColor}
        />
      </form>
    </Modal>
  )
}
