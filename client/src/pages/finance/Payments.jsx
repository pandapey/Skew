import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus, FiEdit2, FiTrash2, FiCreditCard } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select, Input,
  Textarea, Modal, ConfirmDialog, Badge, StatCard,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import {
  PAYMENT_DIRECTIONS, PAYMENT_STATUSES, PAYMENT_STATUS_TONE, PAYMENT_DIR_TONE, PAYMENT_METHODS,
  FINANCE_CLIENTS, FINANCE_VENDORS, FINANCE_WRITE_ROLES,
} from '@/features/finance/constants'
import { paymentSchema } from '@/features/finance/schemas'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { formatCurrency, formatDate } from '@/utils'

export default function Payments() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(FINANCE_WRITE_ROLES)

  const [params, setParams] = useState({ search: '', direction: '', status: '', method: '', page: 1, limit: 8 })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fin-payments', queryParams],
    queryFn: () => financeApi.payments.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fin-payments'] })
    qc.invalidateQueries({ queryKey: ['finance-stats'] })
  }

  const totals = useMemo(() => {
    const incoming = rows.filter((p) => p.direction === 'Incoming').reduce((s, p) => s + (Number(p.amount) || 0), 0)
    const outgoing = rows.filter((p) => p.direction === 'Outgoing').reduce((s, p) => s + (Number(p.amount) || 0), 0)
    return { incoming, outgoing, net: incoming - outgoing }
  }, [rows])

  const form = useForm({ resolver: zodResolver(paymentSchema), defaultValues: emptyPayment() })

  const saveMutation = useMutation({
    mutationFn: (values) => (editing ? financeApi.payments.update(editing.id, values) : financeApi.payments.create(values)),
    onSuccess: () => { toast.success(editing ? 'Payment updated' : 'Payment added'); setModalOpen(false); invalidate() },
    onError: () => toast.error('Could not save payment'),
  })
  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.payments.remove(id),
    onSuccess: () => { toast.success('Payment deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const openAdd = () => { setEditing(null); form.reset(emptyPayment()); setModalOpen(true) }
  const openEdit = (r) => { setEditing(r); form.reset({ ...emptyPayment(), ...r }); setModalOpen(true) }
  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const columns = [
    { key: 'paymentNumber', header: 'Payment #', render: (r) => <span className="font-medium">{r.paymentNumber}</span> },
    { key: 'direction', header: 'Direction', render: (r) => <Badge tone={PAYMENT_DIR_TONE[r.direction]}>{r.direction}</Badge> },
    { key: 'party', header: 'Party' },
    { key: 'invoiceNumber', header: 'Invoice', render: (r) => r.invoiceNumber || '—' },
    { key: 'amount', header: 'Amount', render: (r) => (
      <span className={r.direction === 'Incoming' ? 'font-semibold text-success' : 'font-semibold text-danger'}>
        {r.direction === 'Incoming' ? '+' : '-'}{formatCurrency(r.amount)}
      </span>
    ) },
    { key: 'method', header: 'Method' },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={PAYMENT_STATUS_TONE[r.status]}>{r.status}</Badge> },
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
        title="Payments"
        subtitle="Track incoming and outgoing settlements."
        actions={
          <>
            <ExportMenu
              rows={rows} filename="payments" title="Payments"
              columns={[
                { header: 'Payment #', accessor: 'paymentNumber' }, { header: 'Direction', accessor: 'direction' },
                { header: 'Party', accessor: 'party' }, { header: 'Invoice', accessor: 'invoiceNumber' },
                { header: 'Amount', accessor: 'amount' }, { header: 'Method', accessor: 'method' },
                { header: 'Date', accessor: 'date' }, { header: 'Status', accessor: 'status' },
              ]}
            />
            {canWrite && <Button icon={FiPlus} onClick={openAdd}>Add Payment</Button>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Incoming" value={formatCurrency(totals.incoming)} icon={FiCreditCard} tone="success" />
        <StatCard label="Outgoing" value={formatCurrency(totals.outgoing)} icon={FiCreditCard} tone="danger" />
        <StatCard label="Net" value={formatCurrency(totals.net)} icon={FiCreditCard} tone="primary" />
        <StatCard label="Records" value={data?.total || 0} icon={FiCreditCard} tone="accent" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          <Select className="lg:w-40" value={params.direction} onChange={(e) => setParam({ direction: e.target.value })}
            options={[{ value: '', label: 'All Directions' }, ...PAYMENT_DIRECTIONS.map((o) => ({ value: o, label: o }))]} />
          <Select className="lg:w-40" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
            options={[{ value: '', label: 'All Status' }, ...PAYMENT_STATUSES.map((o) => ({ value: o, label: o }))]} />
          <Select className="lg:w-44" value={params.method} onChange={(e) => setParam({ method: e.target.value })}
            options={[{ value: '', label: 'All Methods' }, ...PAYMENT_METHODS.map((o) => ({ value: o, label: o }))]} />
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable columns={columns} data={rows} loading={isLoading} empty="No payments found" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`${editing ? 'Edit' : 'Add'} Payment`}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button><Button loading={saveMutation.isPending} onClick={form.handleSubmit((v) => saveMutation.mutate(v))}>{editing ? 'Save' : 'Add'}</Button></>}
      >
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Direction" options={PAYMENT_DIRECTIONS} error={form.formState.errors.direction?.message} {...form.register('direction')} />
          <Input label="Party" error={form.formState.errors.party?.message} {...form.register('party')}
            placeholder={form.watch('direction') === 'Outgoing' ? 'Vendor' : 'Client'} />
          <Input label="Invoice # (optional)" {...form.register('invoiceNumber')} />
          <Input label="Amount (₹)" type="number" step="0.01" error={form.formState.errors.amount?.message} {...form.register('amount')} />
          <Select label="Method" options={PAYMENT_METHODS} {...form.register('method')} />
          <Select label="Status" options={PAYMENT_STATUSES} {...form.register('status')} />
          <Input label="Date" type="date" error={form.formState.errors.date?.message} {...form.register('date')} />
          <Textarea label="Notes" className="sm:col-span-2" {...form.register('notes')} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete Payment?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

function emptyPayment() {
  return { direction: 'Incoming', party: '', invoiceNumber: '', amount: 0, method: 'Bank Transfer', status: 'Completed', date: '2026-07-15', notes: '' }
}
