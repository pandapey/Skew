import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiArrowLeft, FiEdit2, FiKey, FiTrash2, FiShield, FiRefreshCw, FiCopy,
  FiUpload, FiX,
} from 'react-icons/fi'
import {
  PageHeader, Card, CardHeader, Button, DataTable, Modal, Input, Select,
  Badge, Avatar, ConfirmDialog, Tabs, ProgressBar, EmptyState, Loader,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { adminApi } from '@/api/adminApi'
import { ALL_ROLES, ROLES } from '@/constants'
import { USER_STATUSES, USER_DEPARTMENTS, ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { validatePassword } from '@/features/admin/password'
import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
import { PermissionsList } from '@/features/admin/PermissionsList'
import { formatDate, formatDateTime, cn } from '@/utils'

const STATUS_TONE = {
  Active: 'success', Inactive: 'default', Suspended: 'warning', Pending: 'primary', Blocked: 'danger',
}
const LOGIN_TONE = { Success: 'success', Failed: 'danger', Blocked: 'danger' }
const SEV_TONE = { Info: 'success', Warning: 'warning', Critical: 'danger' }

const emptyForm = {
  name: '', email: '', phone: '', department: '', designation: '', employeeId: '',
  role: 'Employee', status: 'Active', avatar: '',
  // Phase 6.9 (TASK 10 + TASK 11): `accountManager` and `clientStatus` removed,
  // matching the blank form shape in admin/Users.jsx.
  clientMode: 'new', clientId: '', clientCompany: '',
}

// Phase 6.9 (TASK 13): this page addressed the loaded user as `editing._id`
// while the Users table addressed the same record as `r.id`. The server now
// returns BOTH (see userController.withId), but reading through one helper
// means neither key can drift again and the page keeps working whichever one
// a given endpoint happens to send.
const idOf = (u) => u?.id || u?._id || ''

function ProfileImageField({ value, onChange }) {
  const [preview, setPreview] = useState(value)
  const fileRef = useRef(null)
  useEffect(() => setPreview(value), [value])
  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast.error('Use a JPG, PNG or WEBP image'); return }
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => { setPreview(reader.result); onChange(reader.result) }
    reader.readAsDataURL(file)
  }
  return (
    <div className="flex items-center gap-4">
      <Avatar name="" src={preview || undefined} size={56} ring={false} />
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
        <Button type="button" variant="ghost" size="sm" icon={FiUpload} onClick={() => fileRef.current?.click()}>Upload</Button>
        {preview && (
          <Button type="button" variant="ghost" size="sm" icon={FiX} onClick={() => { setPreview(undefined); onChange('') }}>Remove</Button>
        )}
      </div>
      <p className="text-xs text-muted">JPG, PNG or WEBP · max 2 MB</p>
    </div>
  )
}

export default function UserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const { notify } = useNotifications()
  const canWrite = hasRole(ADMIN_WRITE_ROLES)

  const [tab, setTab] = useState('overview')
  const [modal, setModal] = useState(null) // 'edit' | 'reset'
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [deleting, setDeleting] = useState(false)
  const [resetMode, setResetMode] = useState('generate')
  const [resetPw, setResetPw] = useState('')
  const [resetErrors, setResetErrors] = useState({})
  const [resetResult, setResetResult] = useState('')

  const userQuery = useQuery({ queryKey: ['admin-user', id], queryFn: () => adminApi.users.get(id) })
  const permsQuery = useQuery({ queryKey: ['admin-permissions'], queryFn: adminApi.permissions.get })
  const loginQuery = useQuery({ queryKey: ['user-login', id], queryFn: () => adminApi.users.loginHistory(id) })
  const auditQuery = useQuery({ queryKey: ['user-audit', id], queryFn: () => adminApi.users.auditHistory(id) })
  const projectsQuery = useQuery({ queryKey: ['user-projects', id], queryFn: () => adminApi.users.assignedProjects(id) })
  const activityQuery = useQuery({ queryKey: ['user-activity', id], queryFn: () => adminApi.users.activity(id) })

  const user = userQuery.data
  const isClient = user?.role === ROLES.CLIENT

  const projects = projectsQuery.data || []
  const activity = activityQuery.data || []

  // Notes — persisted on the user record in MongoDB (no localStorage).
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (user) setNotes(user.notes || '')
  }, [idOf(user)])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] })
    qc.invalidateQueries({ queryKey: ['admin-user', id] })
  }

  const notesMutation = useMutation({
    mutationFn: () => adminApi.users.update(id, { notes }),
    onSuccess: () => { toast.success('Notes saved'); invalidate() },
    onError: () => toast.error('Could not save notes'),
  })
  const saveNotes = () => notesMutation.mutate()

  const openEdit = (u) => {
    setForm({
      ...emptyForm,
      name: u.name, email: u.email, phone: u.phone || '', department: u.department || '',
      designation: u.designation || '', employeeId: u.employeeId || '', role: u.role, status: u.status || 'Active',
      avatar: u.avatar || '',
      clientMode: u.clientId ? 'existing' : 'new', clientId: u.clientId || '',
      clientCompany: '',
    })
    setEditing(u)
    setErrors({}); setModal('edit')
  }
  const openReset = (u) => { setResetMode('generate'); setResetPw(''); setResetErrors({}); setResetResult(''); setEditing(u); setModal('reset') }
  const [editing, setEditing] = useState(null)

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const validate = () => {
    const e = {}
    if (!form.name || form.name.trim().length < 2) e.name = 'Full name is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(), email: form.email.trim(), phone: form.phone,
        department: form.department, designation: form.designation, employeeId: form.employeeId,
        role: form.role, status: form.status, avatar: form.avatar || undefined,
      }
      return adminApi.users.update(idOf(editing), payload)
    },
    onSuccess: () => {
      const statusChanged = editing && editing.status !== form.status
      const roleChanged = editing && editing.role !== form.role
      toast.success('User updated')
      if (statusChanged) notify({ type: 'admin', title: 'Status changed', body: `${form.name.trim()} is now ${form.status}.` })
      if (roleChanged) notify({ type: 'admin', title: 'Role changed', body: `${form.name.trim()} is now ${form.role}.` })
      setModal(null); invalidate()
    },
    onError: () => toast.error('Could not save user'),
  })

  const resetMutation = useMutation({
    mutationFn: () => adminApi.users.resetPassword(idOf(editing), resetMode === 'generate' ? { generateTemp: true } : { newPassword: resetPw }),
    onSuccess: (res) => {
      const temp = res?.temporaryPassword
      if (temp) { setResetResult(temp); toast.success('Temporary password generated') }
      else { toast.success('Password updated'); setModal(null) }
      if (editing) notify({ type: 'admin', title: 'Password reset', body: `Password for ${editing.name} was reset.` })
      invalidate()
    },
    onError: (err) => { const msg = err?.response?.data?.message || 'Reset failed'; setResetErrors({ password: msg }); toast.error(msg) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => adminApi.users.remove(idOf(editing)),
    onSuccess: () => { toast.success('User deleted'); navigate('/admin/users') },
    onError: () => toast.error('Delete failed'),
  })

  const submit = (ev) => { ev.preventDefault(); if (validate()) saveMutation.mutate() }
  const submitReset = (ev) => {
    ev.preventDefault()
    if (resetMode === 'manual') {
      const { valid } = validatePassword(resetPw)
      if (!valid) { setResetErrors({ password: 'Password must be 8–64 chars with upper, lower, number & special' }); return }
    }
    setResetErrors({}); resetMutation.mutate()
  }
  const copyReset = async () => {
    try { await navigator.clipboard.writeText(resetResult); toast.success('Copied to clipboard') } catch { toast.error('Copy failed') }
  }
  const closeReset = () => { setModal(null); setResetResult('') }

  if (userQuery.isLoading) return <Loader label="Loading user…" />
  if (!user) {
    return (
      <div>
        <PageHeader title="User not found" />
        <Card><EmptyState title="No such user" description="This account may have been deleted." action={<Button icon={FiArrowLeft} onClick={() => navigate('/admin/users')}>Back to Users</Button>} /></Card>
      </div>
    )
  }

  const code = user.employeeId || user.clientCode
  const loginRows = loginQuery.data || []
  const auditRows = auditQuery.data || []

  const loginCols = [
    { key: 'date', header: 'Date', render: (r) => <span className="text-muted">{r.date}</span> },
    { key: 'time', header: 'Time', render: (r) => <span className="font-mono text-xs">{r.time}</span> },
    { key: 'browser', header: 'Browser', render: (r) => r.browser },
    { key: 'os', header: 'OS', render: (r) => r.os },
    { key: 'ip', header: 'IP Address', render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={LOGIN_TONE[r.status] || 'default'}>{r.status}</Badge> },
  ]
  const auditCols = [
    { key: 'time', header: 'Time', render: (r) => <span className="text-muted">{formatDateTime(r.time)}</span> },
    { key: 'action', header: 'Action', render: (r) => r.action },
    { key: 'module', header: 'Module', render: (r) => <Badge tone="primary">{r.module}</Badge> },
    { key: 'severity', header: 'Severity', render: (r) => <Badge tone={SEV_TONE[r.severity] || 'default'}>{r.severity}</Badge> },
    { key: 'ip', header: 'IP', render: (r) => <span className="font-mono text-xs">{r.ip}</span> },
  ]

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'projects', label: 'Projects' },
    { key: 'activity', label: 'Activity' },
    { key: 'audit', label: 'Audit History' },
    { key: 'login', label: 'Login History' },
    { key: 'notes', label: 'Notes' },
  ]

  return (
    <div>
      <PageHeader
        title={user.name}
        subtitle={user.email}
        actions={
          <>
            <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/admin/users')}>Back</Button>
            {canWrite && (
              <>
                <Button variant="ghost" icon={FiKey} onClick={() => openReset(user)}>Reset Password</Button>
                <Button icon={FiEdit2} onClick={() => openEdit(user)}>Edit</Button>
              </>
            )}
          </>
        }
      />

      {/* Identity header */}
      <Card className="mb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar name={user.name} src={user.avatar} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">{user.name}</h2>
              <Badge tone="primary"><FiShield className="h-3 w-3" /> {user.role}</Badge>
              <Badge tone={STATUS_TONE[user.status] || 'default'}>{user.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{user.email}{user.phone ? ` · ${user.phone}` : ''}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {code && <span><span className="font-medium text-foreground">ID:</span> <span className="font-mono">{code}</span></span>}
              {user.department && <span><span className="font-medium text-foreground">Dept:</span> {user.department}</span>}
              {user.designation && <span><span className="font-medium text-foreground">Role:</span> {user.designation}</span>}
              {user.createdAt && <span><span className="font-medium text-foreground">Joined:</span> {formatDate(user.createdAt)}</span>}
              {user.lastLogin && <span><span className="font-medium text-foreground">Last login:</span> {formatDateTime(user.lastLogin)}</span>}
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4 overflow-x-auto">
        <Tabs items={TABS} value={tab} onChange={setTab} className="min-w-max" />
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Personal Information" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Full Name</dt><dd className="font-medium">{user.name}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Email</dt><dd className="font-medium">{user.email}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Phone</dt><dd className="font-medium">{user.phone || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Employee ID</dt><dd className="font-medium">{user.employeeId || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Client Code</dt><dd className="font-medium">{user.clientCode || '—'}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Employment Information" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Role</dt><dd className="font-medium">{user.role}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Department</dt><dd className="font-medium">{user.department || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Designation</dt><dd className="font-medium">{user.designation || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd><Badge tone={STATUS_TONE[user.status] || 'default'}>{user.status}</Badge></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Created</dt><dd className="font-medium">{formatDate(user.createdAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Last Login</dt><dd className="font-medium">{user.lastLogin ? formatDateTime(user.lastLogin) : 'Never'}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Permissions" subtitle={`Access for ${user.role}`} />
            <PermissionsList matrix={permsQuery.data} role={user.role} />
          </Card>
        </div>
      )}

      {/* Projects */}
      {tab === 'projects' && (
        <Card>
          <CardHeader title="Assigned Projects" subtitle="Projects this user participates in" />
          {projects.length === 0 ? (
            <EmptyState title="No projects assigned" />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {projects.map((p) => (
                <div key={p._id} className="rounded-card border border-app p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{p.name}</p>
                    <Badge tone={p.status === 'Active' ? 'success' : p.status === 'Completed' ? 'primary' : 'warning'}>{p.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">Role: {p.role}</p>
                  <div className="mt-3"><ProgressBar value={p.progress} showLabel height="h-1.5" /></div>
                  {p.due && <p className="mt-1.5 text-xs text-muted">Due {formatDate(p.due)}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Activity */}
      {tab === 'activity' && (
        <Card>
          <CardHeader title="Recent Activity" />
          {activity.length === 0 ? (
            <EmptyState title="No recent activity" />
          ) : (
            <ul className="space-y-3">
              {activity.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-primary/60" />
                  <div className="min-w-0">
                    <p className="text-sm">{a.action}{a.target ? ` — ${a.target}` : ''}</p>
                    <p className="text-xs text-muted">{a.createdAt ? formatDateTime(a.createdAt) : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Audit History */}
      {tab === 'audit' && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <CardHeader title="Audit History" subtitle="Administrative actions for this user" className="mb-0" />
            <ExportMenu rows={auditRows} columns={[
              { header: 'Time', accessor: 'time' }, { header: 'Action', accessor: 'action' },
              { header: 'Module', accessor: 'module' }, { header: 'Severity', accessor: 'severity' }, { header: 'IP', accessor: 'ip' },
            ]} filename="user-audit" title={`Audit — ${user.name}`} subtitle="Skew Enterprise Hub" />
          </div>
          <DataTable columns={auditCols} data={auditRows} loading={auditQuery.isLoading} empty="No audit records" />
        </Card>
      )}

      {/* Login History */}
      {tab === 'login' && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <CardHeader title="Login History" subtitle="Recent sign-in attempts" className="mb-0" />
            <ExportMenu rows={loginRows} columns={[
              { header: 'Date', accessor: 'date' }, { header: 'Time', accessor: 'time' },
              { header: 'Browser', accessor: 'browser' }, { header: 'OS', accessor: 'os' },
              { header: 'IP', accessor: 'ip' }, { header: 'Status', accessor: 'status' },
            ]} filename="user-logins" title={`Logins — ${user.name}`} subtitle="Skew Enterprise Hub" />
          </div>
          <DataTable columns={loginCols} data={loginRows} loading={loginQuery.isLoading} empty="No login records" />
        </Card>
      )}

      {/* Notes */}
      {tab === 'notes' && (
        <Card>
          <CardHeader title="Notes" subtitle="Private notes, stored in MongoDB" />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="Add notes about this user…"
            className="input w-full resize-y"
            aria-label="User notes"
          />
          <div className="mt-3 flex justify-end">
            <Button onClick={saveNotes}>Save Notes</Button>
          </div>
        </Card>
      )}

      {/* Edit modal */}
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
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Phase 6.9 (TASK 12): Role leads this form too, so the edit dialog
              matches the create dialog in admin/Users.jsx. */}
          <Select label="Role" value={form.role} onChange={(e) => setField('role', e.target.value)} options={ALL_ROLES.map((r) => ({ value: r, label: r }))} className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-muted">Profile Image</label>
            <ProfileImageField value={form.avatar} onChange={(v) => setField('avatar', v)} />
          </div>
          <Input label="Full Name" placeholder=" " value={form.name} onChange={(e) => setField('name', e.target.value)} error={errors.name} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} error={errors.email} placeholder="jane@skew.com" />
          <Input label="Phone Number" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+91 …" />
          <Input label="Employee ID" value={form.employeeId} onChange={(e) => setField('employeeId', e.target.value)} placeholder="EMP-1042" disabled={isClient} />
          <Input label="Department" value={form.department} onChange={(e) => setField('department', e.target.value)} placeholder="Engineering" />
          <Input label="Designation" value={form.designation} onChange={(e) => setField('designation', e.target.value)} placeholder="Manager" />
          <Select label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)} options={USER_STATUSES.map((s) => ({ value: s, label: s }))} className="sm:col-span-2" />
        </form>
      </Modal>

      {/* Reset modal */}
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
            <p className="text-sm text-muted">A temporary password was generated. Share it with the user securely.</p>
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
              <p className="text-sm text-muted">A strong temporary password will be generated and shown to you.</p>
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
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete user?"
        message={`Remove ${user.name}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />

      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button variant="danger" icon={FiTrash2} onClick={() => { setEditing(user); setDeleting(true) }}>Delete User</Button>
        </div>
      )}
    </div>
  )
}
