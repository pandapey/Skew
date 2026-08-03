import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiFileText, FiDownload } from 'react-icons/fi'
import { hrApi } from '@/api/services'
import {
  PageHeader, Card, DataTable, Pagination, SearchInput, Select, Badge,
  StatCard, Modal, Button,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { DEPARTMENTS } from '@/features/hr/constants'
import { formatCurrency } from '@/utils'
import { exportToPdf } from '@/utils/export'
import { COMPANY_NAME } from '@/constants'

export default function Payroll() {
  const [params, setParams] = useState({ search: '', department: '', page: 1, limit: 8 })
  const [slip, setSlip] = useState(null)
  const debounced = useDebounce(params.search)

  const { data, isLoading } = useQuery({
    queryKey: ['hr-payroll', { ...params, search: debounced }],
    queryFn: () => hrApi.payroll.query({ ...params, search: debounced }),
  })
  const rows = data?.data ?? []
  const totalNet = rows.reduce((s, r) => s + r.net, 0)

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  // Single salary-slip PDF.
  const downloadSlip = (p) => {
    exportToPdf(
      `salary-slip-${p.empCode}.pdf`,
      [
        { k: 'Basic', v: formatCurrency(p.basic) },
        { k: 'HRA', v: formatCurrency(p.hra) },
        { k: 'Allowances', v: formatCurrency(p.allowances) },
        { k: 'PF (deduction)', v: `- ${formatCurrency(p.pf)}` },
        { k: 'Tax (deduction)', v: `- ${formatCurrency(p.tax)}` },
        { k: 'Net Pay', v: formatCurrency(p.net) },
      ],
      [{ header: 'Component', accessor: 'k' }, { header: 'Amount', accessor: 'v' }],
      { title: `Salary Slip — ${p.employee} (${p.month})`, subtitle: p.empCode }
    )
    toast.success('Salary slip downloaded')
  }

  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <div><p className="font-medium">{r.employee}</p><p className="text-xs text-muted">{r.empCode}</p></div> },
    { key: 'department', header: 'Department' },
    { key: 'gross', header: 'Gross', render: (r) => formatCurrency(r.gross) },
    { key: 'net', header: 'Net Pay', render: (r) => <span className="font-semibold text-success">{formatCurrency(r.net)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
    { key: '_slip', header: '', className: 'text-right', render: (r) => (
      <button onClick={() => setSlip(r)} className="chip bg-primary/10 text-primary hover:bg-primary/20">Salary Slip</button>
    ) },
  ]

  return (
    <div>
      <PageHeader title="Payroll" subtitle="Monthly salary processing and slips."
        actions={<ExportMenu rows={rows} filename="payroll" title="Payroll — July 2026"
          columns={[
            { header: 'Employee', accessor: 'employee' }, { header: 'Code', accessor: 'empCode' },
            { header: 'Department', accessor: 'department' }, { header: 'Gross', accessor: (r) => formatCurrency(r.gross) },
            { header: 'Net', accessor: (r) => formatCurrency(r.net) }, { header: 'Status', accessor: 'status' },
          ]} />} />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Employees" value={data?.total ?? '—'} icon={FiFileText} />
        <StatCard label="Net Payout (page)" value={formatCurrency(totalNet)} icon={FiFileText} tone="success" />
        <StatCard label="Paid" value={rows.filter((r) => r.status === 'Paid').length} icon={FiFileText} tone="accent" />
        <StatCard label="Pending" value={rows.filter((r) => r.status === 'Pending').length} icon={FiFileText} tone="warning" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          <Select className="lg:w-44" value={params.department} onChange={(e) => setParam({ department: e.target.value })}
            options={[{ value: '', label: 'All Departments' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]} />
          <span className="text-sm text-muted lg:ml-auto">Month: July 2026</span>
        </div>
        <DataTable columns={columns} data={rows} loading={isLoading} />
        <div className="flex justify-end"><Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} /></div>
      </Card>

      {/* Salary slip modal */}
      <Modal open={!!slip} onClose={() => setSlip(null)} title="Salary Slip" size="md"
        footer={<><Button variant="ghost" onClick={() => setSlip(null)}>Close</Button><Button icon={FiDownload} onClick={() => downloadSlip(slip)}>Download PDF</Button></>}>
        {slip && (
          <div>
            <div className="mb-4 rounded-xl bg-primary/5 p-4">
              <p className="text-sm text-muted">{COMPANY_NAME}</p>
              <p className="text-lg font-bold">{slip.employee}</p>
              <p className="text-sm text-muted">{slip.designation} · {slip.department} · {slip.month}</p>
            </div>
            <div className="space-y-2">
              {[['Basic', slip.basic], ['HRA', slip.hra], ['Allowances', slip.allowances], ['PF', -slip.pf], ['Tax', -slip.tax]].map(([k, v]) => (
                <div key={k} className="flex justify-between rounded-lg border border-app p-2.5 text-sm">
                  <span>{k}</span><span className={v < 0 ? 'text-danger' : ''}>{formatCurrency(v)}</span>
                </div>
              ))}
              <div className="flex justify-between rounded-lg bg-success/10 p-3 font-semibold text-success">
                <span>Net Pay</span><span>{formatCurrency(slip.net)}</span>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
