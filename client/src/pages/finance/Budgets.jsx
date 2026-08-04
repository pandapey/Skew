import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus, FiEdit2, FiTrash2, FiBarChart2 } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select, Input,
  Modal, ConfirmDialog, Badge, StatCard,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import {
  BUDGET_STATUSES, BUDGET_STATUS_TONE, FINANCE_WRITE_ROLES,
} from '@/features/finance/constants'
import { budgetSchema } from '@/features/finance/schemas'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { cn, formatCurrency } from '@/utils'

export default function Budgets() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(FINANCE_WRITE_ROLES)

  const [params, setParams] = useState({ search: '', period: '', status: '', page: 1, limit: 8 })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fin-budgets', queryParams],
    queryFn: () => financeApi.budgets.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const { data: cats = [] } = useQuery({ queryKey: ['fin-cat-all'], queryFn: financeApi.categories.all })
  const expenseCats = cats.filter((c) => c.type === 'Expense').map((c) => c.name)

  const rows = data?.data ?? []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fin-budgets'] })
    qc.invalidateQueries({ queryKey: ['finance-stats'] })
  }

  const totals = (() => {
    const allocated = rows.reduce((s, b) => s + (Number(b.allocated) || 0), 0)
    const spent = rows.reduce((s, b) => s + (Number(b.spent) || 0), 0)
    return { allocated, spent, pct: allocated ? Math.round((spent / allocated) * 100) : 0 }
  })()

  const form = useForm({ resolver: zodResolver(budgetSchema), defaultValues: emptyBudget() })

  const saveMutation = useMutation({
    mutationFn: (values) => (editing ? financeApi.budgets.update(editing.id, values) : financeApi.budgets.create(values)),
    onSuccess: () => { toast.success(editing ? 'Budget updated' : 'Budget added'); setModalOpen(false); invalidate() },
    onError: () => toast.error('Could not save budget'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.budgets.remove(id),
    onSuccess: () => { toast.success('Budget deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const openAdd = () => { setEditing(null); form.reset(emptyBudget()); setModalOpen(true) }
  const openEdit = (r) => { setEditing(r); form.reset({ ...emptyBudget(), ...r }); setModalOpen(true) }
  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const columns = [
    { key: 'category', header: 'Category', render: (r) => <span className="font-medium">{r.category}</span> },
    { key: 'period', header: 'Period' },
    { key: 'allocated', header: 'Allocated', render: (r) => formatCurrency(r.allocated) },
    { key: 'spent', header: 'Spent', render: (r) => formatCurrency(r.spent) },
    {
      key: 'progress', header: 'Utilisation', render: (r) => {
        const pct = r.allocated ? Math.min(100, Math.round((r.spent / r.allocated) * 100)) : 0
        return (
          <div className="w-40">
            <div className="h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div className={cn('h-full rounded-full', pct > 100 || r.status === 'Over Budget' ? 'bg-danger' : pct > 85 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
            </div>
            <span className="mt-1 block text-xs text-muted">{pct}%</span>
          </div>
        )
      },
    },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={BUDGET_STATUS_TONE[r.status]}>{r.status}</Badge> },
    ...(canWrite ? [{ key: '_actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => openEdit(r)} aria-label="Edit"><FiEdit2 /></button>
        <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>
      </div>
    ) }] : []),
  ]

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Plan vs actual spend by category."
        actions={
          <>
            <ExportMenu
              rows={rows} filename="budgets" title="Budgets"
              columns={[
                { header: 'Category', accessor: 'category' }, { header: 'Period', accessor: 'period' },
                { header: 'Allocated', accessor: 'allocated' }, { header: 'Spent', accessor: 'spent' },
                { header: 'Status', accessor: 'status' },
              ]}
            />
            {canWrite && <Button icon={FiPlus} onClick={openAdd}>Add Budget</Button>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Allocated" value={formatCurrency(totals.allocated)} icon={FiBarChart2} tone="primary" />
        <StatCard label="Total Spent" value={formatCurrency(totals.spent)} icon={FiBarChart2} tone="warning" />
        <StatCard label="Utilisation" value={`${totals.pct}%`} icon={FiBarChart2} tone={totals.pct > 100 ? 'danger' : 'success'} />
        <StatCard label="Budgets" value={data?.total || 0} icon={FiBarChart2} tone="accent" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          <Select className="lg:w-40" value={params.period} onChange={(e) => setParam({ period: e.target.value })}
            options={[{ value: '', label: 'All Periods' }, ...[...new Set(rows.map((r) => r.period))].map((o) => ({ value: o, label: o }))]} />
          <Select className="lg:w-40" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
            options={[{ value: '', label: 'All Status' }, ...BUDGET_STATUSES.map((o) => ({ value: o, label: o }))]} />
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} budgets</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable columns={columns} data={rows} loading={isLoading} empty="No budgets found" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${editing ? 'Edit' : 'Add'} Budget`}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button loading={saveMutation.isPending} onClick={form.handleSubmit((v) => saveMutation.mutate(v))}>{editing ? 'Save' : 'Add'}</Button></>}
      >
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Category" options={expenseCats.map((o) => ({ value: o, label: o }))} error={form.formState.errors.category?.message} {...form.register('category')} />
          <Input label="Period" placeholder="e.g. July 2026" error={form.formState.errors.period?.message} {...form.register('period')} />
          <Input label="Allocated (₹)" type="number" step="0.01" error={form.formState.errors.allocated?.message} {...form.register('allocated')} />
          <Input label="Spent (₹)" type="number" step="0.01" {...form.register('spent')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete Budget?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

function emptyBudget() {
  return { category: '', period: 'July 2026', allocated: 0, spent: 0 }
}
