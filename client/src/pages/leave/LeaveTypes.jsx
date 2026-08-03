import { EntityManager } from '@/features/hr/EntityManager'
import { leaveApi } from '@/api/services'
import { HR_WRITE_ROLES } from '@/features/hr/constants'
import { Badge } from '@/components/ui'
import { z } from 'zod'

const typeSchema = z.object({
  name: z.string().min(1, 'Name required'),
  code: z.string().min(1, 'Code required'),
  allocated: z.coerce.number().min(0, 'Must be 0 or more'),
  paid: z.coerce.boolean().optional(),
  active: z.coerce.boolean().optional(),
  genderRestriction: z.string().optional(),
})

export default function LeaveTypes() {
  const columns = [
    { key: 'name', header: 'Leave Type', render: (r) => (
      <span className="flex items-center gap-2 font-medium">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color || '#2563EB' }} />{r.name}
      </span>
    ) },
    { key: 'code', header: 'Code', render: (r) => <Badge tone="accent">{r.code}</Badge> },
    { key: 'allocated', header: 'Days / Year' },
    { key: 'paid', header: 'Paid', render: (r) => <Badge tone={r.paid ? 'success' : 'default'}>{r.paid ? 'Paid' : 'Unpaid'}</Badge> },
    { key: 'carryForward', header: 'Carry Forward', render: (r) => <Badge tone={r.carryForward ? 'primary' : 'default'}>{r.carryForward ? 'Yes' : 'No'}</Badge> },
    { key: 'active', header: 'Status', render: (r) => <Badge tone={r.active === false ? 'default' : 'success'}>{r.active === false ? 'Inactive' : 'Active'}</Badge> },
    { key: 'genderRestriction', header: 'Gender', render: (r) => <Badge tone={r.genderRestriction === 'Any' || !r.genderRestriction ? 'default' : 'accent'}>{r.genderRestriction || 'Any'}</Badge> },
  ]
  return (
    <EntityManager
      title="Leave Types"
      // Phase 5.9 (Task 7): explicit instead of relying on EntityManager's
      // implicit HR_WRITE_ROLES default. Leave policy is HR-owned config, so
      // Admin + HR keep write access and nobody else gains it.
      writeRoles={HR_WRITE_ROLES}
      subtitle="Configure leave categories, allocations and policies."
      addLabel="Add Type"
      api={leaveApi.types}
      queryKey="leave-types"
      columns={columns}
      schema={typeSchema}
      defaultValues={{ name: '', code: '', allocated: 12, color: '#2563EB', paid: 'true', carryForward: 'false', active: 'true', genderRestriction: 'Any' }}
      fields={[
        { name: 'name', label: 'Leave Type Name' },
        { name: 'code', label: 'Code (e.g. CL)' },
        { name: 'allocated', label: 'Days per Year', type: 'number' },
        { name: 'color', label: 'Color (hex)' },
        { name: 'paid', label: 'Paid?', type: 'select', options: [{ value: 'true', label: 'Paid' }, { value: 'false', label: 'Unpaid' }] },
        { name: 'carryForward', label: 'Carry Forward?', type: 'select', options: [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }] },
        { name: 'active', label: 'Status', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
        { name: 'genderRestriction', label: 'Gender Restriction', type: 'select', options: [
          { value: 'Any', label: 'Any (visible to all)' },
          { value: 'Male', label: 'Male only (e.g. Paternity)' },
          { value: 'Female', label: 'Female only (e.g. Maternity)' },
        ]},
      ]}
      exportColumns={[
        { header: 'Name', accessor: 'name' }, { header: 'Code', accessor: 'code' },
        { header: 'Allocated', accessor: 'allocated' }, { header: 'Paid', accessor: (r) => (r.paid ? 'Yes' : 'No') },
        { header: 'Status', accessor: (r) => (r.active === false ? 'Inactive' : 'Active') },
      ]}
      filename="leave-types"
    />
  )
}
