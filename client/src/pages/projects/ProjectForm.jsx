import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiArrowLeft } from 'react-icons/fi'
import { PageHeader, Card, Button } from '@/components/ui'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { projectSchema } from '@/features/projects/schemas'
import { PROJECT_WRITE_ROLES, PROJECT_DRAFT_KEY } from '@/features/projects/constants'
import {
  ProjectFormFields, PROJECT_COLORS, PROJECT_FORM_DEFAULTS,
} from '@/features/projects/ProjectFormFields'

export default function ProjectForm() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(PROJECT_WRITE_ROLES)
  const [searchParams] = useSearchParams()
  const presetClient = searchParams.get('client') || ''
  const form = useForm({ resolver: zodResolver(projectSchema), defaultValues: PROJECT_FORM_DEFAULTS })
  const [memberNames, setMemberNames] = useState([])
  const [memberError, setMemberError] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[0])
  const [clientMode, setClientMode] = useState('existing')

  useEffect(() => {
    const raw = sessionStorage.getItem(PROJECT_DRAFT_KEY)
    if (!raw) {
      if (presetClient) form.setValue('client', presetClient)
      return
    }
    try {
      sessionStorage.removeItem(PROJECT_DRAFT_KEY)
      const { memberNames: mn, color: col, ...vals } = JSON.parse(raw)
      form.reset({ ...PROJECT_FORM_DEFAULTS, ...vals, ...(presetClient ? { client: presetClient } : {}) })
      if (Array.isArray(mn)) setMemberNames(mn)
      if (col) setColor(col)
      setClientMode('existing')
    } catch (_) { /* ignore a corrupt draft */ }
  }, [])

  const backToList = () => navigate('/projects')

  const goToCreateClient = () => {
    sessionStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({
      ...form.getValues(), memberNames, color,
    }))
    navigate('/clients/new?returnTo=projects')
  }

  const createMutation = useMutation({
    mutationFn: (values) => projectApi.create(values),
    onSuccess: (row) => {
      toast.success('Project created')
      qc.invalidateQueries({ queryKey: ['projects-all'] })
      qc.invalidateQueries({ queryKey: ['project-stats'] })
      qc.invalidateQueries({ queryKey: ['admin-clients'] })
      if (row?.id) navigate(`/projects/${row.code || row.id}`)
      else backToList()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not create project'),
  })

  const submit = form.handleSubmit((values) => {
    if (memberNames.length === 0) {
      setMemberError('Select at least one member')
      return
    }
    setMemberError('')
    const lead = values.lead || memberNames[0] || ''
    const members = memberNames.map((n) => ({ name: n, role: n === lead ? 'Lead' : 'Member' }))
    createMutation.mutate({ ...values, lead, members, color })
  })

  if (!canWrite) {
    return (
      <div>
        <PageHeader title="New Project" />
        <Card><p className="text-sm text-muted">You do not have permission to create projects.</p></Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="New Project"
        subtitle="Project name, client and members are required."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={backToList}>Back to projects</Button>}
      />

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ProjectFormFields
            form={form}
            editing={null}
            memberNames={memberNames}
            setMemberNames={setMemberNames}
            memberError={memberError}
            setMemberError={setMemberError}
            color={color}
            setColor={setColor}
            clientMode={clientMode}
            setClientMode={setClientMode}
            onCreateClient={goToCreateClient}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-app pt-4 sm:col-span-2">
            <Button type="submit" loading={createMutation.isPending}>Create Project</Button>
            <Button type="button" variant="ghost" onClick={backToList}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
