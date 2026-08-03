// Admin Panel -> Roles.
//
// PHASE ADMIN (TASK 3) ROOT CAUSE: the "Users" column rendered `r.userCount`,
// but `userCount` DOES NOT EXIST ANYWHERE. A repo-wide search for the string
// found exactly three hits and all three were in this file - the column
// renderer, the export accessor and a `defaultValues` entry. The Role mongoose
// schema (server/src/models/adminModels.js) declares only `name`,
// `description`, `protected` and `system`; the roles endpoint is a plain
// generic CRUD resource router over that model, so the API never computed or
// returned a count of any kind.
//
// So the count was not cached, not stale and not a failed refresh - it was
// ALWAYS `undefined`, and `{r.userCount || 0}` silently rendered a hardcoded 0
// for every role. Nothing could have made it "auto-update", because nothing was
// ever counting users in the first place.
//
// THE FIX: derive the count from the real User collection, reusing the EXISTING
// users endpoint rather than adding a second user-count API. `adminApi.users
// .all()` already exists and is already used elsewhere in the Admin module, so
// no new API, service, controller or aggregation was introduced.
//
// AUTO-UPDATE: the query key is `['admin-users', 'role-counts']`. Every user
// mutation in the app already calls
// `qc.invalidateQueries({ queryKey: ['admin-users'] })` (see pages/admin/
// Users.jsx), and React Query matches invalidations by key PREFIX - so create,
// edit, role change, delete, activate and deactivate all invalidate this query
// automatically. No new invalidation plumbing, no realtime infrastructure and
// no manual refresh needed. A hard page reload re-fetches from MongoDB, so the
// refreshed value is database-backed too.
//
// WHAT IS COUNTED: every User document whose `role` equals the role's `name`.
// The previous implementation carried NO evidence of a narrower meaning (the
// field was never populated and the column header is simply "Users"), so the
// count is deliberately not filtered by `status` - narrowing it to Active-only
// would invent a meaning the existing implementation never had.
//
// RBAC: unchanged. This page already lives behind the Admin-only /admin route
// tree, and `/users` keeps its own existing server-side authorization. No
// endpoint was widened.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
// CLEANUP: `PageHeader`, `Card` and `CardHeader` were imported here but had
// zero references in this file (EntityManager renders its own header and card
// shell). Dead imports removed; only `Badge` is actually used.
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

  // A role with no users legitimately shows 0 - that is a real counted zero
  // from live data, not the old hardcoded fallback.
  const userCountOf = (row) => countsByRole[row?.name] ?? 0

  // Rebuilt when the counts change so the column re-renders with fresh numbers.
  const columns = useMemo(() => [
    {
      key: 'name',
      header: 'Role',
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{r.name}</span>
          {/* Phase 5 (Task 5): the "Protected" lock badge was removed so an Admin
              can edit, rename and delete any role without a UI restriction. The
              `protected` flag is still stored on the Role document and is still
              available to the backend - only the UI restriction is gone. Backend
              authorization (canAdmin on /admin/roles) is untouched. */}
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

  // The export uses the SAME derived figure as the table (the shared export
  // helper already supports a function accessor), so an exported CSV can never
  // disagree with what is on screen.
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
      // PHASE ADMIN (TASK 3): the dead `userCount: 0` default was removed. It
      // seeded a create-form value for a field the Role schema does not have,
      // so Mongoose stripped it on every save - it only made the count look
      // like a stored column when it never was one.
      defaultValues={{ description: '', system: 'false' }}
      addLabel="Add Role"
      writeRoles={ADMIN_WRITE_ROLES}
    />
  )
}
