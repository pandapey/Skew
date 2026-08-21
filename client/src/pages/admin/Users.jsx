import { useState, useEffect, useMemo, useCallback } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiPlus, FiEdit2, FiTrash2, FiKey, FiShield, FiRefreshCw, FiCheckCircle,
  FiEye, FiColumns, FiCopy, FiUserCheck, FiUserX, FiLock,
} from 'react-icons/fi'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select,
  Modal, Badge, Avatar, ConfirmDialog, Dropdown, DropdownItem,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { adminApi } from '@/api/adminApi'
import { ALL_ROLES } from '@/constants'
import { USER_STATUSES, USER_DEPARTMENTS, ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { validatePassword } from '@/features/admin/password'
import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
import { UserFormFields } from '@/features/admin/UserFormFields'
import { validateUserForm, buildUserPayload, toUserFormValues } from '@/features/admin/userForm'
import { formatDate, formatDateTime, cn } from '@/utils'

const STATUS_TONE = {
  Active: 'success', Inactive: 'default', Suspended: 'warning', Pending: 'primary', Blocked: 'danger',
}
const MASTER_COLUMNS = [
  {
    key: 'name', header: 'User', sortable: true, sortKey: 'name',
    render: (r) => (
      <div className="flex items-center gap-3">
        <Avatar name={r.name} src={r.avatar} size={36} />
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-xs text-muted">{r.email}</p>
        </div>
      </div>
    ),
  },
  {
    key: 'empCode', header: 'ID / Code', sortable: true, sortKey: 'empCode',
    render: (r) => {
      const code = r.empCode || r.clientCode
      return code ? <span className="font-mono text-xs">{code}</span> : <span className="text-muted">—</span>
    },
  },
  {
    key: 'role', header: 'Role', sortable: true, sortKey: 'role',
    render: (r) => (
      <span className="inline-flex items-center gap-1"><FiShield className="text-muted" aria-hidden="true" />{r.role}</span>
    ),
  },
  {
    key: 'department', header: 'Department', sortable: true, sortKey: 'department',
    render: (r) => r.department || <span className="text-muted">—</span>,
  },
  {
    key: 'designation', header: 'Designation', sortable: true, sortKey: 'designation',
    render: (r) => r.designation || <span className="text-muted">—</span>,
  },
  {
    key: 'status', header: 'Status', sortable: true, sortKey: 'status',
    render: (r) => <Badge tone={STATUS_TONE[r.status] || 'default'}>{r.status}</Badge>,
  },
  {
    key: 'lastLogin', header: 'Last Login', sortable: true, sortKey: 'lastLogin',
    render: (r) => <span className="text-muted">{r.lastLogin ? formatDateTime(r.lastLogin) : 'Never'}</span>,
  },
  {
    key: 'createdAt', header: 'Created', sortable: true, sortKey: 'createdAt',
    render: (r) => <span className="text-muted">{formatDate(r.createdAt)}</span>,
  },
]

const exportColumns = [
  { header: 'Name', accessor: 'name' },
  { header: 'Email', accessor: 'email' },
  { header: 'ID / Code', accessor: (r) => r.empCode || r.clientCode || '' },
  { header: 'Role', accessor: 'role' },
  { header: 'Department', accessor: 'department' },
  { header: 'Designation', accessor: 'designation' },
  { header: 'Status', accessor: 'status' },
  { header: 'Last Login', accessor: (r) => r.lastLogin || '' },
  { header: 'Created', accessor: (r) => r.createdAt || '' },
]

export default function Users() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const { notify } = useNotifications()
  const canWrite = hasRole(ADMIN_WRITE_ROLES)
  const [searchParams, setSearchParams] = useSearchParams()
  const [params, , , setParams] = useViewState('params', { search: '', role: '', status: '', department: '', sortBy: 'createdAt', order: 'desc', page: 1, limit: 8 })
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(toUserFormValues({ name: '', email: '', role: 'Employee' }))
  const [errors, setErrors] = useState({})
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [resetMode, setResetMode] = useState('generate')
  const [resetPw, setResetPw] = useState('')
  const [resetErrors, setResetErrors] = useState({})
  const [resetResult, setResetResult] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [selectedRows, setSelectedRows] = useState(() => new Map())
  const [hidden, setHidden] = useState(() => new Set())

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-users', queryParams],
    queryFn: () => adminApi.users.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = (role) => navigate(role ? `/admin/users/new?role=${role}` : '/admin/users/new')
  const openEdit = (r) => {
    setEditing(r)
    setForm(toUserFormValues(r))
    setErrors({}); setModal('edit')
  }
  const openReset = (r) => { setEditing(r); setResetMode('generate'); setResetPw(''); setResetErrors({}); setResetResult(''); setModal('reset') }

  const closeReset = () => { setModal(null); setResetResult('') }

  useEffect(() => {
    const add = searchParams.get('add')
    if (!add) return
    const explicitReturn = searchParams.get('returnTo')
    setSearchParams({}, { replace: true })
    if (add === 'client') {
      navigate(`/clients/new${explicitReturn ? `?returnTo=${explicitReturn}` : ''}`, { replace: true })
      return
    }
    const role = add === 'employee' ? 'Employee' : (searchParams.get('role') || 'Employee')
    const back = explicitReturn || (add === 'employee' ? 'employees' : '')
    navigate(`/admin/users/new?role=${encodeURIComponent(role)}${back ? `&returnTo=${back}` : ''}`, { replace: true })
  }, [])
  const saveMutation = useMutation({
    mutationFn: () => adminApi.users.update(editing.id, buildUserPayload(form, 'edit')),
    onSuccess: () => {
      const statusChanged = editing && editing.status !== form.status
      const roleChanged = editing && editing.role !== form.role
      if (statusChanged) notify({ type: 'admin', title: 'Status changed', body: `${form.name.trim()} is now ${form.status}.` })
      if (roleChanged) notify({ type: 'admin', title: 'Role changed', body: `${form.name.trim()} is now ${form.role}.` })
      setModal(null); invalidate()
      toast.success('User updated')
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || 'Could not save user'
      if (/already registered/i.test(msg)) setErrors((s) => ({ ...s, email: msg }))
      toast.error(msg)
    },
  })

  const resetMutation = useMutation({
    mutationFn: () => adminApi.users.resetPassword(editing.id, resetMode === 'generate' ? { generateTemp: true } : { newPassword: resetPw }),
    onSuccess: (res) => {
      const temp = res?.temporaryPassword
      if (temp) {
        setResetResult(temp)
        toast.success('Temporary password generated')
      } else {
        toast.success('Password updated')
        closeReset()
      }
      if (editing) notify({ type: 'admin', title: 'Password reset', body: `Password for ${editing.name} was reset.` })
      invalidate()
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || 'Reset failed'
      setResetErrors({ password: msg }); toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.users.remove(id),
    onSuccess: () => { toast.success('User deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }) => adminApi.users.bulkUpdate(ids, { status }),
    onSuccess: (_, v) => {
      toast.success(`${v.ids.length} user${v.ids.length > 1 ? 's' : ''} set to ${v.status}`)
      notify({ type: 'admin', title: 'Bulk status update', body: `${v.ids.length} users set to ${v.status}.` })
      setSelected(new Set()); setSelectedRows(new Map()); invalidate()
    },
    onError: () => toast.error('Bulk update failed'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => adminApi.users.bulkRemove(ids),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} user${ids.length > 1 ? 's' : ''} deleted`)
      notify({ type: 'admin', title: 'Bulk delete', body: `${ids.length} users were removed.` })
      setSelected(new Set()); setSelectedRows(new Map()); setBulkDeleting(false); invalidate()
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || 'Bulk delete failed'
      toast.error(msg)
      setBulkDeleting(false)
    },
  })
  const submit = (ev) => {
    ev.preventDefault()
    const found = validateUserForm(form, 'edit')
    setErrors(found)
    if (Object.keys(found).length === 0) saveMutation.mutate()
  }
  const submitReset = (ev) => {
    ev.preventDefault()
    if (resetMode === 'manual') {
      const { valid } = validatePassword(resetPw)
      if (!valid) { setResetErrors({ password: 'Password must be 8–64 chars with upper, lower, number & special' }); return }
    }
    setResetErrors({}); resetMutation.mutate()
  }
  const copyReset = async () => {
    try { await navigator.clipboard.writeText(resetResult); toast.success('Copied to clipboard') }
    catch { toast.error('Copy failed') }
  }

  const onSort = useCallback((key) => {
    setParams((p) => {
      if (p.sortBy !== key) return { ...p, sortBy: key, order: 'asc', page: 1 }
      return { ...p, order: p.order === 'asc' ? 'desc' : 'asc', page: 1 }
    })
  }, [])

  const onRowSelect = useCallback((id, checked, row) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
    setSelectedRows((prev) => {
      const next = new Map(prev)
      if (checked && row) next.set(id, row); else next.delete(id)
      return next
    })
  }, [])

  const onSelectAll = useCallback((checked) => {
    if (checked) {
      const ids = new Set(selected)
      const map = new Map(selectedRows)
      rows.forEach((r) => { ids.add(r.id); map.set(r.id, r) })
      setSelected(ids); setSelectedRows(map)
    } else {
      setSelected(new Set()); setSelectedRows(new Map())
    }
  }, [rows, selected, selectedRows])

  const clearSelection = () => { setSelected(new Set()); setSelectedRows(new Map()) }

  const toggleHidden = (key) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const onView = useCallback((r) => navigate(`/admin/users/${r.id}`), [navigate])
  const onReset = useCallback((r) => openReset(r), [])
  const onEdit = useCallback((r) => openEdit(r), [])
  const onDelete = useCallback((r) => setDeleting(r), [])

  // Build the visible columns (+ always-on actions column).
  const columns = useMemo(() => {
    const visible = MASTER_COLUMNS.filter((c) => !hidden.has(c.key))
    const actions = canWrite
      ? [{
          key: '_actions', header: 'Actions', className: 'text-right',
          render: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => onView(r)} title="View profile" aria-label={`View ${r.name}`}><FiEye /></button>
              <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => onReset(r)} title="Reset password" aria-label={`Reset password for ${r.name}`}><FiKey /></button>
              <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => onEdit(r)} title="Edit" aria-label={`Edit ${r.name}`}><FiEdit2 /></button>
              <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => onDelete(r)} title="Delete" aria-label={`Delete ${r.name}`}><FiTrash2 /></button>
            </div>
          ),
        }]
      : []
    return [...visible, ...actions]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, canWrite, onView, onReset, onEdit, onDelete])

  const selectedRowsArray = useMemo(() => Array.from(selectedRows.values()), [selectedRows])
  const selectedCount = selected.size

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage accounts, roles, and secure access."
        actions={
          <>
            <Dropdown
              align="right"
              trigger={<span className={`btn-ghost ${!rows.length ? 'pointer-events-none opacity-50' : ''}`}><FiColumns className="h-4 w-4" /> Columns</span>}
            >
              {MASTER_COLUMNS.map((c) => (
                <DropdownItem key={c.key} onClick={() => toggleHidden(c.key)} active={!hidden.has(c.key)}>
                  <span className="flex items-center gap-2">
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded border', hidden.has(c.key) ? 'border-app' : 'border-primary bg-primary text-white')}>
                      {!hidden.has(c.key) && <FiCheckCircle className="h-3 w-3" />}
                    </span>
                    {c.header}
                  </span>
                </DropdownItem>
              ))}
            </Dropdown>
            <ExportMenu rows={rows} columns={exportColumns} filename="users" title="Users" subtitle="Skew Enterprise Hub" />
            {canWrite && (
              <Dropdown
                align="right"
                trigger={<span className="btn-primary"><FiPlus className="h-4 w-4" /> Add User</span>}
              >
                <DropdownItem onClick={() => openCreate('')}>New user (choose role)</DropdownItem>
                {ALL_ROLES.map((r) => (
                  <DropdownItem key={r} onClick={() => openCreate(r)}>Add {r}</DropdownItem>
                ))}
              </Dropdown>
            )}
          </>
        }
      />

      <Card>
        {/* Bulk action bar */}
        {canWrite && selectedCount > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-card border border-primary/30 bg-primary/[0.05] p-3 sm:flex-row sm:items-center">
            <span className="text-sm font-medium text-primary">{selectedCount} selected</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={FiUserCheck} onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: 'Active' })}>Activate</Button>
              <Button size="sm" variant="ghost" icon={FiUserX} onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: 'Inactive' })}>Deactivate</Button>
              <Button size="sm" variant="ghost" icon={FiLock} onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: 'Suspended' })}>Suspend</Button>
              {selectedRowsArray.length > 0 && (
                <ExportMenu rows={selectedRowsArray} columns={exportColumns} filename="users-selected" title="Selected Users" subtitle="Skew Enterprise Hub" />
              )}
              <Button size="sm" variant="danger" icon={FiTrash2} onClick={() => setBulkDeleting(true)}>Delete</Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          <Select value={params.role} onChange={(e) => setParam({ role: e.target.value })} className="lg:w-44"
            options={[{ value: '', label: 'All Roles' }, ...ALL_ROLES.map((r) => ({ value: r, label: r }))]} />
          <Select value={params.status} onChange={(e) => setParam({ status: e.target.value })} className="lg:w-44"
            options={[{ value: '', label: 'All Status' }, ...USER_STATUSES.map((s) => ({ value: s, label: s }))]} />
          <Select value={params.department} onChange={(e) => setParam({ department: e.target.value })} className="lg:w-44"
            options={[{ value: '', label: 'All Departments' }, ...USER_DEPARTMENTS.map((d) => ({ value: d, label: d }))]} />
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-2 top-2 z-10">
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
            </div>
          )}
          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            empty="No users found"
            selectable={canWrite}
            selectedIds={Array.from(selected)}
            onRowSelect={(id, checked) => {
              const row = rows.find((r) => r.id === id)
              onRowSelect(id, checked, row)
            }}
            onSelectAll={onSelectAll}
            getRowId={(r) => r.id}
            sort={{ key: params.sortBy, order: params.order }}
            onSort={onSort}
            onRowClick={canWrite ? onView : undefined}
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      <Modal
        open={modal === 'edit'}
        onClose={() => setModal(null)}
        title="Edit User"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={saveMutation.isPending} onClick={submit}>Save Changes</Button>
          </>
        }
      >
        {modal === 'edit' ? (
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UserFormFields
              form={form}
              setField={setField}
              errors={errors}
              mode="edit"
              enabled={modal === 'edit'}
            />
          </form>
        ) : null}
      </Modal>

      {/* Reset password modal */}
      <Modal
        open={modal === 'reset'}
        onClose={closeReset}
        title={`Reset Password — ${editing?.name || ''}`}
        footer={
          resetResult ? null : (
            <>
              <Button variant="ghost" onClick={closeReset}>Cancel</Button>
              <Button loading={resetMutation.isPending} onClick={submitReset}>{resetMode === 'generate' ? 'Generate & Reset' : 'Set Password'}</Button>
            </>
          )
        }
      >
        {resetResult ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">A temporary password was generated. Share it with the user securely, then ask them to change it on next login.</p>
            <div className="flex items-center gap-2 rounded-xl border border-app bg-black/[0.02] px-3 py-2.5 dark:bg-white/[0.03]">
              <code className="flex-1 select-all font-mono text-sm">{resetResult}</code>
              <Button variant="ghost" size="sm" icon={FiCopy} onClick={copyReset}>Copy</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" icon={FiRefreshCw} onClick={submitReset} loading={resetMutation.isPending}>Regenerate</Button>
              <Button onClick={closeReset}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={resetMode === 'generate' ? 'primary' : 'ghost'} onClick={() => setResetMode('generate')} icon={FiRefreshCw}>Generate temporary</Button>
              <Button variant={resetMode === 'manual' ? 'primary' : 'ghost'} onClick={() => setResetMode('manual')}>Enter manually</Button>
            </div>
            {resetMode === 'generate' ? (
              <p className="text-sm text-muted">A strong temporary password will be generated and shown to you. Share it with the user securely.</p>
            ) : (
              <>
                <PasswordField label="New Password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} error={resetErrors.password} />
                <PasswordStrength value={resetPw} />
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete user?"
        message={`Remove ${deleting?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={bulkDeleting}
        onClose={() => setBulkDeleting(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selected))}
        title="Delete selected users?"
        message={`Remove ${selectedCount} user${selectedCount > 1 ? 's' : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={bulkDeleteMutation.isPending}
      />
    </div>
  )
}
