import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FiPlus, FiEdit2, FiTrash2, FiEye, FiUsers, FiUserX, FiGrid } from 'react-icons/fi'
import { employeeApi, attendanceApi } from '@/api/services'
import { useDebounce } from '@/hooks/useDebounce'
import {
  PageHeader, Card, Button, DataTable, Pagination, Badge, Avatar,
  ConfirmDialog, StatCard,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { EmployeeFilters } from '@/features/employees/EmployeeFilters'
import { BulkActionBar } from '@/features/employees/BulkActionBar'
import { employeeExportColumns } from '@/features/employees/exportColumns'
import { EMPLOYEE_CREATE_ROLES, EMPLOYEE_EDIT_ROLES } from '@/features/employees/permissions'
import { formatCurrency, formatDate, cn } from '@/utils'
import { useAuth } from '@/hooks/useAuth'

const DEFAULT_FILTERS = { search: '', department: '', status: '', sortBy: 'name', order: 'asc', page: 1, limit: 8 }

export default function Employees() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canCreate = hasRole(EMPLOYEE_CREATE_ROLES)
  const canEdit = hasRole(EMPLOYEE_EDIT_ROLES)
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightEmail = searchParams.get('new') || ''
  const highlightRef = useRef(null)

  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [selected, setSelected] = useState([])
  const [deleting, setDeleting] = useState(null)
  const [bulkDelete, setBulkDelete] = useState(false)

  const debouncedSearch = useDebounce(filters.search)
  const queryParams = { ...filters, search: debouncedSearch }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['employees', queryParams],
    queryFn: () => employeeApi.query(queryParams),
    placeholderData: keepPreviousData,
  })

  const { data: stats } = useQuery({ queryKey: ['employee-stats'], queryFn: employeeApi.stats })

  const { data: attStats } = useQuery({ queryKey: ['attendance-stats'], queryFn: attendanceApi.stats })

  const rows = (data?.data ?? []).map((r) => ({ ...r, id: r.id || r._id }))
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['employees'] })
    qc.invalidateQueries({ queryKey: ['employee-stats'] })
  }

  const deleteMutation = useMutation({
    mutationFn: (id) => employeeApi.remove(id),
    onSuccess: () => { toast.success('Employee removed'); setDeleting(null); setSelected((s) => s.filter((x) => x !== deleting?.id)); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => employeeApi.bulkRemove(ids),
    onSuccess: (res) => { toast.success(`${res.deleted} employees deleted`); setSelected([]); setBulkDelete(false); invalidate() },
  })

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }) => employeeApi.bulkUpdate(ids, { status }),
    onSuccess: (res) => { toast.success(`${res.updated} employees updated`); setSelected([]); invalidate() },
  })

  // --- Selection helpers ---
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id))
  const toggleAll = () => setSelected(allChecked ? selected.filter((id) => !rows.some((r) => r.id === id)) : [...new Set([...selected, ...rows.map((r) => r.id)])])
  const toggleOne = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const openCreate = () => navigate('/employees/new?returnTo=employees')
  const openEdit = (emp) => navigate(`/employees/${emp.empCode || emp.id}/edit`)

  useEffect(() => {
    if (!highlightEmail) return
    toast.success('Employee created successfully.')
    const t = setTimeout(() => setSearchParams({}, { replace: true }), 6000)
    return () => clearTimeout(t)
  }, [highlightEmail, setSearchParams])

  useEffect(() => {
    if (highlightEmail && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightEmail, data])

  const columns = useMemo(() => [
    {
      key: 'select', header: <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded" checked={allChecked} onChange={toggleAll} />,
      className: 'w-10',
      render: (r) => (
        <input type="checkbox" className="h-4 w-4 rounded" checked={selected.includes(r.id)}
          onClick={(e) => e.stopPropagation()} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.name}`} />
      ),
    },
    {
      key: 'name', header: 'Employee',
      render: (r) => {
        const isNew = highlightEmail && r.email && r.email.toLowerCase() === highlightEmail.toLowerCase()
        return (
          <div ref={isNew ? highlightRef : null} className={cn('-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors', isNew && 'bg-primary/10 ring-1 ring-primary/40')}>
            <Avatar name={r.name} src={r.avatar} size={36} />
            <div>
              <p className="font-medium">{r.name}{isNew && <span className="ml-2 align-middle"><Badge tone="success">New</Badge></span>}</p>
              <p className="text-xs text-muted">{r.empCode}</p>
            </div>
          </div>
        )
      },
    },
    { key: 'department', header: 'Department' },
    { key: 'designation', header: 'Designation' },
    { key: 'salary', header: 'CTC', render: (r) => formatCurrency(typeof r.salary === 'object' ? r.salary.ctc : r.salary) },
    { key: 'joiningDate', header: 'Joined', render: (r) => formatDate(r.joiningDate) },
    { key: 'status', header: 'Status', render: (r) => (
      <span title={`Account status: ${r.status}`}>
        <Badge>{r.attendanceStatus || r.status}</Badge>
      </span>
    ) },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="rounded-lg p-2 hover:bg-accent/10 hover:text-accent" onClick={() => navigate(`/employees/${r.empCode || r.id}`)} aria-label="View"><FiEye /></button>
          {canEdit && <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => openEdit(r)} aria-label="Edit"><FiEdit2 /></button>}
          <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => setDeleting(r)} aria-label="Delete"><FiTrash2 /></button>
        </div>
      ),
    },
  ], [allChecked, selected, rows, highlightEmail])

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Manage your organization's people, records and documents."
        actions={
          <>
            <Button variant="ghost" icon={FiGrid} onClick={() => navigate('/employees/dashboard')}>Dashboard</Button>
            <ExportMenu rows={rows} columns={employeeExportColumns} filename="employees" title="Employee Directory" subtitle={`${data?.total || 0} records`} />
            {canCreate && <Button icon={FiPlus} onClick={openCreate}>Add Employee</Button>}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={stats?.total ?? '—'} icon={FiUsers} />
        <StatCard label="Absent Today" value={attStats?.absent ?? '—'} icon={FiUserX} tone="danger" />
        <StatCard label="On Leave" value={stats?.onLeave ?? '—'} icon={FiUserX} tone="warning" />
        <StatCard label="Avg Salary" value={stats ? formatCurrency(stats.avgSalary) : '—'} icon={FiUsers} tone="accent" />
      </div>

      <Card>
        <EmployeeFilters filters={filters} onChange={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)} />

        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-2 top-2 z-10"><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary block" /></div>
          )}
          <DataTable columns={columns} data={rows} loading={isLoading} empty="No employees match your filters" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{data?.total || 0} employees · page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={filters.page} totalPages={data?.totalPages || 1} onChange={(p) => setFilters((f) => ({ ...f, page: p }))} />
        </div>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete employee?"
        message={`This will permanently remove ${deleting?.name} from the system.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={bulkDelete}
        onClose={() => setBulkDelete(false)}
        onConfirm={() => bulkDeleteMutation.mutate(selected)}
        title={`Delete ${selected.length} employees?`}
        message="This will permanently remove all selected employees."
        confirmLabel="Delete All"
        loading={bulkDeleteMutation.isPending}
      />

      <BulkActionBar
        count={selected.length}
        onClear={() => setSelected([])}
        onDelete={() => setBulkDelete(true)}
        onSetStatus={(status) => bulkStatusMutation.mutate({ ids: selected, status })}
      />
    </div>
  )
}
