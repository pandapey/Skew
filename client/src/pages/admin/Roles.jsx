import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Badge } from '@/components/ui'
import { EntityManager } from '@/features/hr/EntityManager'
import { adminApi } from '@/api/adminApi'
import { ADMIN_WRITE_ROLES } from '@/features/admin/constants'

const schema = z.object({
  name: z.string().min(2, 'Role name is required'),
  description: z.string().optional(),
  system: z.string().optional(),
})

const fields = [
  { name: 'name', label: 'Role Name', placeholder: 'Auditor' },
  { name: 'description', label: 'Description', type: 'textarea', full: true, placeholder: 'What can this role do?' },
  { name: 'system', label: 'Type', type: 'select', options: [{ value: 'false', label: 'Custom' }, { value: 'true', label: 'System' }] },
]

export default function Roles() {
  // Live user records, straight from the existing /users endpoint.
  const { data: users } = useQuery({
    queryKey: ['admin-users', 'role-counts'],
    queryFn: adminApi.users.all,
  })

  // role name -> number of users currently holding that role.
  const countsByRole = useMemo(() => {
    const map = {}
    ;(Array.isArray(users) ? users : []).forEach((u) => {
      const role = u?.role
      if (role) map[role] = (map[role] || 0) + 1
    })
    return map
  }, [users])

  const userCountOf = (row) => countsByRole[row?.name] ?? 0

  // Rebuilt when the counts change so the column re-renders with fresh numbers.
  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'Role',
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.name}</span>
        </div>
      ),
    },
    { key: 'description', header: 'Description', render: (r) => <span className="text-muted">{r.description || '—'}</span> },
    { key: 'userCount', header: 'Users', render: (r) => <span className="font-mono text-sm">{userCountOf(r)}</span> },
    {
      key: 'system',
      header: 'Type',
      render: (r) => (
        <Badge tone={r.system === true || r.system === 'true' ? 'primary' : 'default'}>
          {r.system === true || r.system === 'true' ? 'System' : 'Custom'}
        </Badge>
      ),
    },
  ], [countsByRole]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportColumns = useMemo(() => [
    { header: 'Role', accessor: 'name' },
    { header: 'Description', accessor: 'description' },
    { header: 'Users', accessor: (r) => userCountOf(r) },
  ], [countsByRole]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <EntityManager
      title="Roles"
      subtitle="Define organizational roles."
      api={adminApi.roles}
      queryKey="admin-roles"
      columns={columns}
      fields={fields}
      schema={schema}
      exportColumns={exportColumns}
      filename="roles"
      defaultValues={{ description: '', system: 'false' }}
      addLabel="Add Role"
      writeRoles={ADMIN_WRITE_ROLES}
    />
  )
}
