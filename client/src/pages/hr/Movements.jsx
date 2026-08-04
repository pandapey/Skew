import { EntityManager } from '@/features/hr/EntityManager'
import { hrApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { movementSchema } from '@/features/hr/schemas'
import { DEPARTMENTS, MOVEMENT_TYPES, MOVEMENT_STATUS, HR_WRITE_ROLES } from '@/features/hr/constants'
import { formatDate } from '@/utils'

const TYPE_TONE = { Promotion: 'success', Transfer: 'accent', Resignation: 'warning', Exit: 'danger' }

// Covers Promotion, Transfer, Resignation and Exit process in one lifecycle view.
export default function Movements() {
  const columns = [
    { key: 'type', header: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge> },
    { key: 'employee', header: 'Employee', render: (r) => <span className="font-medium">{r.employee}</span> },
    { key: 'department', header: 'Department' },
    { key: 'from', header: 'From' },
    { key: 'to', header: 'To' },
    { key: 'effectiveDate', header: 'Effective', render: (r) => formatDate(r.effectiveDate) },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  return (
    <EntityManager
      title="Transfers & Exits"
      // Phase 5.9 (Task 7): explicit instead of relying on EntityManager's
      // implicit HR_WRITE_ROLES default. Same effective permission.
      writeRoles={HR_WRITE_ROLES}
      subtitle="Promotions, transfers, resignations and exit process."
      addLabel="New Request"
      api={hrApi.movements}
      queryKey="hr-movements"
      columns={columns}
      schema={movementSchema}
      defaultValues={{ type: 'Promotion', employee: '', department: 'Engineering', from: '', to: '', effectiveDate: '', reason: '', status: 'Pending' }}
      filters={[{ name: 'type', label: 'All Types', options: MOVEMENT_TYPES }, { name: 'status', label: 'All Status', options: MOVEMENT_STATUS }]}
      fields={[
        { name: 'type', label: 'Request Type', type: 'select', options: MOVEMENT_TYPES },
        { name: 'employee', label: 'Employee' },
        { name: 'department', label: 'Department', type: 'select', options: DEPARTMENTS },
        { name: 'from', label: 'From (role/dept/status)' },
        { name: 'to', label: 'To (role/dept/status)' },
        { name: 'effectiveDate', label: 'Effective Date', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: MOVEMENT_STATUS },
        { name: 'reason', label: 'Reason / Notes', type: 'textarea', full: true },
      ]}
      exportColumns={[
        { header: 'Type', accessor: 'type' }, { header: 'Employee', accessor: 'employee' },
        { header: 'From', accessor: 'from' }, { header: 'To', accessor: 'to' },
        { header: 'Effective', accessor: 'effectiveDate' }, { header: 'Status', accessor: 'status' },
      ]}
      filename="employee-movements"
    />
  )
}
