import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiArrowLeft } from 'react-icons/fi'
import { PageHeader, Card, Button, Loader, EmptyState } from '@/components/ui'
import { EntityFormFields } from '@/features/hr/EntityFormFields'
import {
  clientSchema, CLIENT_FORM_FIELDS, CLIENT_FORM_DEFAULTS, buildClientsApi,
  CLIENT_WRITE_ROLES,
} from '@/features/client/clientForm'
import { clientService } from '@/features/client/clientService'
import { useAuth } from '@/hooks/useAuth'

export default function ClientForm() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(CLIENT_WRITE_ROLES)
  const [searchParams] = useSearchParams()
  const { id } = useParams()
  const isEdit = Boolean(id)

  const returnTo = isEdit ? '' : (searchParams.get('returnTo') || '')

  const form = useForm({
    resolver: zodResolver(clientSchema),
    defaultValues: CLIENT_FORM_DEFAULTS,
  })

  const api = useMemo(() => buildClientsApi(), [])

  const { data: existing, isLoading: loadingClient, isError } = useQuery({
    queryKey: ['admin-client', id],
    queryFn: () => clientService.getClient(id),
    enabled: isEdit,
  })

  useEffect(() => {
    if (!existing) return
    form.reset({
      ...CLIENT_FORM_DEFAULTS,
      ...Object.fromEntries(
        Object.keys(CLIENT_FORM_DEFAULTS)
          .filter((k) => k !== 'password' && k !== 'confirmPassword')
          .map((k) => [k, existing[k] ?? CLIENT_FORM_DEFAULTS[k]])
      ),
    })
  }, [existing?.clientId, existing?._id])

  const backToList = () => navigate('/clients')
  const afterSave = () => (isEdit ? navigate(`/clients/${id}`) : backToList())

  const saveMutation = useMutation({
    mutationFn: (values) => (isEdit ? api.update(id, values) : api.create(values)),
    onSuccess: (res, values) => {
      qc.invalidateQueries({ queryKey: ['admin-clients'] })
      if (isEdit) {
        qc.invalidateQueries({ queryKey: ['admin-client', id] })
        toast.success('Client updated')
        afterSave()
        return
      }
      toast.success('Client added')
      if (returnTo === 'projects') {
        const company = (res?.company || values?.company || '').trim()
        navigate(`/projects/new?client=${encodeURIComponent(company)}`)
        return
      }
      backToList()
    },
    onError: (err) => toast.error(err?.response?.data?.message || (isEdit ? 'Could not update client' : 'Could not create client')),
  })

  if (!canWrite) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit Client' : 'New Client'} />
        <Card>
          <p className="text-sm text-muted">
            You do not have permission to {isEdit ? 'edit' : 'create'} clients.
          </p>
        </Card>
      </div>
    )
  }

  if (isEdit && loadingClient) return <Loader label="Loading client…" />
  if (isEdit && (isError || !existing)) {
    return (
      <div>
        <PageHeader title="Edit Client" actions={<Button variant="ghost" icon={FiArrowLeft} onClick={backToList}>Back to clients</Button>} />
        <Card>
          <EmptyState title="No such client" description="This client may have been deleted." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Edit ${existing?.company || 'Client'}` : 'Add Client'}
        subtitle={isEdit
          ? 'Update this client account. Changes are saved to this client — a new client is never created.'
          : 'Company details and an optional portal login. Projects — and their commercial terms — are created separately from Projects → New Project.'}
        actions={(
          <Button variant="ghost" icon={FiArrowLeft} onClick={isEdit ? afterSave : backToList}>
            {isEdit ? 'Back to client' : 'Back to clients'}
          </Button>
        )}
      />

      <Card>
        <form
          onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <EntityFormFields
            form={form}
            fields={CLIENT_FORM_FIELDS}
            editing={isEdit ? existing : null}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-app pt-4 sm:col-span-2">
            <Button type="submit" loading={saveMutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Client'}
            </Button>
            <Button type="button" variant="ghost" onClick={isEdit ? afterSave : backToList}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
