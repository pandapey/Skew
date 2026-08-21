import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FiGlobe, FiArrowRight } from 'react-icons/fi'
import { EntityManager } from '@/features/hr/EntityManager'
import {
  clientSchema, CLIENT_FORM_FIELDS, CLIENT_FORM_DEFAULTS,
  buildClientsApi, CLIENT_WRITE_ROLES,
} from '@/features/client/clientForm'

const columns = [
  { key: 'company', header: 'Company', render: (r) => (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><FiGlobe className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="truncate font-medium">{r.company}</p><p className="truncate text-xs text-muted">{r.contactPerson}</p></div>
    </div>
  ) },
  { key: 'industry', header: 'Industry' },
  { key: 'plan', header: 'Plan', render: (r) => <span className="chip bg-primary/10 text-primary">{r.plan}</span> },
  { key: 'projectCount', header: 'Projects', render: (r) => r.projectCount ?? 0 },
  { key: 'activeProjects', header: 'Active', render: (r) => r.activeProjects ?? 0 },
  { key: 'status', header: 'Status', render: (r) => <span className={`chip ${r.status === 'Active' ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning'}`}>{r.status}</span> },
  { key: '_manage', header: '', render: (r) => (
    <Link to={`/clients/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20">
      Manage <FiArrowRight />
    </Link>
  ) },
]

const exportColumns = [
  { header: 'Company', accessor: 'company' }, { header: 'Contact', accessor: 'contactPerson' },
  { header: 'Email', accessor: 'email' }, { header: 'Industry', accessor: 'industry' },
  { header: 'Plan', accessor: 'plan' }, { header: 'Status', accessor: 'status' },
]

const filters = [
  { name: 'status', label: 'All Status', options: ['Active', 'On Hold', 'Suspended'] },
]

export default function Clients() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const legacyAdd = searchParams.get('add') === 'client'
  const returnTo = searchParams.get('returnTo') || ''
  useEffect(() => {
    if (!legacyAdd) return
    setSearchParams({}, { replace: true })
    navigate(`/clients/new${returnTo ? `?returnTo=${returnTo}` : ''}`, { replace: true })
  }, [legacyAdd])

  const api = useMemo(() => buildClientsApi(), [])

  return (
    <EntityManager
      title="Clients"
      subtitle="Manage client accounts and their portals."
      api={api}
      queryKey="admin-clients"
      columns={columns}
      fields={CLIENT_FORM_FIELDS}
      schema={clientSchema}
      filters={filters}
      exportColumns={exportColumns}
      filename="clients"
      defaultValues={CLIENT_FORM_DEFAULTS}
      addLabel="Add Client"
      onAdd={() => navigate('/clients/new')}
      writeRoles={CLIENT_WRITE_ROLES}
    />
  )
}
