import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiUsers, FiCreditCard, FiAlertCircle, FiCheckCircle, FiFileText, FiClock } from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { PageHeader, Card, StatCard, Loader, Badge, SearchInput, DataTable, EmptyState } from '@/components/ui'
import { formatCurrency, formatDate } from '@/utils'

const STATUS_TONE = { Active: 'success', Onboarding: 'warning', 'On Hold': 'warning', Suspended: 'danger' }

export default function ClientBilling() {
  const { data, isLoading } = useQuery({ queryKey: ['hr-client-billing'], queryFn: hrApi.clientBilling })
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = (data?.clients || []).filter((c) =>
      !q || c.company.toLowerCase().includes(q) || String(c.contactPerson || '').toLowerCase().includes(q)
    )
    return [...list].sort((a, b) => (b.balance || 0) - (a.balance || 0))
  }, [data, search])

  if (isLoading) return <Loader label="Loading client billing…" />

  const columns = [
    {
      key: 'company', header: 'Client',
      render: (r) => (
        <div>
          <p className="font-medium">{r.company}</p>
          <p className="text-xs text-muted">{r.contactPerson || '—'}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={STATUS_TONE[r.status] || 'default'}>{r.status}</Badge>
          {r.overdue && <Badge tone="danger">Overdue</Badge>}
        </div>
      ),
    },
    { key: 'totalAmount', header: 'Total Budget', render: (r) => formatCurrency(r.totalAmount) },
    { key: 'billed', header: 'Billed', render: (r) => formatCurrency(r.billed) },
    { key: 'paid', header: 'Paid', render: (r) => <span className="text-success">{formatCurrency(r.paid)}</span> },
    { key: 'pending', header: 'Pending', render: (r) => <span className={r.pending > 0 ? 'text-warning' : ''}>{formatCurrency(r.pending)}</span> },
    {
      key: 'balance', header: 'Balance',
      render: (r) => <span className={r.balance > 0 ? 'font-semibold text-danger' : 'text-muted'}>{formatCurrency(r.balance)}</span>,
    },
    { key: 'next', header: 'Next Due', render: (r) => (r.next ? formatDate(r.nextDueDate) : '—') },
  ]

  return (
    <div>
      <PageHeader
        title="Client Pay/Balance"
        subtitle="Budgets, invoices and balances for every client — the same figures the Client Portal shows."
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Clients" value={data?.totalClients ?? 0} icon={FiUsers} />
        <StatCard label="Contracted (Budget)" value={data?.totalBudget ?? 0} format={formatCurrency} icon={FiFileText} tone="primary" />
        <StatCard label="Total Billed" value={data?.totalBilled ?? 0} format={formatCurrency} icon={FiFileText} tone="accent" />
        <StatCard label="Paid Amount" value={data?.totalPaid ?? 0} format={formatCurrency} icon={FiCheckCircle} tone="success" />
        <StatCard label="Pending Amount" value={data?.totalPending ?? 0} format={formatCurrency} icon={FiClock} tone={(data?.totalPending ?? 0) > 0 ? 'warning' : 'success'} />
        <StatCard label="Outstanding Balance" value={data?.totalBalance ?? 0} format={formatCurrency} icon={FiCreditCard} tone={(data?.totalBalance ?? 0) > 0 ? 'danger' : 'success'} />
        <StatCard label="Clients w/ Balance" value={data?.clientsWithBalance ?? 0} icon={FiAlertCircle} tone={(data?.clientsWithBalance ?? 0) > 0 ? 'warning' : 'default'} />
        <StatCard label="Clients Overdue" value={data?.clientsOverdue ?? 0} icon={FiAlertCircle} tone={(data?.clientsOverdue ?? 0) > 0 ? 'danger' : 'default'} />
      </div>

      <Card>
        <div className="mb-3 max-w-xs">
          <SearchInput value={search} onChange={setSearch} placeholder="Search client or contact…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No client billing records" description={search ? 'No clients match your search.' : 'Provision a client to see their billing here.'} />
        ) : (
          <DataTable columns={columns} data={rows} empty="No clients match your filters" />
        )}
      </Card>
    </div>
  )
}