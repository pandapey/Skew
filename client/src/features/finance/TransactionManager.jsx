import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus, FiEdit2, FiTrash2, FiTrendingUp, FiTrendingDown, FiDollarSign, FiRepeat } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select, Input,
  Textarea, Modal, ConfirmDialog, Badge, StatCard,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import { transactionSchema } from '@/features/finance/schemas'
import {
  FINANCE_WRITE_ROLES, TRANSACTION_TYPES, PAYMENT_METHODS, TAX_RATES, TYPE_TONE,
} from '@/features/finance/constants'
import { formatCurrency, formatDate } from '@/utils'

export function TransactionManager({ mode = 'all', title, subtitle, api, queryKey, categoryType }) {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(FINANCE_WRITE_ROLES)
  const locked = mode !== 'all'

  const [params, setParams] = useState({ search: '', type: '', category: '', method: '', page: 1, limit: 8 })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }
  if (locked) delete queryParams.type

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [queryKey, queryParams],
    queryFn: () => api.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const { data: allCats = [] } = useQuery({ queryKey: ['fin-cat-all'], queryFn: financeApi.categories.all })

  const rows = data?.data ?? []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [queryKey] })
    qc.invalidateQueries({ queryKey: ['finance-stats'] })
    qc.invalidateQueries({ queryKey: ['fin-transactions'] })
    qc.invalidateQueries({ queryKey: ['finance-tax'] })
    qc.invalidateQueries({ queryKey: ['finance-period'] })
  }

  const totals = useMemo(() => {
    const income = rows.filter((t) => t.type === 'Income').reduce((s, t) => s + t.amount, 0)
    const expense = rows.filter((t) => t.type === 'Expense').reduce((s, t) => s + t.amount, 0)
    return { income, expense, net: income - expense }
  }, [rows])

  const categoryOptions = useMemo(() => {
    const wanted = categoryType || (locked ? mode : null)
    return allCats.filter((c) => (wanted ? c.type === wanted : true)).map((c) => c.name)
  }, [allCats, categoryType, locked, mode])

  const form = useForm({ resolver: zodResolver(transactionSchema), defaultValues: emptyTxn(mode) })

  const saveMutation = useMutation({
    mutationFn: (values) => (editing ? api.update(editing.id, values) : api.create(values)),
    onSuccess: () => { toast.success(editing ? 'Transaction updated' : 'Transaction added'); setModalOpen(false); invalidate() },
    onError: () => toast.error('Could not save transaction'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => api.remove(id),
    onSuccess: () => { toast.success('Deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const openAdd = () => { setEditing(null); form.reset(emptyTxn(mode)); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); form.reset({ ...emptyTxn(mode), ...row }); setModalOpen(true) }
  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const columns = [
    { key: 'title', header: 'Title', render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.reference || '—'}</p></div> },
    { key: 'category', header: 'Category' },
    ...(!locked ? [{ key: 'type', header: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge> }] : []),
    { key: 'party', header: 'Party', render: (r) => r.party || '—' },
    { key: 'method', header: 'Method' },
    { key: 'amount', header: 'Amount', render: (r) => (
      <span className={r.type === 'Income' ? 'font-semibold text-success' : 'font-semibold text-danger'}>
        {r.type === 'Income' ? '+' : '-'}{formatCurrency(r.amount)}
      </span>
    ) },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
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
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <ExportMenu
              rows={rows} filename={queryKey} title={title}
              columns={[
                { header: 'Title', accessor: 'title' }, { header: 'Category', accessor: 'category' }, { header: 'Type', accessor: 'type' },
                { header: 'Party', accessor: 'party' }, { header: 'Method', accessor: 'method' }, { header: 'Amount', accessor: 'amount' }, { header: 'Date', accessor: 'date' },
              ]}
            />
            {canWrite && <Button icon={FiPlus} onClick={openAdd}>{locked ? `Add ${mode}` : 'Add Transaction'}</Button>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(mode !== 'Expense') && <StatCard label={locked ? `${mode} (page)` : 'Income (page)'} value={formatCurrency(totals.income)} icon={FiTrendingUp} tone="success" />}
        {(mode !== 'Income') && <StatCard label={locked ? `${mode} (page)` : 'Expense (page)'} value={formatCurrency(totals.expense)} icon={FiTrendingDown} tone="danger" />}
        {!locked && <StatCard label="Net (page)" value={formatCurrency(totals.net)} icon={FiDollarSign} tone="primary" />}
        <StatCard label="Records" value={data?.total || 0} icon={FiRepeat} tone="accent" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" placeholder="Search title, party, ref…" />
          {!locked && (
            <Select className="lg:w-36" value={params.type} onChange={(e) => setParam({ type: e.target.value })}
              options={[{ value: '', label: 'All Types' }, ...TRANSACTION_TYPES.map((o) => ({ value: o, label: o }))]} />
          )}
          <Select className="lg:w-48" value={params.category} onChange={(e) => setParam({ category: e.target.value })}
            options={[{ value: '', label: 'All Categories' }, ...categoryOptions.map((o) => ({ value: o, label: o }))]} />
          <Select className="lg:w-44" value={params.method} onChange={(e) => setParam({ method: e.target.value })}
            options={[{ value: '', label: 'All Methods' }, ...PAYMENT_METHODS.map((o) => ({ value: o, label: o }))]} />
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable columns={columns} data={rows} loading={isLoading} empty={`No ${title.toLowerCase()} found`} />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      {/* Add / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${editing ? 'Edit' : 'Add'} ${locked ? mode : 'Transaction'}`}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button loading={saveMutation.isPending} onClick={form.handleSubmit((v) => saveMutation.mutate(v))}>{editing ? 'Save' : 'Add'}</Button></>}
      >
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Title" className="sm:col-span-2" error={form.formState.errors.title?.message} {...form.register('title')} />
          {!locked
            ? <Select label="Type" options={TRANSACTION_TYPES} error={form.formState.errors.type?.message} {...form.register('type')} />
            : <input type="hidden" {...form.register('type')} />}
          <Select label="Category" options={[{ value: '', label: '— Select —' }, ...categoryOptions.map((o) => ({ value: o, label: o }))]} error={form.formState.errors.category?.message} {...form.register('category')} />
          <Input label="Amount (₹)" type="number" step="0.01" error={form.formState.errors.amount?.message} {...form.register('amount')} />
          <Input label="Date" type="date" error={form.formState.errors.date?.message} {...form.register('date')} />
          <Select label="Payment Method" options={PAYMENT_METHODS} {...form.register('method')} />
          <Input label="Party (client / vendor)" {...form.register('party')} />
          <Input label="Reference" {...form.register('reference')} />
          <Select label="Tax Rate (%)" options={TAX_RATES.map((r) => ({ value: r, label: `${r}%` }))} {...form.register('taxRate')} />
          <Textarea label="Notes" className="sm:col-span-2" {...form.register('notes')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete Transaction?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

function emptyTxn(mode) {
  return {
    title: '', type: mode === 'all' ? 'Expense' : mode, category: '', amount: 0,
    date: '2026-07-15', method: 'Bank Transfer', party: '', reference: '', taxRate: mode === 'Income' ? 18 : 0, notes: '',
  }
}
