import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiServer, FiPlus, FiRefreshCw, FiEdit2, FiTrash2, FiSearch } from 'react-icons/fi'
import { PageHeader, Card, Button, DataTable, Pagination, Select, Badge, StatCard, ConfirmDialog } from '@/components/ui'
import { useDebounce } from '@/hooks/useDebounce'
import { hostingApi } from '@/features/infrastructure/infrastructureService'
import { adminApi } from '@/api/adminApi'
import { formatMoney, toneFor, labelFor, countdownFor } from '@/utils/renewal'
import { formatDate } from '@/utils'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

const INFRA_WRITE_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export default function Hosting() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const canWrite = hasRole(INFRA_WRITE_ROLES)

  const [params, setParams] = useState({ search: '', status: '', client: '', page: 1, limit: 10 })
  const debounced = useDebounce(params.search, 300)
  const queryParams = { ...params, search: debounced }
  const [deleting, setDeleting] = useState(null)
  const [renewingId, setRenewingId] = useState(null)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['hosting', queryParams],
    queryFn: () => hostingApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  const { data: summary } = useQuery({
    queryKey: ['hosting-summary'],
    queryFn: () => hostingApi.summary(),
  })

  const { data: clientList = [] } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => adminApi.clients.all(),
    staleTime: 60_000,
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const page = data?.page ?? 1
  const totalPages = data?.totalPages ?? 1
  const summaryData = summary || { total: 0, expiringSoon: 0, expired: 0, renewalValue: 0 }

  const clientOptions = useMemo(() => {
    const list = Array.isArray(clientList) ? clientList : []
    return [{ value: '', label: 'All clients' }, ...list.map((c) => ({ value: String(c._id || c.clientId || c.id), label: c.company || String(c._id) }))]
  }, [clientList])

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hosting'] })
    qc.invalidateQueries({ queryKey: ['hosting-summary'] })
  }

  const renewMutation = useMutation({
    mutationFn: (id) => hostingApi.renew(id, 12),
    onMutate: (id) => setRenewingId(id),
    onSuccess: (res) => {
      toast.success(`Hosting renewed until ${formatDate(res?.expiresOn)}`)
      invalidate()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Renew failed'),
    onSettled: () => setRenewingId(null),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => hostingApi.remove(id),
    onSuccess: () => {
      toast.success('Hosting plan deleted')
      setDeleting(null)
      invalidate()
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Delete failed'),
  })

  const columns = [
    {
      key: 'plan',
      header: 'Plan',
      render: (r) => {
        const planLabel = r.planName || (r.provider ? `${r.provider} plan` : 'Hosting plan')
        const providerLabel = r.provider || 'Not recorded'
        return (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><FiServer className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="truncate font-medium">{planLabel}</p>
              <p className="truncate text-xs text-muted">{providerLabel}</p>
            </div>
          </div>
        )
      },
    },
    { key: 'clientName', header: 'Client', render: (r) => r.clientName || '—' },
    { key: 'domainName', header: 'Domain', render: (r) => r.domainName || 'No domain linked' },
    {
      key: 'expires',
      header: 'Expires',
      render: (r) => (
        <div className="min-w-0">
          <p className="font-medium">{formatDate(r.expiresOn)}</p>
          <p className="text-xs text-muted">{countdownFor(r.expiresOn)}</p>
        </div>
      ),
    },
    { key: 'renewalCost', header: 'Renewal', render: (r) => formatMoney(r.renewalCost) },
    {
      key: 'state',
      header: 'State',
      render: (r) => <Badge tone={toneFor(r.expiresOn)}>{labelFor(r.expiresOn)}</Badge>,
    },
    ...(canWrite
      ? [
          {
            key: '_actions',
            header: '',
            className: 'text-right',
            render: (r) => {
              const planLabel = r.planName || (r.provider ? `${r.provider} plan` : 'Hosting plan')
              return (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <button className="rounded-lg p-2 hover:bg-success/10 hover:text-success disabled:opacity-40" onClick={() => renewMutation.mutate(r.id)} disabled={renewingId === r.id} title="Renew for 12 months" aria-label={`Renew ${planLabel}`}>
                    <FiRefreshCw className={renewingId === r.id ? 'animate-spin' : ''} />
                  </button>
                  <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => navigate(`/hosting/${r.id}/edit`)} aria-label={`Edit ${planLabel}`}>
                    <FiEdit2 />
                  </button>
                  <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label={`Delete ${planLabel}`}>
                    <FiTrash2 />
                  </button>
                </div>
              )
            },
          },
        ]
      : []),
  ]

  return (
    <div>
      <PageHeader
        title="Hosting"
        subtitle="Server and hosting plans you renew on behalf of clients."
        actions={canWrite ? <Button icon={FiPlus} onClick={() => navigate('/hosting/new')}>Add hosting plan</Button> : null}
        icon={FiServer}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Plans managed" value={summaryData.total} tone="primary" icon={FiServer} />
        <StatCard label="Expiring in 30 days" value={summaryData.expiringSoon} tone="warning" icon={FiServer} />
        <StatCard label="Already expired" value={summaryData.expired} tone="danger" icon={FiServer} />
      </div>

      <Card>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold">All hosting plans <span className="ml-2 text-sm font-normal text-muted">{total} {total === 1 ? 'plan' : 'plans'}</span></h2>
        </div>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 lg:max-w-xs">
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={params.search} onChange={(e) => setParam({ search: e.target.value })} placeholder="Search provider, plan, domain or client" className="input pl-9" />
          </div>
          <Select className="lg:w-44" value={params.status} onChange={(e) => setParam({ status: e.target.value })} options={[{ value: '', label: 'All states' }, { value: 'expiring', label: 'Expiring in 30 days' }, { value: 'expired', label: 'Expired' }, { value: 'active', label: 'Active' }]} />
          <Select className="lg:w-52" value={params.client} onChange={(e) => setParam({ client: e.target.value })} options={clientOptions} searchable placeholder="All clients" />
          <div className="flex gap-2 lg:ml-auto">
            <Button variant="ghost" onClick={() => setParams({ search: '', status: '', client: '', page: 1, limit: 10 })}>Reset</Button>
          </div>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable columns={columns} data={rows} loading={isLoading} empty="No hosting plans found" onRowClick={(r) => navigate(`/hosting/${r.id}/edit`)} />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Page {page} of {totalPages}</p>
          <Pagination page={page} totalPages={totalPages} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title={`Delete ${deleting?.planName || deleting?.provider || 'hosting plan'}?`}
        message={`Delete the ${deleting?.planName || deleting?.provider || 'hosting'} plan for ${deleting?.clientName || 'client'}?`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
