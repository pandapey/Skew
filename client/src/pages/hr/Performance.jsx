import { useQuery } from '@tanstack/react-query'
import { EntityManager } from '@/features/hr/EntityManager'
import { hrApi, employeeApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { reviewSchema } from '@/features/hr/schemas'
import { HR_WRITE_ROLES } from '@/features/hr/constants'

export default function Performance() {
  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => (
      <span className="font-medium">{r.employee}{r.employeeCode ? <span className="ml-1 text-xs text-muted">({r.employeeCode})</span> : null}</span>
    ) },
    { key: 'department', header: 'Department' },
    { key: 'period', header: 'Period' },
    { key: 'reviewer', header: 'Reviewer' },
    { key: 'rating', header: 'Rating', render: (r) => <Badge tone={r.rating >= 4 ? 'success' : r.rating >= 3 ? 'accent' : 'warning'}>{r.rating} ★</Badge> },
    { key: 'goalCompletion', header: 'Goals', render: (r) => (
      <div className="flex items-center gap-2">
        <div className="h-2 w-20 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-primary" style={{ width: `${r.goalCompletion}%` }} /></div>
        <span className="text-xs text-muted">{r.goalCompletion}%</span>
      </div>
    ) },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  const { data: deptData = [], isLoading: deptLoading } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
  })
  const deptOptions = (Array.isArray(deptData) ? deptData : [])
    .map((d) => d?.name)
    .filter(Boolean)

  const { data: empData = [], isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeApi.query({ limit: 100 }),
    staleTime: 60_000,
  })
  const employees = Array.isArray(empData?.data) ? empData.data : []
  const empOptions = employees.map((e) => ({ value: e.name, label: `${e.name} (${e.empCode || '—'})` }))

  const onPickEmployee = (form, value) => {
    const emp = employees.find((e) => e.name === value)
    if (!emp) return
    form.setValue('employeeId', emp.id || emp._id || '', { shouldValidate: true, shouldDirty: true })
    form.setValue('employeeCode', emp.empCode || '', { shouldValidate: true, shouldDirty: true })
    if (emp.department) form.setValue('department', emp.department, { shouldValidate: true, shouldDirty: true })
  }

  return (
    <EntityManager
      title="Performance Reviews"
      writeRoles={HR_WRITE_ROLES}
      subtitle="Appraisals, ratings and goal tracking."
      api={hrApi.reviews}
      queryKey="hr-reviews"
      columns={columns}
      schema={reviewSchema}
      defaultValues={{ employee: '', department: '', period: 'Q3 2026', reviewer: '', rating: 4, goalCompletion: 80, status: 'Pending', comments: '', strengths: '', areasForImprovement: '' }}
      filters={[{ name: 'department', label: 'All Departments', options: deptOptions }, { name: 'status', label: 'All Status', options: ['Completed', 'In Progress', 'Pending'] }]}
      fields={[
        {
          name: 'employee', label: 'Employee', type: 'select', searchable: true,
          placeholder: empLoading ? 'Loading employees…' : 'Search employee…',
          emptyText: 'No employees found',
          onSelect: onPickEmployee,
        },
        { name: 'department', label: 'Department', type: 'select', placeholder: deptLoading ? 'Loading…' : 'Select department', emptyText: 'No departments yet' },
        { name: 'period', label: 'Review Period' },
        { name: 'reviewer', label: 'Reviewer' },
        { name: 'rating', label: 'Rating (0-5)', type: 'number' },
        { name: 'goalCompletion', label: 'Goal Completion (%)', type: 'number' },
        { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Completed'] },
        { name: 'comments', label: 'Comments', type: 'textarea', full: true },
        { name: 'strengths', label: 'Strengths', type: 'textarea', full: true },
        { name: 'areasForImprovement', label: 'Areas for Improvement', type: 'textarea', full: true },
      ]}
      fieldOptions={{ employee: { options: empOptions, loading: empLoading }, department: { options: deptOptions.map((n) => ({ value: n, label: n })), loading: deptLoading } }}
      exportColumns={[
        { header: 'Employee', accessor: 'employee' }, { header: 'Period', accessor: 'period' },
        { header: 'Rating', accessor: 'rating' }, { header: 'Goals %', accessor: 'goalCompletion' }, { header: 'Status', accessor: 'status' },
      ]}
      filename="performance-reviews"
    />
  )
}
