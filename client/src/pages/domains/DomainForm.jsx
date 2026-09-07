import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiGlobe, FiRefreshCw } from 'react-icons/fi'
import { PageHeader, Card, Button, Input, Select, Loader, EmptyState } from '@/components/ui'
import { domainApi } from '@/features/infrastructure/infrastructureService'
import { adminApi } from '@/api/adminApi'
import { formatMoney, countdownFor, daysUntil, WINDOW_DAYS } from '@/utils/renewal'
import { formatDate } from '@/utils'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

const schema = z.object({
  domainName: z.string().trim().min(1, 'Domain name is required').refine((v) => v.indexOf('.') >= 1 && v.indexOf(' ') === -1, 'Enter a valid domain such as example.com'),
  client: z.string().min(1, 'Choose the client this domain belongs to'),
  registrar: z.string().optional(),
  registeredOn: z.string().optional(),
  expiresOn: z.string().min(1, 'Expiry date is required'),
  renewalCost: z.string().optional(),
  autoRenew: z.boolean().optional(),
}).superRefine((val, ctx) => {
  const reg = val.registeredOn ? new Date(val.registeredOn) : null
  const exp = val.expiresOn ? new Date(val.expiresOn) : null
  if (reg && exp && !isNaN(reg) && !isNaN(exp) && reg > exp) {
    ctx.addIssue({ path: ['registeredOn'], code: z.ZodIssueCode.custom, message: 'Registration date cannot be after the expiry date' })
  }
  if (val.renewalCost && String(val.renewalCost).trim() !== '') {
    const n = Number(val.renewalCost)
    if (!Number.isFinite(n) || n < 0) ctx.addIssue({ path: ['renewalCost'], code: z.ZodIssueCode.custom, message: 'Enter a renewal cost of zero or more' })
  }
})

export default function DomainForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole([ROLES.ADMIN, ROLES.MANAGER])

  const { data: existing, isLoading, isError } = useQuery({
    queryKey: ['domain', id],
    queryFn: () => domainApi.get(id),
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
      domainName: '',
      client: '',
      registrar: '',
      registeredOn: '',
      expiresOn: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      renewalCost: '0.00',
      autoRenew: false,
    },
  })

  const [renewLoading, setRenewLoading] = useState(false)

  useEffect(() => {
    if (!existing) return
    form.reset({
      domainName: existing.domainName || '',
      client: String(existing.client || ''),
      registrar: existing.registrar || '',
      registeredOn: existing.registeredOn ? new Date(existing.registeredOn).toISOString().slice(0, 10) : '',
      expiresOn: existing.expiresOn ? new Date(existing.expiresOn).toISOString().slice(0, 10) : '',
      renewalCost: existing.renewalCost != null ? String(Number(existing.renewalCost).toFixed(2)) : '0.00',
      autoRenew: Boolean(existing.autoRenew),
    })
  }, [existing?._id, existing?.id])

  // for new: prefill from ?clientId=
  useEffect(() => {
    if (isEdit) return
    const sp = new URLSearchParams(window.location.search)
    const cid = sp.get('clientId')
    if (cid) form.setValue('client', cid)
  }, [isEdit])

  const saveMutation = useMutation({
    mutationFn: (values) => {
      const payload = {
        domainName: String(values.domainName).trim(),
        client: values.client,
        registrar: String(values.registrar || '').trim(),
        registeredOn: values.registeredOn || null,
        expiresOn: values.expiresOn,
        renewalCost: values.renewalCost ? Number(values.renewalCost) : 0,
        autoRenew: Boolean(values.autoRenew),
      }
      return isEdit ? domainApi.update(id, payload) : domainApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['domains'] })
      qc.invalidateQueries({ queryKey: ['domains-summary'] })
      if (isEdit) qc.invalidateQueries({ queryKey: ['domain', id] })
      toast.success(isEdit ? 'Domain updated' : 'Domain added')
      navigate('/domains?saved=1')
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save domain'),
  })

  const renewMutation = useMutation({
    mutationFn: () => domainApi.renew(id, 12),
    onMutate: () => setRenewLoading(true),
    onSuccess: (res) => {
      toast.success(`${res?.domainName || 'Domain'} renewed until ${formatDate(res?.expiresOn)}`)
      qc.invalidateQueries({ queryKey: ['domain', id] })
      qc.invalidateQueries({ queryKey: ['domains'] })
      qc.invalidateQueries({ queryKey: ['domains-summary'] })
      // update form field
      if (res?.expiresOn) form.setValue('expiresOn', new Date(res.expiresOn).toISOString().slice(0, 10))
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not renew'),
    onSettled: () => setRenewLoading(false),
  })

  if (!canWrite) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit Domain' : 'New Domain'} />
        <Card><p className="text-sm text-muted">You do not have permission to {isEdit ? 'edit' : 'create'} domains.</p></Card>
      </div>
    )
  }

  if (isEdit && isLoading) return <Loader label="Loading domain…" />
  if (isEdit && (isError || !existing)) {
    return (
      <div>
        <PageHeader title="Edit Domain" actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/domains')}>Back to domains</Button>} />
        <Card><EmptyState title="No such domain" description="This domain may have been deleted." /></Card>
      </div>
    )
  }

  const days = isEdit && existing ? daysUntil(existing.expiresOn) : null
  const showHint = isEdit && days != null && days <= WINDOW_DAYS
  const hintText = isEdit && days != null ? (days < 0 ? `This domain expired ${countdownFor(existing.expiresOn)}. Renew it to keep the client's website online.` : `This domain expires ${countdownFor(existing.expiresOn)}.`) : ''

  const heading = isEdit ? existing?.domainName || 'Edit domain' : 'Add domain'
  const audit = isEdit && existing ? `Renewal cost ${formatMoney(existing.renewalCost)} · ${existing.hostingCount ?? 0} hosting plan(s) linked` : 'Not saved yet'

  return (
    <div>
      <PageHeader
        title={heading}
        subtitle="Registration details and the renewal date you need to watch."
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/domains')}>Back to domains</Button>}
        icon={FiGlobe}
      />

      {showHint && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
          <FiGlobe className="mt-0.5 h-4 w-4 flex-none" />
          <span>{hintText}</span>
        </div>
      )}

      <Card>
        <h3 className="mb-4 text-base font-semibold">Domain details</h3>
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-6">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-muted">Registration</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input label="Domain name *" placeholder="example.com" {...form.register('domainName')} error={form.formState.errors.domainName?.message} />
              </div>
              <Select label="Client *" value={form.watch('client')} onChange={(e) => form.setValue('client', e.target.value, { shouldValidate: true })} options={clientOptions} error={form.formState.errors.client?.message} searchable />
              <Input label="Registrar" placeholder="GoDaddy, BigRock, Namecheap..." {...form.register('registrar')} />
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-muted">Renewal</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Registered on" type="date" {...form.register('registeredOn')} error={form.formState.errors.registeredOn?.message} />
              <Input label="Expires on *" type="date" {...form.register('expiresOn')} error={form.formState.errors.expiresOn?.message} />
              <Input label="Renewal cost" placeholder="0.00" {...form.register('renewalCost')} error={form.formState.errors.renewalCost?.message} />
              <div className="flex flex-col justify-end pb-1">
                <span className="label">Renewal mode</span>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...form.register('autoRenew')} className="h-4 w-4 rounded border-app text-primary focus:ring-primary/30" />
                  <span>Auto renew with the registrar</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-app pt-4">
            <Button type="submit" loading={saveMutation.isPending}>Save domain</Button>
            {isEdit && (
              <Button type="button" variant="ghost" icon={FiRefreshCw} loading={renewLoading} onClick={() => renewMutation.mutate()}>
                Renew 12 months
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => navigate('/domains')}>Cancel</Button>
            <span className="ml-auto text-xs text-muted">{audit}</span>
          </div>
        </form>
      </Card>
    </div>
  )
}
