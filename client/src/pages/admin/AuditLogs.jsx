import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { FiTrash2 } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { PageHeader, Card, DataTable, Pagination, SearchInput, Select, Badge, ConfirmDialog } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { adminApi } from '@/api/adminApi'
import { LOG_SEVERITY } from '@/features/admin/constants'

const SEV_TONE = { Info: 'success', Warning: 'warning', Critical: 'danger' }
const MODULES = [
  'Users', 'Payroll', 'Restore',
  'Admin', 'API Keys', 'Auth', 'Backup', 'Client', 'Company', 'Employee',
  'Finance', 'HR', 'Permissions', 'Project', 'Roles', 'Security', 'Theme', 'User',
]

// Real backend returns `at` / `createdAt`; mock returns `time`.
const fmtTime = (r) => {
  const raw = r.time || r.at || r.createdAt
  if (!raw) return '—'
  const d = new Date(raw)
  return isNaN(d) ? raw : d.toLocaleString()
}

const PAGE_SIZE = 9

const INITIAL = {
  search: '', user: '', module: '', severity: '',
  sortBy: 'at', order: 'desc',
}

export default function AuditLogs() {
  const qc = useQueryClient()
  const [params, setParams] = useState(INITIAL)
  const [page, setPage] = useState(1)
  const [deleting, setDeleting] = useState(null)
  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced, page, limit: PAGE_SIZE }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-audit', queryParams],
    queryFn: () => adminApi.auditLogs.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const totalPages = data?.totalPages || 1
  const total = data?.total || 0

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.auditLogs.remove(id),
    onSuccess: () => {
      toast.success('Log deleted')
      setDeleting(null)
      if (rows.length === 1 && page > 1) setPage((p) => p - 1)
      qc.invalidateQueries({ queryKey: ['admin-audit'] })
    },
    onError: () => toast.error('Delete failed'),
  })

  // Any change to search / filters / sort restarts at page 1.
  const setP = (patch) => { setParams((p) => ({ ...p, ...patch })); setPage(1) }

  const exportCols = [
    { header: 'User', accessor: 'user' }, { header: 'Action', accessor: 'action' },
    { header: 'Module', accessor: 'module' }, { header: 'Severity', accessor: 'severity' },
    { header: 'IP', accessor: 'ip' }, { header: 'Time', accessor: (r) => fmtTime(r) },
  ]

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        subtitle="A chronological record of administrative actions."
        actions={<ExportMenu rows={rows} columns={exportCols} filename="audit-logs" title="Audit Logs" subtitle="Skew Enterprise Hub" />}
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setP({ search: v })} className="lg:max-w-xs" />
          <Select value={params.module} onChange={(e) => setP({ module: e.target.value })} className="lg:w-44" options={[{ value: '', label: 'All Modules' }, ...MODULES.map((m) => ({ value: m, label: m }))]} />
          <Select value={params.severity} onChange={(e) => setP({ severity: e.target.value })} className="lg:w-44" options={[{ value: '', label: 'All Severity' }, ...LOG_SEVERITY.map((s) => ({ value: s, label: s }))]} />
          <span className="text-sm text-muted lg:ml-auto">{total} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable
            columns={[
              { key: 'user', header: 'User', render: (r) => <span className="font-medium">{r.user}</span> },
              { key: 'actor', header: 'Admin', render: (r) => <span className="text-muted">{r.actor || 'System'}</span> },
              { key: 'action', header: 'Action', render: (r) => r.action },
              { key: 'module', header: 'Module', render: (r) => <Badge tone="primary">{r.module}</Badge> },
              { key: 'severity', header: 'Severity', render: (r) => <Badge tone={SEV_TONE[r.severity]}>{r.severity}</Badge> },
              { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
              { key: 'time', header: 'Time', render: (r) => <span className="text-muted">{fmtTime(r)}</span> },
              { key: '_a', header: '', className: 'text-right', render: (r) => (
                <div className="flex justify-end">
                  <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>
                </div>
              ) },
            ]}
            data={rows}
            loading={isLoading}
            empty="No audit logs found"
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">
            {total === 0
              ? 'No records'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} · Page ${data?.page || page} of ${totalPages}`}
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleteMutation.mutate(deleting.id)} title="Delete log entry?" message="This removes the record from the audit trail." confirmLabel="Delete" loading={deleteMutation.isPending} />
    </div>
  )
}
