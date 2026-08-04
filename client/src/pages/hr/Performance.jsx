import { EntityManager } from '@/features/hr/EntityManager'
import { hrApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { reviewSchema } from '@/features/hr/schemas'
import { DEPARTMENTS, HR_WRITE_ROLES } from '@/features/hr/constants'

export default function Performance() {
  const columns = [
    { key: 'employee', header: 'Employee', render: (r) => <span className="font-medium">{r.employee}</span> },
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
  return (
    <EntityManager
      title="Performance Reviews"
      // Phase 5.9 (Task 7): explicit instead of relying on EntityManager's
      // implicit HR_WRITE_ROLES default. Same effective permission.
      writeRoles={HR_WRITE_ROLES}
      subtitle="Appraisals, ratings and goal tracking."
      api={hrApi.reviews}
      queryKey="hr-reviews"
      columns={columns}
      schema={reviewSchema}
      defaultValues={{ employee: '', department: 'Engineering', period: 'Q3 2026', reviewer: '', rating: 4, goalCompletion: 80, status: 'Pending' }}
      filters={[{ name: 'department', label: 'All Departments', options: DEPARTMENTS }, { name: 'status', label: 'All Status', options: ['Completed', 'In Progress', 'Pending'] }]}
      fields={[
        { name: 'employee', label: 'Employee' },
        { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
        { name: 'period', label: 'Review Period' },
        { name: 'reviewer', label: 'Reviewer' },
        { name: 'rating', label: 'Rating (0-5)', type: 'number' },
        { name: 'goalCompletion', label: 'Goal Completion (%)', type: 'number' },
        { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'In Progress', 'Completed'] },
      ]}
      exportColumns={[
        { header: 'Employee', accessor: 'employee' }, { header: 'Period', accessor: 'period' },
        { header: 'Rating', accessor: 'rating' }, { header: 'Goals %', accessor: 'goalCompletion' }, { header: 'Status', accessor: 'status' },
      ]}
      filename="performance-reviews"
    />
  )
}
