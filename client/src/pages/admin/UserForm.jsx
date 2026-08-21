import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiArrowLeft } from 'react-icons/fi'
import { PageHeader, Card, Button, Loader, EmptyState } from '@/components/ui'
import { adminApi } from '@/api/adminApi'
import { employeeApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { ALL_ROLES } from '@/constants'
import { UserFormFields } from '@/features/admin/UserFormFields'
import {
  validateUserForm, buildUserPayload, toUserFormValues, blankUserForm,
  STAFF_FORM_ROLES,
} from '@/features/admin/userForm'
import ClientCreateForm from '@/pages/clients/ClientForm'
import UserWizard from '@/features/admin/UserWizard'

export default function UserForm() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, hasRole } = useAuth()
  const { notify } = useNotifications()
  const [searchParams] = useSearchParams()
  const { id } = useParams()
  const isEdit = Boolean(id)
  const mode = isEdit ? 'edit' : 'add'
  const requestedRole = searchParams.get('role')
  const presetRole = ALL_ROLES.includes(requestedRole) ? requestedRole : ''
  const returnTo = searchParams.get('returnTo') || ''
  const [form, setForm] = useState(blankUserForm(presetRole ? { role: presetRole } : {}))
  // The write gate mirrors the server's CREATE_ROLE_MATRIX (Admin: every role,
  // Manager: 'Employee' only). This page is the ONE create form everywhere —
  // /admin/users/new and /employees/new both render it — so a Manager must be
  // allowed through for the staff wizard while staying blocked for Admin/Client
  // targets, exactly as userController.canTarget() enforces server-side.
  const canWrite = hasRole(ADMIN_WRITE_ROLES) || (
    !isEdit && user?.role === 'Manager' && STAFF_FORM_ROLES.includes(form.role)
  )
  // Managers may only ever pick 'Employee' (server caps the create payload the
  // same way); Admins may pick any staff role in the wizard.
  const creatableRoles = user?.role === 'Manager' ? ['Employee'] : STAFF_FORM_ROLES
  const [errors, setErrors] = useState({})
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const { data: existing, isLoading: loadingUser, isError } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => adminApi.users.get(id),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) setForm(toUserFormValues(existing))
  }, [existing?.id || existing?._id])

  const backToList = () => navigate(returnTo === 'employees' ? '/employees' : '/admin/users')
  const afterSave = () => (isEdit ? navigate(`/admin/users/${id}`) : backToList())

  const saveMutation = useMutation({
    mutationFn: (payload) => {
      if (isEdit) return adminApi.users.update(id, payload)
      // Managers provision through the employee endpoint — forceEmployeeRole +
      // CREATE_ROLE_MATRIX cap it at 'Employee' server-side, so a Manager can
      // never create an Admin/Manager/Client account. Admin uses the full
      // user endpoint. Both endpoints run the SAME createUser controller.
      return user?.role === 'Manager'
        ? employeeApi.create(payload)
        : adminApi.users.create(payload)
    },
    onSuccess: (_d, payload) => {
      if (isEdit) {
        notify({ type: 'admin', title: 'User updated', body: `${payload.name.trim()} was updated.` })
        qc.invalidateQueries({ queryKey: ['admin-users'] })
        qc.invalidateQueries({ queryKey: ['admin-user', id] })
        toast.success('Changes saved')
        afterSave()
        return
      }
      const name = payload.name.trim()
      notify({ type: 'admin', title: 'User created', body: `${name} was added as ${payload.role}.` })
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['employee-stats'] })
      if (returnTo === 'employees' || payload.role === 'Employee') {
        navigate(`/employees?new=${encodeURIComponent(payload.email.trim())}`)
        return
      }
      if (payload.role === 'Client') qc.invalidateQueries({ queryKey: ['admin-clients'] })
      toast.success('User created — they can log in now')
      backToList()
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || 'Could not save user'
      if (/already registered/i.test(msg)) setErrors((s) => ({ ...s, email: msg }))
      toast.error(msg)
    },
  })

  const submit = (ev) => {
    ev.preventDefault()
    const found = validateUserForm(form, mode)
    setErrors(found)
    if (Object.keys(found).length === 0) saveMutation.mutate(buildUserPayload(form, mode))
  }

  if (!isEdit && presetRole === 'Client') return <ClientCreateForm />

  if (!isEdit && STAFF_FORM_ROLES.includes(form.role)) {
    if (!canWrite) {
      return (
        <div>
          <PageHeader title="Add User" />
          <Card>
            <p className="text-sm text-muted">
              You do not have permission to create users.
            </p>
          </Card>
        </div>
      )
    }
    return (
      <div>
        <PageHeader
          title={presetRole ? `Add ${presetRole}` : 'Add Employee'}
          subtitle={presetRole
            ? `Creates a ${presetRole} account, its login and HR profile.`
            : 'Creates a staff account, its login and HR profile.'}
          actions={(
            <Button variant="ghost" icon={FiArrowLeft} onClick={backToList}>
              {returnTo === 'employees' ? 'Back to employees' : 'Back to users'}
            </Button>
          )}
        />
        <UserWizard
          presetRole={presetRole}
          creatableRoles={creatableRoles}
          onSubmit={(payload) => saveMutation.mutate(payload)}
          onCancel={backToList}
          saving={saveMutation.isPending}
        />
      </div>
    )
  }

  if (!canWrite) {
    return (
      <div>
        <PageHeader title={isEdit ? 'Edit User' : 'New User'} />
        <Card>
          <p className="text-sm text-muted">
            You do not have permission to {isEdit ? 'edit' : 'create'} users.
          </p>
        </Card>
      </div>
    )
  }

  if (isEdit && loadingUser) return <Loader label="Loading user…" />
  if (isEdit && (isError || !existing)) {
    return (
      <div>
        <PageHeader title="Edit User" actions={<Button variant="ghost" icon={FiArrowLeft} onClick={backToList}>Back to users</Button>} />
        <Card>
          <EmptyState title="No such user" description="This account may have been deleted." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? `Edit ${existing?.name || 'User'}` : (presetRole ? `Add ${presetRole}` : 'Add User')}
        subtitle={isEdit
          ? 'Update this account. Changes are saved to this user — a new account is never created.'
          : presetRole
            ? `Creates a ${presetRole} account and its login.`
            : 'Create an account and its login. The role decides which fields apply.'}
        actions={(
          <Button variant="ghost" icon={FiArrowLeft} onClick={isEdit ? afterSave : backToList}>
            {isEdit ? 'Back to profile' : 'Back to users'}
          </Button>
        )}
      />

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UserFormFields
            form={form}
            setField={setField}
            errors={errors}
            mode={mode}
            lockRole={!isEdit && !!presetRole}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-app pt-4 sm:col-span-2">
            <Button type="submit" loading={saveMutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create User'}
            </Button>
            <Button type="button" variant="ghost" onClick={isEdit ? afterSave : backToList}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
