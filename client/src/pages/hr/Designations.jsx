import { EntityManager } from '@/features/hr/EntityManager'
import { hrApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { designationSchema } from '@/features/hr/schemas'
import { DEPARTMENTS, LEVELS, GRADES, HR_WRITE_ROLES } from '@/features/hr/constants'

export default function Designations() {
  const columns = [
    { key: 'title', header: 'Designation', render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'department', header: 'Department' },
    { key: 'level', header: 'Level', render: (r) => <Badge tone="primary">{r.level}</Badge> },
    { key: 'grade', header: 'Grade', render: (r) => <Badge tone="accent">{r.grade}</Badge> },
    { key: 'count', header: 'Employees' },
  ]
  return (
    <EntityManager
      title="Designations"
      // Phase 5.9 (Task 7): explicit instead of relying on EntityManager's
      // implicit HR_WRITE_ROLES default. Same effective permission.
      writeRoles={HR_WRITE_ROLES}
      subtitle="Roles, levels and pay grades across the org."
      api={hrApi.designations}
      queryKey="hr-designations"
      columns={columns}
      schema={designationSchema}
      defaultValues={{ title: '', department: 'Engineering', level: 'L2', grade: 'G3' }}
      filters={[{ name: 'department', label: 'All Departments', options: DEPARTMENTS }]}
      fields={[
        { name: 'title', label: 'Designation Title' },
        { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
        { name: 'level', label: 'Level', type: 'select', options: LEVELS },
        { name: 'grade', label: 'Grade', type: 'select', options: GRADES },
      ]}
      exportColumns={[
        { header: 'Title', accessor: 'title' }, { header: 'Department', accessor: 'department' },
        { header: 'Level', accessor: 'level' }, { header: 'Grade', accessor: 'grade' },
      ]}
      filename="designations"
    />
  )
}
