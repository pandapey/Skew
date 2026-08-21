import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiFileText, FiDownload, FiSave, FiPlus, FiUsers, FiCheck } from 'react-icons/fi'
import { hrApi, employeeApi } from '@/api/services'
import {
  PageHeader, Card, CardHeader, DataTable, Pagination, SearchInput, Select, Badge,
  StatCard, Modal, Button, Input, ConfirmDialog,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency, formatDate } from '@/utils'
import { exportToPdf } from '@/utils/export'
import { COMPANY_NAME } from '@/constants'

const PAYROLL_CONFIG_ROLES = ['Admin', 'Manager']

export default function Payroll() {
  const [params, setParams] = useState({ search: '', department: '', status: '', page: 1, limit: 8 })
  const [slip, setSlip] = useState(null)
  const [runOpen, setRunOpen] = useState(false)
  const [runForm, setRunForm] = useState({ employee: '', month: '', bonus: '', otherDeductions: '' })
  const [payTarget, setPayTarget] = useState(null)
  const debounced = useDebounce(params.search)
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canConfigure = hasRole(PAYROLL_CONFIG_ROLES)
  const { data: empRes } = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => employeeApi.query({ limit: 1000 }),
    staleTime: 60_000,
  })
  const employeeOptions = (empRes?.data || []).map((e) => ({ value: e._id || e.id, label: `${e.name} (${e.empCode || ''})`, dept: e.department }))
  const selectedEmp = (empRes?.data || []).find((e) => String(e._id || e.id) === runForm.employee)
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  const { data: empPayrollRes } = useQuery({
    queryKey: ['hr-payroll', 'for-employee', runForm.employee],
    queryFn: () => hrApi.payroll.query({ search: selectedEmp?.name, limit: 100 }),
    enabled: !!runForm.employee,
    staleTime: 30_000,
  })
  const runMonths = new Set((empPayrollRes?.data || []).map((r) => r.month))

  const buildMonthOptions = () => {
    const now = new Date()
    const start = selectedEmp?.joiningDate ? new Date(selectedEmp.joiningDate) : new Date(2020, 0, 1)
    const options = []
    for (let y = start.getFullYear(), m = start.getMonth(); y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth()); m += 1) {
      if (m === 12) { m = 0; y += 1 }
      const label = `${MONTH_NAMES[m]} ${y}`
      if (!runMonths.has(label)) options.push({ value: label, label })
    }
    return options.reverse()
  }
  const monthOptions = buildMonthOptions()
  const runPayrollMutation = useMutation({
    mutationFn: (payload) => hrApi.payroll.run(payload),
    onSuccess: (result) => {
      toast.success(`Payroll created for ${result?.employee || 'employee'} (${result?.month})`)
      setRunOpen(false)
      setRunForm({ employee: '', month: '', bonus: '', otherDeductions: '' })
      qc.invalidateQueries({ queryKey: ['hr-payroll'] })
      qc.invalidateQueries({ queryKey: ['my-salary'] })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to run payroll'),
  })

  const markPaidMutation = useMutation({
    mutationFn: (row) => hrApi.payroll.update(row.id, { status: 'Paid', payment_date: new Date().toISOString() }),
    onSuccess: (updated) => {
      toast.success(`Payment recorded for ${updated?.employee || 'employee'} (${updated?.month || ''})`)
      setPayTarget(null)
      qc.invalidateQueries({ queryKey: ['hr-payroll'] })
      qc.invalidateQueries({ queryKey: ['my-salary'] })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Failed to mark as paid'),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['hr-payroll', { ...params, search: debounced }],
    queryFn: () => hrApi.payroll.query({ ...params, search: debounced }),
  })
  const rows = data?.data ?? []
  const totalNet = rows.reduce((s, r) => s + r.net, 0)
  const { data: deptData = [] } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
  })
  const departmentOptions = deptData.map((d) => d?.name).filter(Boolean)
  const periods = [...new Set(rows.map((r) => r.month).filter(Boolean))]
  const periodLabel = periods.length === 1 ? periods[0] : periods.length ? `${periods.length} periods` : '—'

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))

  const downloadSlip = (p) => {
    exportToPdf(
      `salary-slip-${p.empCode}.pdf`,
      [
        { k: 'Gross', v: formatCurrency(p.monthly) },
        { k: 'Basic (50% of Gross)', v: formatCurrency(p.basic) },
        { k: 'PF (deduction)', v: `- ${formatCurrency(p.pf)}` },
        { k: 'ESI (deduction)', v: `- ${formatCurrency(p.esi)}` },
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
    { key: 'month', header: 'Month' },
    { key: 'gross', header: 'Gross', render: (r) => formatCurrency(r.gross) },
    { key: 'pf', header: 'PF', render: (r) => <span className="text-danger">- {formatCurrency(r.pf)}</span> },
    { key: 'esi', header: 'ESI', render: (r) => <span className="text-danger">- {formatCurrency(r.esi)}</span> },
    { key: 'lwp', header: 'LOP', render: (r) => `${r.lwp_days || 0} day(s)` },
    { key: 'total_deductions', header: 'Total Deductions', render: (r) => <span className="text-danger">- {formatCurrency(r.total_deductions)}</span> },
    { key: 'netSalary', header: 'Net Salary', render: (r) => formatCurrency(r.net) },
    { key: 'net', header: 'Final Payable', render: (r) => <span className="font-semibold text-success">{formatCurrency((r.net || 0) + (r.bonus || 0))}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'Paid' ? 'success' : 'warning'}>{r.status}</Badge> },
    { key: '_slip', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-2">
        <button onClick={() => setSlip(r)} className="chip bg-primary/10 text-primary hover:bg-primary/20">Salary Slip</button>
        {canConfigure && r.status === 'Pending' && (
          <button onClick={() => setPayTarget(r)} className="chip bg-success/10 text-success hover:bg-success/20"><FiCheck className="mr-1 inline" />Mark Paid</button>
        )}
      </div>
    ) },
  ]

  return (
    <div>
      <PageHeader title="Payroll" subtitle="Monthly salary processing and slips."
        actions={
          <>
            {canConfigure && <Button icon={FiPlus} onClick={() => setRunOpen(true)}>Run Payroll</Button>}
            <ExportMenu rows={rows} filename="payroll" title={`Payroll — ${periodLabel}`}
              columns={[
                { header: 'Employee', accessor: 'employee' }, { header: 'Code', accessor: 'empCode' },
                { header: 'Department', accessor: 'department' }, { header: 'Month', accessor: 'month' },
                { header: 'Gross', accessor: (r) => formatCurrency(r.gross) },
                { header: 'Final Payable', accessor: (r) => formatCurrency((r.net || 0) + (r.bonus || 0)) }, { header: 'Status', accessor: 'status' },
              ]} />
          </>
        } />

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
            options={[{ value: '', label: 'All Departments' }, ...departmentOptions.map((d) => ({ value: d, label: d }))]} />
          <Select className="lg:w-40" value={params.status} onChange={(e) => setParam({ status: e.target.value })}
            options={[{ value: '', label: 'All Statuses' }, { value: 'Pending', label: 'Pending' }, { value: 'Paid', label: 'Paid' }]} />
          <span className="text-sm text-muted lg:ml-auto">Month: {periodLabel}</span>
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
              {[
                ['Gross', slip.monthly],
                ['Basic (50% of Gross)', slip.basic],
                ['PF', -slip.pf],
                ['ESI', -slip.esi],
                ...(slip.lwp_days ? [['LOP', -(slip.lwp_deduction || 0)]] : []),
                ...(slip.total_deductions ? [['Total Deductions', -slip.total_deductions]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between rounded-lg border border-app p-2.5 text-sm">
                  <span>{k}</span><span className={v < 0 ? 'text-danger' : ''}>{formatCurrency(v)}</span>
                </div>
              ))}
              <div className="flex justify-between rounded-lg bg-success/10 p-3 font-semibold text-success">
                <span>Net Pay (after deductions)</span><span>{formatCurrency(slip.net)}</span>
              </div>
              {Number(slip.bonus) > 0 && (
                <div className="flex justify-between rounded-lg border border-app p-3 text-sm font-semibold">
                  <span>Final Payable (incl. bonus)</span>
                  <span>{formatCurrency((slip.net || 0) + (slip.bonus || 0))}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* PHASE PAYROLL (TASK 4): Run Payroll modal */}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title="Run Payroll" size="md"
        footer={<>
          <Button variant="ghost" onClick={() => setRunOpen(false)}>Cancel</Button>
          <Button loading={runPayrollMutation.isPending} onClick={() => {
            if (!runForm.employee || !runForm.month) {
              toast.error('Select an employee and enter a month')
              return
            }
            runPayrollMutation.mutate({
              employee: runForm.employee,
              month: runForm.month,
              bonus: Number(runForm.bonus) || 0,
              otherDeductions: Number(runForm.otherDeductions) || 0,
            })
          }}>Run Payroll</Button>
        </>}>
        <div className="space-y-4">
          <Select
            label="Employee"
            placeholder="Select employee"
            value={runForm.employee}
            onChange={(e) => setRunForm((p) => ({ ...p, employee: e.target.value, month: '' }))}
            options={[{ value: '', label: 'Select employee' }, ...employeeOptions.map((o) => ({ value: o.value, label: o.label }))]}
          />
          <Select
            label="Payroll Month"
            placeholder="Select month"
            value={runForm.month}
            disabled={!runForm.employee}
            onChange={(e) => setRunForm((p) => ({ ...p, month: e.target.value }))}
            options={[
              { value: '', label: monthOptions.length ? 'Select month…' : (selectedEmp ? 'No eligible months' : 'Select an employee first') },
              ...monthOptions,
            ]}
          />
          {selectedEmp?.joiningDate && (
            <p className="text-xs text-muted">
              Eligible from {formatDate(selectedEmp.joiningDate, 'MMMM YYYY')} to the current month.
            </p>
          )}
          <Input
            label="Bonus (₹)"
            type="number"
            value={runForm.bonus}
            onChange={(e) => setRunForm((p) => ({ ...p, bonus: e.target.value }))}
          />
          <Input
            label="Other Deductions (₹)"
            type="number"
            value={runForm.otherDeductions}
            onChange={(e) => setRunForm((p) => ({ ...p, otherDeductions: e.target.value }))}
          />
          <p className="text-xs text-muted">Computed from the employee's salary structure and attendance via the payroll engine. The month list runs from the employee's joining month to the current month, and months that already have a payroll record are excluded — the backend rejects a duplicate run with a 409 as the final gate.</p>
        </div>
      </Modal>

      {/* PHASE ADMIN/HR PAYROLL (TASK 3): payment confirmation. */}
      <ConfirmDialog
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        onConfirm={() => markPaidMutation.mutate(payTarget)}
        title="Mark as Paid?"
        message={`Record payment for ${payTarget?.employee} (${payTarget?.month})? The payslip status will change to Paid and the payment date will be stamped.`}
        confirmLabel="Mark as Paid"
        danger={false}
        loading={markPaidMutation.isPending}
      />
    </div>
  )
}
