import { EntityManager } from '@/features/hr/EntityManager'
import { adminApi } from '@/api/adminApi'
import { Badge } from '@/components/ui'
import {
  domainPlanSchema, DOMAIN_PLAN_FORM_FIELDS, DOMAIN_PLAN_FORM_DEFAULTS, DOMAIN_PLAN_QUERY_KEY,
  DOMAIN_PLAN_STATUSES, DOMAIN_PLAN_WRITE_ROLES,
} from '@/features/domain/domainPlanForm'
import { formatCurrency } from '@/utils'

export default function DomainPlans() {
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
      title="Domain Plans"
      subtitle="Domain creation plans offered on the Domain Creation form."
      writeRoles={DOMAIN_PLAN_WRITE_ROLES}
      api={adminApi.domainPlans}
      queryKey={DOMAIN_PLAN_QUERY_KEY}
      columns={columns}
      schema={domainPlanSchema}
      defaultValues={DOMAIN_PLAN_FORM_DEFAULTS}
      fields={DOMAIN_PLAN_FORM_FIELDS}
      filters={[{ name: 'status', label: 'All Status', options: DOMAIN_PLAN_STATUSES }]}
      exportColumns={[
        { header: 'Plan', accessor: 'name' },
        { header: 'Code', accessor: 'code' },
        { header: 'Monthly Price', accessor: (r) => formatCurrency(r.price) },
        { header: 'Status', accessor: 'status' },
      ]}
      filename="domain-plans"
      addLabel="Add Plan"
    />
  )
}
