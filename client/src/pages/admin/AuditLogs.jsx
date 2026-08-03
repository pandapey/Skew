import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { FiTrash2, FiFileText, FiShield } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { PageHeader, Card, CardHeader, DataTable, Pagination, SearchInput, Select, Badge, ConfirmDialog } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagination } from '@/hooks/usePagination'
import { adminApi } from '@/api/adminApi'
import { LOG_SEVERITY } from '@/features/admin/constants'
import { useCanEdit } from '@/features/rbac/editPermissions'

const SEV_TONE = { Info: 'success', Warning: 'warning', Critical: 'danger' }
const MODULES = ['Users', 'Roles', 'Permissions', 'Company', 'API Keys', 'Finance', 'Backup', 'Restore', 'Security', 'Theme']

// Real backend returns `at` / `createdAt`; mock returns `time`.
const fmtTime = (r) => {
  const raw = r.time || r.at || r.createdAt
  if (!raw) return '—'
  const d = new Date(raw)
  return isNaN(d) ? raw : d.toLocaleString()
}

export default function AuditLogs() {
  const qc = useQueryClient()
  const [params, setParams] = useState({ search: '', user: '', module: '', severity: '' })
  const [deleting, setDeleting] = useState(null)

  // Phase 6.0 (TASK 1): defence in depth. This page already sits behind the
  // Admin-only branch of routes/index.jsx and adminRoutes.js `canAdmin`, so the
  // Delete control was not exploitable - but it referenced no permission helper
  // at all. Deleting an AUDIT TRAIL entry is the single most
  // integrity-sensitive destructive action in the product, so it should not
  // rely solely on an ancestor route guard for its affordance.
  const canDeleteLogs = useCanEdit('auditLogs')
  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-audit', queryParams],
    queryFn: () => adminApi.auditLogs.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const { page, totalPages, paged, setPage } = usePagination(rows, 9)

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.auditLogs.remove(id),
    onSuccess: () => { toast.success('Log deleted'); setDeleting(null); qc.invalidateQueries({ queryKey: ['admin-audit'] }) },
    onError: () => toast.error('Delete failed'),
  })

  const setP = (patch) => setParams((p) => ({ ...p, ...patch }))

  const exportCols = [
    { header: 'User', accessor: 'user' }, { header: 'Action', accessor: 'action' },
    { header: 'Module', accessor: 'module' }, { header: 'Severity', accessor: 'severity' },
    { header: 'IP', accessor: 'ip' }, { header: 'Time', accessor: 'time' },
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
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} records</span>
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
                  {canDeleteLogs && <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>}
                </div>
              ) },
            ]}
            data={paged}
            loading={isLoading}
            empty="No audit logs found"
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">Page {page} of {totalPages}</p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleteMutation.mutate(deleting.id)} title="Delete log entry?" message="This removes the record from the audit trail." confirmLabel="Delete" loading={deleteMutation.isPending} />
    </div>
  )
}
