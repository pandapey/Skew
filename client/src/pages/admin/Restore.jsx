import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiRefreshCw, FiServer, FiArchive, FiClock } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { PageHeader, Card, CardHeader, Button, DataTable, Badge, ConfirmDialog, Loader } from '@/components/ui'
import { adminApi } from '@/api/adminApi'
import { ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { formatBytes } from '@/utils'
import { useAuth } from '@/hooks/useAuth'

export default function Restore() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(ADMIN_WRITE_ROLES)
  const { data, isLoading } = useQuery({ queryKey: ['admin-restore'], queryFn: adminApi.restore.list })
  const [restoring, setRestoring] = useState(null)

  const restore = useMutation({
    mutationFn: (id) => adminApi.restore.restore(id),
    onSuccess: () => { toast.success('System restored from point'); setRestoring(null); qc.invalidateQueries({ queryKey: ['admin-restore'] }) },
    onError: () => toast.error('Restore failed'),
  })

  if (isLoading) return <Loader label="Loading restore points…" />

  const rows = data ?? []

  return (
    <div>
      <PageHeader
        title="Restore"
        subtitle="Recover the platform from a backup or snapshot."
      />

      <Card className="mb-4">
        <CardHeader title="Before you restore" subtitle="A restore replaces current data with the selected point. A safety snapshot is taken automatically." />
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
          <FiClock className="mt-0.5 text-warning" />
          <p className="text-muted">Restores are logged to the audit trail. Active user sessions are notified before the operation begins.</p>
        </div>
      </Card>

      <Card>
        <DataTable
          columns={[
            { key: 'name', header: 'Restore Point', render: (r) => (
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${r.kind === 'Snapshot' ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'}`}>
                  {r.kind === 'Snapshot' ? <FiArchive className="h-4 w-4" /> : <FiServer className="h-4 w-4" />}
                </div>
                <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.createdBy} · {r.createdAt}</p></div>
              </div>
            ) },
            { key: 'kind', header: 'Kind', render: (r) => <Badge tone="default">{r.kind}</Badge> },
            { key: 'type', header: 'Type', render: (r) => <Badge tone="accent">{r.type}</Badge> },
            { key: 'size', header: 'Size', render: (r) => <span className="font-mono text-xs">{formatBytes(r.size)}</span> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'Completed' ? 'success' : 'danger'}>{r.status}</Badge> },
            { key: '_a', header: '', className: 'text-right', render: (r) => (
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" icon={FiRefreshCw} disabled={!canWrite || r.status !== 'Completed'} onClick={() => setRestoring(r)}>Restore</Button>
              </div>
            ) },
          ]}
          data={rows}
          empty="No restore points available"
        />
      </Card>

      <ConfirmDialog
        open={!!restoring}
        onClose={() => setRestoring(null)}
        onConfirm={() => restore.mutate(restoring.id)}
        title="Restore from this point?"
        message="Current data will be replaced. This action is recorded in the audit log."
        confirmLabel="Restore"
        loading={restore.isPending}
      />
    </div>
  )
}
