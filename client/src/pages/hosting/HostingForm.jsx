import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiServer, FiRefreshCw } from 'react-icons/fi'
import { PageHeader, Card, Button, Input, Select, Loader, EmptyState } from '@/components/ui'
import { hostingApi, domainApi } from '@/features/infrastructure/infrastructureService'
import { adminApi } from '@/api/adminApi'
import { formatMoney, countdownFor, daysUntil, WINDOW_DAYS } from '@/utils/renewal'
import { formatDate } from '@/utils'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

const schema = z.object({
  client: z.string().min(1, 'Choose the client this plan belongs to'),
  domain: z.string().optional(),
  provider: z.string().optional(),
  planName: z.string().optional(),
  startsOn: z.string().optional(),
  expiresOn: z.string().min(1, 'Expiry date is required'),
  renewalCost: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.startsOn && val.expiresOn) {
    const s = new Date(val.startsOn)
    const e = new Date(val.expiresOn)
    if (!isNaN(s) && !isNaN(e) && s > e) ctx.addIssue({ path: ['startsOn'], code: z.ZodIssueCode.custom, message: 'Start date cannot be after the expiry date' })
  }
  if (val.renewalCost && String(val.renewalCost).trim() !== '') {
    const n = Number(val.renewalCost)
    if (!Number.isFinite(n) || n < 0) ctx.addIssue({ path: ['renewalCost'], code: z.ZodIssueCode.custom, message: 'Enter a renewal cost of zero or more' })
  }
})

export default function HostingForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole([ROLES.ADMIN, ROLES.MANAGER])
  const [renewLoading, setRenewLoading] = useState(false)

  const { data: existing, isLoading, isError } = useQuery({
    queryKey: ['hosting', id],
    queryFn: () => hostingApi.get(id),
    enabled: isEdit,
  })

  const { data: clientList = [] } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => adminApi.clients.all(),
    staleTime: 60_000,
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })

  const clientOptions = useMemo(() => {
    const list = Array.isArray(clientList) ? clientList : []
    return [{ value: '', label: 'Select a client' }, ...list.map((c) => ({ value: String(c._id || c.clientId || c.id), label: c.company || String(c._id) }))]
  }, [clientList])

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      client: '',
      domain: '',
      provider: '',
      planName: '',
      startsOn: new Date().toISOString().slice(0, 10),
      expiresOn: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      renewalCost: '0.00',
    },
  })

  const selectedClient = form.watch('client')

  const { data: domainLookup = [], isFetching: domainsFetching } = useQuery({
    queryKey: ['domains-lookup', selectedClient],
    queryFn: () => domainApi.lookup(selectedClient),
    enabled: Boolean(selectedClient),
    staleTime: 30_000,
  })

  const domainOptions = useMemo(() => {
    const base = [{ value: '', label: 'No domain linked' }]
    const rows = Array.isArray(domainLookup) ? domainLookup : domainLookup?.data || []
    const list = Array.isArray(rows) ? rows : []
    return [...base, ...list.map((d) => ({ value: String(d.value || d._id || d.id), label: d.label || d.domainName || String(d.value) }))]
  }, [domainLookup])

  useEffect(() => {
    if (!existing) return
    form.reset({
      client: String(existing.client || ''),
      domain: existing.domain ? String(existing.domain) : '',
      provider: existing.provider || '',
      planName: existing.planName || '',
      startsOn: existing.startsOn ? new Date(existing.startsOn).toISOString().slice(0, 10) : '',
      expiresOn: existing.expiresOn ? new Date(existing.expiresOn).toISOString().slice(0, 10) : '',
      renewalCost: existing.renewalCost != null ? String(Number(existing.renewalCost).toFixed(2)) : '0.00',
    })
  }, [existing?._id, existing?.id])

  // for new: respect ?clientId
  useEffect(() => {
    if (isEdit) return
    const sp = new URLSearchParams(window.location.search)
    const cid = sp.get('clientId')
    if (cid) form.setValue('client', cid)
  }, [isEdit])

  // when client changes for new, reset domain if not in list
  useEffect(() => {
    if (isEdit) return
    // clear domain when client changes unless domain belongs to new client (will be re-validated on submit)
    // We keep current domain value but if it's not in options we keep "" — user must re-select
    // To avoid stale domain across clients, clear when client changes and current domain not empty
    // Actually we let user see empty options until they re-select; simplest: set domain to '' on client change for new
    // But avoid clearing on initial load; use a ref
  }, [])

  const handleClientChange = (e) => {
    const v = e.target.value
    form.setValue('client', v, { shouldValidate: true })
    form.setValue('domain', '', { shouldValidate: false })
  }

  const saveMutation = useMutation({
    mutationFn: (values) => {
      const payload = {
        client: values.client,
        domain: values.domain || null,
        provider: String(values.provider || '').trim(),
        planName: String(values.planName || '').trim(),
        startsOn: values.startsOn || null,
        expiresOn: values.expiresOn,
        renewalCost: values.renewalCost ? Number(values.renewalCost) : 0,
      }
      return isEdit ? hostingApi.update(id, payload) : hostingApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosting'] })
      qc.invalidateQueries({ queryKey: ['hosting-summary'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['hosting', id] })
      toast.success(isEdit ? 'Hosting updated' : 'Hosting added')
      navigate('/hosting?saved=1')
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save hosting plan'),
  })

  const renewMutation = useMutation({
    mutationFn: () => hostingApi.renew(id, 12),
    onMutate: () => setRenewLoading(true),
    onSuccess: (res) => {
      toast.success(`Hosting renewed until ${formatDate(res?.expiresOn)}`)
      qc.invalidateQueries({ queryKey: ['hosting', id] })
      qc.invalidateQueries({ queryKey: ['hosting'] })
      qc.invalidateQueries({ queryKey: ['hosting-summary'] })
      if (res?.expiresOn) form.setValue('expiresOn', new Date(res.expiresOn).toISOString().slice(0, 10))
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not renew'),
    onSettled: () => setRenewLoading(false),
  })

  if (!canWrite) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit Hosting' : 'New Hosting'} />
        <Card><p className="text-sm text-muted">You do not have permission to {isEdit ? 'edit' : 'create'} hosting plans.</p></Card>
      </div>
    )
  }

  if (isEdit && isLoading) return <Loader label="Loading hosting plan…" />
  if (isEdit && (isError || !existing)) {
    return (
      <div>
        <PageHeader title="Edit Hosting" actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/hosting')}>Back to hosting</Button>} />
        <Card><EmptyState title="No such hosting plan" description="This plan may have been deleted." /></Card>
      </div>
    )
  }

  const days = isEdit && existing ? daysUntil(existing.expiresOn) : null
  const showHint = isEdit && days != null && days <= WINDOW_DAYS
  const hintText = isEdit && days != null ? (days < 0 ? `This plan expired ${countdownFor(existing.expiresOn)}. Renew it to keep the site online.` : `This plan expires ${countdownFor(existing.expiresOn)}.`) : ''
  const heading = isEdit ? (existing?.planName || existing?.provider || 'Hosting plan') : 'Add hosting plan'
  const audit = isEdit && existing ? `Renewal cost ${formatMoney(existing.renewalCost)} · ${existing.domainName ? existing.domainName : 'No domain linked'}` : 'Not saved yet'

  return (
    <div>
      <PageHeader
        title={heading}
        subtitle="Provider, linked domain and the renewal date you bill against."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/hosting')}>Back to hosting</Button>}
        icon={FiServer}
      />

      {showHint && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning">
          <FiServer className="mt-0.5 h-4 w-4 flex-none" />
          <span>{hintText}</span>
        </div>
      )}

      <Card>
        <h3 className="mb-4 text-base font-semibold">Hosting details</h3>
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-6">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-muted">Assignment</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Client *" value={form.watch('client')} onChange={handleClientChange} options={clientOptions} error={form.formState.errors.client?.message} searchable />
              <Select label="Linked domain" value={form.watch('domain')} onChange={(e) => form.setValue('domain', e.target.value)} options={domainOptions} searchable loading={domainsFetching} />
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-muted">Plan</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Provider" placeholder="Hostinger, AWS, DigitalOcean..." {...form.register('provider')} />
              <Input label="Plan name" placeholder="Business shared, 4 GB VPS..." {...form.register('planName')} />
              <Input label="Starts on" type="date" {...form.register('startsOn')} error={form.formState.errors.startsOn?.message} />
              <Input label="Expires on *" type="date" {...form.register('expiresOn')} error={form.formState.errors.expiresOn?.message} />
              <Input label="Renewal cost" placeholder="0.00" {...form.register('renewalCost')} error={form.formState.errors.renewalCost?.message} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-app pt-4">
            <Button type="submit" loading={saveMutation.isPending}>{isEdit ? 'Save hosting plan' : 'Save hosting plan'}</Button>
            {isEdit && (
              <Button type="button" variant="ghost" icon={FiRefreshCw} loading={renewLoading} onClick={() => renewMutation.mutate()}>
                Renew 12 months
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => navigate('/hosting')}>Cancel</Button>
            <span className="ml-auto text-xs text-muted">{audit}</span>
          </div>
        </form>
      </Card>
    </div>
  )
}
