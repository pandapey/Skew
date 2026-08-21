import { EntityManager } from '@/features/hr/EntityManager'
import { adminApi } from '@/api/adminApi'
import { Badge } from '@/components/ui'
import {
  planSchema, PLAN_FORM_FIELDS, PLAN_FORM_DEFAULTS, PLAN_QUERY_KEY,
  PLAN_STATUSES, PLAN_WRITE_ROLES,
} from '@/features/client/planForm'
import { formatCurrency } from '@/utils'
export default function Plans() {
  const columns = [
    { key: 'name', header: 'Plan', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'code', header: 'Code', render: (r) => (r.code ? <Badge tone="accent">{r.code}</Badge> : '—') },
    { key: 'price', header: 'Monthly Price', render: (r) => formatCurrency(r.price) },
    { key: 'description', header: 'Description', render: (r) => r.description || '—' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={r.status === 'Active' ? 'success' : 'warning'}>{r.status || 'Active'}</Badge>
      ),
    },
  ]

  return (
    <EntityManager
      title="Plans"
      subtitle="Client subscription plans offered on the Client Creation form."
      writeRoles={PLAN_WRITE_ROLES}
      api={adminApi.plans}
      queryKey={PLAN_QUERY_KEY}
      columns={columns}
      schema={planSchema}
      defaultValues={PLAN_FORM_DEFAULTS}
      fields={PLAN_FORM_FIELDS}
      filters={[{ name: 'status', label: 'All Status', options: PLAN_STATUSES }]}
      exportColumns={[
        { header: 'Plan', accessor: 'name' },
        { header: 'Code', accessor: 'code' },
        { header: 'Monthly Price', accessor: (r) => formatCurrency(r.price) },
        { header: 'Status', accessor: 'status' },
      ]}
      filename="plans"
      addLabel="Add Plan"
    />
  )
}
