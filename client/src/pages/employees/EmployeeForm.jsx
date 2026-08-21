import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiArrowLeft } from 'react-icons/fi'
import { employeeApi } from '@/api/services'
import { PageHeader, Card, Button, Loader, EmptyState } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { employeeSchema, employeeCreateSchema } from '@/features/employees/schema'
import {
  EmployeeFormFields, EMPLOYEE_FORM_DEFAULTS, toEmployeeFormValues,
} from '@/features/employees/EmployeeFormFields'
import {
  employeeFieldPermissions, stripUnauthorizedEmployeeFields,
} from '@/features/employees/permissions'
import {
  toEmployeeCreatePayload, toEmployeeUpdatePayload,
} from '@/features/employees/employeePayload'

export default function EmployeeForm() {
  const { id } = useParams()
  const isCreate = !id
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const mode = isCreate ? 'create' : 'edit'
  const permissions = employeeFieldPermissions(user?.role, mode)

  const form = useForm({
    resolver: zodResolver(isCreate ? employeeCreateSchema : employeeSchema),
    defaultValues: EMPLOYEE_FORM_DEFAULTS,
  })

  const { data: employee, isLoading, isError } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeeApi.get(id),
    enabled: !isCreate,
  })

  useEffect(() => {
    if (isCreate) {
      form.reset({ ...EMPLOYEE_FORM_DEFAULTS })
      return
    }
    if (employee) form.reset(toEmployeeFormValues(employee))
  }, [isCreate, employee])

  const backToList = () => navigate('/employees')

  const createMutation = useMutation({
    mutationFn: (values) =>
      employeeApi.create(toEmployeeCreatePayload(stripUnauthorizedEmployeeFields(values, user?.role, 'create'))),
    onSuccess: (_res, values) => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['employee-stats'] })
      navigate(`/employees?new=${encodeURIComponent(String(values.email || '').trim())}`)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not create employee'),
  })

  const saveMutation = useMutation({
    mutationFn: (values) =>
      employeeApi.update(id, toEmployeeUpdatePayload(stripUnauthorizedEmployeeFields(values, user?.role, 'edit'))),
    onSuccess: () => {
      toast.success('Employee updated')
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['employee-stats'] })
      qc.invalidateQueries({ queryKey: ['employee', id] })
      navigate(`/employees/${id}`)
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save employee'),
  })

  const submit = form.handleSubmit((values) =>
    (isCreate ? createMutation : saveMutation).mutate(values))
  const saving = isCreate ? createMutation.isPending : saveMutation.isPending

  if (!isCreate && isLoading) return <Loader label="Loading employee…" />
  if (!isCreate && (isError || !employee)) {
    return (
      <div>
        <PageHeader title="Edit Employee" />
        <Card>
          <EmptyState
            title="Employee not found"
            description="This record may have been removed."
            action={<Button className="mt-3" onClick={backToList}>Back to List</Button>}
          />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={isCreate ? 'Add Employee' : 'Edit Employee'}
        subtitle={isCreate
          ? 'Creates the employee record and their login. Fields marked with an error must be corrected before saving.'
          : employee?.name}
        actions={<Button variant="ghost" icon={FiArrowLeft} onClick={backToList}>Back to list</Button>}
      />

      <Card>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <EmployeeFormFields
            form={form}
            mode={mode}
            permissions={permissions}
            empCode={employee?.empCode}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-app pt-4 sm:col-span-2">
            <Button type="submit" loading={saving}>
              {isCreate ? 'Create Employee' : 'Save Changes'}
            </Button>
            <Button type="button" variant="ghost" onClick={backToList}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
