import { EntityManager } from '@/features/hr/EntityManager'
import { hrApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { departmentSchema } from '@/features/hr/schemas'
import { DEPARTMENTS, HR_WRITE_ROLES } from '@/features/hr/constants'
import { formatCurrency } from '@/utils'

export default function Departments() {
  const columns = [
    { key: 'name', header: 'Department', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'code', header: 'Code', render: (r) => <Badge tone="accent">{r.code}</Badge> },
    { key: 'head', header: 'Department Head' },
    { key: 'headcount', header: 'Headcount' },
    { key: 'budget', header: 'Annual Budget', render: (r) => formatCurrency(r.budget) },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  return (
    <EntityManager
      title="Departments"
      writeRoles={HR_WRITE_ROLES}
      subtitle="Organizational structure, heads and budgets."
      api={hrApi.departments}
      queryKey="hr-departments"
      columns={columns}
      schema={departmentSchema}
      defaultValues={{ name: '', code: '', head: '', budget: 0, status: 'Active' }}
      fields={[
        { name: 'name', label: 'Department Name' },
        { name: 'code', label: 'Code' },
        { name: 'head', label: 'Department Head' },
        { name: 'budget', label: 'Annual Budget (₹)', type: 'number' },
        { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
      ]}
      exportColumns={[
        { header: 'Name', accessor: 'name' }, { header: 'Code', accessor: 'code' },
        { header: 'Head', accessor: 'head' }, { header: 'Headcount', accessor: 'headcount' },
        { header: 'Budget', accessor: (r) => formatCurrency(r.budget) },
      ]}
      filename="departments"
    />
  )
}
