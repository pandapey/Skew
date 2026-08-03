import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiPlus, FiTrash2, FiEye, FiEdit2, FiCheckCircle, FiDownload, FiFileText } from 'react-icons/fi'
import { financeApi } from '@/api/services'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select, Input,
  Textarea, Modal, ConfirmDialog, Badge,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import {
  INVOICE_STATUSES, INVOICE_STATUS_TONE, PAYMENT_METHODS, FINANCE_CLIENTS, FINANCE_WRITE_ROLES, TAX_RATES,
} from '@/features/finance/constants'
import { exportInvoicePdf } from '@/utils/export'
import { formatCurrency, formatDate } from '@/utils'

const lineTotals = (items) => {
  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0)
  return subtotal
}

// Invoices: list + builder (line items) + record payment + PDF/Excel/CSV export.
export default function Invoices() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canWrite = hasRole(FINANCE_WRITE_ROLES)

  const [params, setParams] = useState({ search: '', status: '', page: 1, limit: 8 })
  const [buildOpen, setBuildOpen] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payingId, setPayingId] = useState(null)
  const [payAmount, setPayAmount] = useState(0)
  const [deleting, setDeleting] = useState(null)
  const [draft, setDraft] = useState(emptyInvoice())

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fin-invoices', queryParams],
    queryFn: () => financeApi.invoices.query(queryParams),
    placeholderData: keepPreviousData,
  })

  const rows = data?.data ?? []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fin-invoices'] })
    qc.invalidateQueries({ queryKey: ['finance-stats'] })
    qc.invalidateQueries({ queryKey: ['fin-transactions'] })
  }

  const subtotal = lineTotals(draft.items)
  const tax = Math.round(subtotal * ((draft.taxRate || 0) / 100))
  const total = subtotal + tax

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const addLine = () => setDraft((d) => ({ ...d, items: [...d.items, { description: '', quantity: 1, rate: 0 }] }))
  const removeLine = (i) => setDraft((d) => ({ ...d, items: d.items.filter((_, idx) => idx !== i) }))
  const setLine = (i, patch) => setDraft((d) => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }))

  const openBuild = () => { setEditing(null); setDraft(emptyInvoice()); setBuildOpen(true) }
  const openEdit = (inv) => {
    setEditing(inv)
    setDraft({
      client: inv.client, clientEmail: inv.clientEmail || '', taxRate: inv.taxRate ?? 18,
      issueDate: inv.issueDate || '', dueDate: inv.dueDate || '', status: inv.status, notes: inv.notes || '',
      items: (inv.items || []).map((it) => ({ description: it.description, quantity: it.quantity, rate: it.rate })),
    })
    setBuildOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const items = draft.items.filter((it) => it.description && Number(it.quantity) > 0)
      if (editing) {
        return financeApi.invoices.update(editing.id, {
          ...draft, items, subtotal, tax, total,
        })
      }
      return financeApi.createInvoice({ ...draft, items, subtotal, tax, total })
    },
    onSuccess: () => { toast.success(editing ? 'Invoice updated' : 'Invoice created'); setBuildOpen(false); invalidate() },
    onError: () => toast.error('Could not save invoice'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.invoices.remove(id),
    onSuccess: () => { toast.success('Invoice deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const recordPayMutation = useMutation({
    mutationFn: () => financeApi.recordInvoicePayment(payingId, Number(payAmount)),
    onSuccess: () => { toast.success('Payment recorded'); setPayOpen(false); setPayingId(null); invalidate() },
    onError: () => toast.error('Could not record payment'),
  })

  const openPay = (inv) => { setPayingId(inv.id); setPayAmount(Math.max(0, inv.total - (inv.amountPaid || 0))); setPayOpen(true) }

  const columns = [
    { key: 'invoiceNumber', header: 'Invoice #', render: (r) => <span className="font-medium">{r.invoiceNumber}</span> },
    { key: 'client', header: 'Client' },
    { key: 'items', header: 'Items', render: (r) => `${r.items?.length || 0} lines` },
    { key: 'total', header: 'Total', render: (r) => formatCurrency(r.total) },
    { key: 'amountPaid', header: 'Paid', render: (r) => formatCurrency(r.amountPaid || 0) },
    { key: 'balance', header: 'Balance', render: (r) => <span className="font-medium text-warning">{formatCurrency(Math.max(0, (r.total || 0) - (r.amountPaid || 0)))}</span> },
    { key: 'dueDate', header: 'Due', render: (r) => formatDate(r.dueDate) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={INVOICE_STATUS_TONE[r.status]}>{r.status}</Badge> },
    ...(canWrite ? [{ key: '_actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => setViewing(r)} aria-label="View"><FiEye /></button>
        {r.status !== 'Paid' && r.status !== 'Cancelled' && (
          <button className="rounded-lg p-2 hover:bg-success/10 hover:text-success" onClick={() => openPay(r)} aria-label="Record payment" title="Record payment"><FiCheckCircle /></button>
        )}
        <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => openEdit(r)} aria-label="Edit"><FiEdit2 /></button>
        <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>
      </div>
    ) }] : [{ key: '_view', header: '', className: 'text-right', render: (r) => (
      <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => setViewing(r)} aria-label="View"><FiEye /></button>
    ) }]),
  ]

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Create, send and track billing & receivables."
        actions={
          <>
            <ExportMenu
              rows={rows} filename="invoices" title="Invoices"
              columns={[
                { header: 'Invoice #', accessor: 'invoiceNumber' }, { header: 'Client', accessor: 'client' },
                { header: 'Total', accessor: 'total' }, { header: 'Paid', accessor: 'amountPaid' },
                { header: 'Balance', accessor: (r) => Math.max(0, (r.total || 0) - (r.amountPaid || 0)) },
                { header: 'Due', accessor: 'dueDate' }, { header: 'Status', accessor: 'status' },
              ]}
            />
            {canWrite && <Button icon={FiPlus} onClick={openBuild}>New Invoice</Button>}
          </>
        }
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          <Select className="lg:w-44" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
            options={[{ value: '', label: 'All Status' }, ...INVOICE_STATUSES.map((o) => ({ value: o, label: o }))]} />
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} invoices</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable columns={columns} data={rows} loading={isLoading} onRowClick={setViewing} empty="No invoices found" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      {/* Create / Edit invoice modal (line-item builder) */}
      <Modal
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        title={editing ? `Edit ${editing.invoiceNumber}` : 'New Invoice'}
        size="xl"
        footer={<><Button variant="ghost" onClick={() => setBuildOpen(false)}>Cancel</Button><Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>{editing ? 'Save' : 'Create Invoice'}</Button></>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Client" value={draft.client} onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))}
              options={[{ value: '', label: '— Select Client —' }, ...FINANCE_CLIENTS.map((o) => ({ value: o, label: o }))]} />
            <Input label="Client Email" value={draft.clientEmail} onChange={(e) => setDraft((d) => ({ ...d, clientEmail: e.target.value }))} />
            <Select label="Tax Rate (%)" options={TAX_RATES.map((r) => ({ value: r, label: `${r}%` }))} value={draft.taxRate}
              onChange={(e) => setDraft((d) => ({ ...d, taxRate: Number(e.target.value) }))} />
            <Select label="Status" options={INVOICE_STATUSES.map((o) => ({ value: o, label: o }))} value={draft.status}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} />
            <Input label="Issue Date" type="date" value={draft.issueDate} onChange={(e) => setDraft((d) => ({ ...d, issueDate: e.target.value }))} />
            <Input label="Due Date" type="date" value={draft.dueDate} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">Line Items</label>
              <Button variant="ghost" icon={FiPlus} onClick={addLine} type="button">Add Line</Button>
            </div>
            <div className="space-y-2">
              {draft.items.length === 0 && <p className="rounded-xl border border-dashed border-app p-4 text-center text-sm text-muted">No lines yet — add a description.</p>}
              {draft.items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 items-end gap-2">
                  <Input className="col-span-6" label={i === 0 ? 'Description' : undefined} value={it.description}
                    onChange={(e) => setLine(i, { description: e.target.value })} />
                  <Input className="col-span-2" label={i === 0 ? 'Qty' : undefined} type="number" min="1" value={it.quantity}
                    onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                  <Input className="col-span-2" label={i === 0 ? 'Rate' : undefined} type="number" value={it.rate}
                    onChange={(e) => setLine(i, { rate: Number(e.target.value) })} />
                  <div className="col-span-1 pb-2 text-xs font-medium">{formatCurrency((it.quantity || 0) * (it.rate || 0))}</div>
                  <button type="button" className="col-span-1 mb-1 rounded-lg p-2 text-danger hover:bg-danger/10" onClick={() => removeLine(i)} aria-label="Remove line"><FiTrash2 /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax ({draft.taxRate || 0}%)</span><span>{formatCurrency(tax)}</span></div>
            <div className="flex justify-between border-t border-app pt-1 font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div>
          </div>

          <Textarea label="Notes" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />
        </div>
      </Modal>

      {/* View invoice modal */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.invoiceNumber} — ${viewing.client}` : ''}
        size="lg"
        footer={
          <>
            <Button variant="ghost" icon={FiDownload} onClick={() => viewing && exportInvoicePdf(viewing)}>Download PDF</Button>
            {canWrite && viewing && viewing.status !== 'Paid' && viewing.status !== 'Cancelled' && (
              <Button icon={FiCheckCircle} onClick={() => { openPay(viewing); setViewing(null) }}>Record Payment</Button>
            )}
            <Button variant="ghost" onClick={() => setViewing(null)}>Close</Button>
          </>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div><p className="text-muted">Client</p><p className="font-medium">{viewing.client}</p></div>
              <div><p className="text-muted">Issue Date</p><p className="font-medium">{formatDate(viewing.issueDate)}</p></div>
              <div><p className="text-muted">Due Date</p><p className="font-medium">{formatDate(viewing.dueDate)}</p></div>
              <div><p className="text-muted">Status</p><Badge tone={INVOICE_STATUS_TONE[viewing.status]}>{viewing.status}</Badge></div>
            </div>
            <DataTable
              columns={[
                { key: 'description', header: 'Description' },
                { key: 'quantity', header: 'Qty' },
                { key: 'rate', header: 'Rate', render: (r) => formatCurrency(r.rate) },
                { key: 'amount', header: 'Amount', render: (r) => formatCurrency((r.quantity || 0) * (r.rate || 0)) },
              ]}
              data={viewing.items || []}
              empty="No line items"
            />
            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatCurrency(viewing.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Tax</span><span>{formatCurrency(viewing.tax)}</span></div>
              <div className="flex justify-between border-t border-app pt-1 font-semibold"><span>Total</span><span>{formatCurrency(viewing.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Paid</span><span>{formatCurrency(viewing.amountPaid || 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Balance</span><span className="font-semibold text-warning">{formatCurrency(Math.max(0, (viewing.total || 0) - (viewing.amountPaid || 0)))}</span></div>
            </div>
            {viewing.notes && <p className="text-sm text-muted">Notes: {viewing.notes}</p>}
          </div>
        )}
      </Modal>

      {/* Record payment modal */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record Payment"
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button><Button loading={recordPayMutation.isPending} onClick={() => recordPayMutation.mutate()}>Record</Button></>}
      >
        <div className="space-y-4">
          <Input label="Amount (₹)" type="number" min="0" value={payAmount}
            onChange={(e) => setPayAmount(Number(e.target.value))} />
          <Select label="Method" value="Bank Transfer" options={PAYMENT_METHODS.map((o) => ({ value: o, label: o }))} />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete Invoice?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

function emptyInvoice() {
  return { client: '', clientEmail: '', taxRate: 18, issueDate: '2026-07-15', dueDate: '2026-08-15', status: 'Draft', notes: '', items: [] }
}
