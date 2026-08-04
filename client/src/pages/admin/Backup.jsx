import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FiServer, FiPlus, FiDownload, FiTrash2, FiRefreshCw } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { PageHeader, Card, CardHeader, Button, DataTable, Badge, Modal, Input, Select, ConfirmDialog, Loader } from '@/components/ui'
import { adminApi } from '@/api/adminApi'
import { BACKUP_TYPES, BACKUP_STATUS, ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { formatBytes, cn } from '@/utils'
import { useAuth } from '@/hooks/useAuth'

export default function Backup() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(ADMIN_WRITE_ROLES)
  const { data, isLoading } = useQuery({ queryKey: ['admin-backups'], queryFn: adminApi.backups.all })
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ name: 'Manual Backup', type: 'Full' })
  const [deleting, setDeleting] = useState(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-backups'] })

  // PHASE ADMIN (TASK 4) ROOT CAUSE #1 - the frontend called a function that
  // does not exist.
  //
  // This used to be `adminApi.triggerBackup(form)` / `adminApi.downloadBackup(id)`.
  // Neither name is defined ANYWHERE on the adminApi object - the real methods
  // are nested as `adminApi.backups.trigger` and `adminApi.backups.download`.
  // A repo-wide search for `triggerBackup|downloadBackup` returned exactly two
  // hits, both in this file, and zero definitions.
  //
  // So `adminApi.triggerBackup` evaluated to `undefined` and calling it threw
  // `TypeError: adminApi.triggerBackup is not a function` inside the mutation.
  // React Query caught that rejection and ran `onError`, which displayed the
  // literal string 'Backup failed'. THAT is the "Backup failed" the user sees:
  // the request never left the browser, the route was never hit, and the server
  // was never even asked to make a backup. Fixing the call target is the actual
  // root cause fix on the client side.
  const trigger = useMutation({
    mutationFn: () => adminApi.backups.trigger(form),
    onSuccess: () => { toast.success('Backup completed'); setModal(false); invalidate() },
    // No local onError toast: the shared axios interceptor in api/client.js
    // already surfaces the server's real message (e.g. "Cannot create a backup:
    // the database connection is not ready."). The old handler REPLACED that
    // real message with a hardcoded 'Backup failed', which is precisely what
    // hid the bug for so long. `invalidate()` is intentionally not called here
    // either, because the record is still refreshed on the next successful run
    // and a failed row is written server-side.
  })

  // The download must consume the response, not just fire it. The endpoint
  // streams a real gzip archive with `responseType: 'blob'`, so the blob is
  // turned into an object URL and handed to a temporary anchor - the standard
  // browser download handoff. The previous version resolved and toasted
  // "Download started" while nothing was ever written to disk.
  const download = useMutation({
    mutationFn: async (row) => {
      const blob = await adminApi.backups.download(row.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${String(row.name || 'backup').replace(/\s+/g, '_')}.json.gz`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    },
    onSuccess: () => toast.success('Backup downloaded'),
  })
  const remove = useMutation({
    mutationFn: (id) => adminApi.backups.remove(id),
    onSuccess: () => { toast.success('Backup deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  if (isLoading) return <Loader label="Loading backups…" />

  return (
    <div>
      <PageHeader
        title="Backup"
        subtitle="Scheduled and on-demand database backups."
        actions={canWrite && <Button icon={FiPlus} onClick={() => setModal(true)}>New Backup</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4"><p className="text-sm text-muted">Total Backups</p><p className="text-2xl font-bold">{(data ?? []).length}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Completed</p><p className="text-2xl font-bold text-success">{(data ?? []).filter((b) => b.status === 'Completed').length}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Failed</p><p className="text-2xl font-bold text-danger">{(data ?? []).filter((b) => b.status === 'Failed').length}</p></Card>
        <Card className="p-4"><p className="text-sm text-muted">Storage Used</p><p className="text-2xl font-bold">{formatBytes((data ?? []).reduce((s, b) => s + (b.size || 0), 0))}</p></Card>
      </div>

      <Card>
        <DataTable
          columns={[
            { key: 'name', header: 'Name', render: (r) => (
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10 text-success"><FiServer className="h-4 w-4" /></div>
                <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.createdBy} · {r.createdAt}</p></div>
              </div>
            ) },
            { key: 'type', header: 'Type', render: (r) => <Badge tone="accent">{r.type}</Badge> },
            { key: 'size', header: 'Size', render: (r) => <span className="font-mono text-xs">{formatBytes(r.size)}</span> },
            { key: 'duration', header: 'Duration', render: (r) => <span className="text-muted">{r.durationSec}s</span> },
            { key: 'status', header: 'Status', render: (r) => (
              <Badge tone={r.status === 'Completed' ? 'success' : r.status === 'Failed' ? 'danger' : 'warning'}>{r.status}</Badge>
            ) },
            { key: '_a', header: '', className: 'text-right', render: (r) => (
              <div className="flex justify-end gap-1">
                <button className="rounded-lg p-2 hover:bg-black/5 hover:text-primary dark:hover:bg-white/5" onClick={() => download.mutate(r)} aria-label="Download"><FiDownload /></button>
                {canWrite && <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>}
              </div>
            ) },
          ]}
          data={data ?? []}
          empty="No backups yet"
        />
      </Card>

      <Modal
        open={modal} onClose={() => setModal(false)} title="Create Backup"
        footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button><Button loading={trigger.isPending} onClick={() => trigger.mutate()}><FiRefreshCw className="mr-1 inline h-4 w-4" />Run Backup</Button></>}
      >
        <div className="space-y-4">
          <Input label="Backup Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Select label="Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} options={BACKUP_TYPES.map((t) => ({ value: t, label: t }))} />
          {/* PHASE ADMIN (TASK 4): this sentence is now actually true - every
              collection is exported and gzipped server-side. It previously
              described behaviour that did not exist. */}
          <p className="text-xs text-muted">Every collection in the database will be exported and stored as a compressed archive on the server.</p>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting.id)} title="Delete backup?" message="This backup file will be permanently removed." confirmLabel="Delete" loading={remove.isPending} />
    </div>
  )
}
