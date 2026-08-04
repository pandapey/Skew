import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiAlertCircle } from 'react-icons/fi'
import { projectApi } from '@/api/services'
import { PageHeader, Card, DataTable, SearchInput, Select, Badge, StatCard, Loader, Pagination } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { usePagination } from '@/hooks/usePagination'
import { SEVERITIES, TASK_STATUSES, SEVERITY_TONE, TASK_STATUS_TONE, PRIORITY_TONE } from '@/features/projects/constants'
import { formatDate } from '@/utils'

export default function Bugs() {
  const { data: projects = [] } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })
  const { data: bugs = [], isLoading } = useQuery({ queryKey: ['project-bugs'], queryFn: () => projectApi.tasks({ type: 'Bug' }) })

  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState('')
  const [status, setStatus] = useState('')
  const debounced = useDebounce(search)

  const projName = (id) => projects.find((p) => p.id === id)?.name || '—'
  const filtered = bugs.filter((b) => {
    const s = debounced.toLowerCase()
    return (!s || b.title.toLowerCase().includes(s)) && (!severity || b.severity === severity) && (!status || b.status === status)
  })
  const { page, totalPages, paged, setPage } = usePagination(filtered, 10)

  const open = bugs.filter((b) => b.status !== 'Done')
  const critical = bugs.filter((b) => ['Critical', 'Blocker'].includes(b.severity) && b.status !== 'Done')

  const columns = [
    { key: 'title', header: 'Bug', render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{projName(r.project)}</p></div> },
    { key: 'severity', header: 'Severity', render: (r) => <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge> },
    { key: 'priority', header: 'Priority', render: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge> },
    { key: 'assignee', header: 'Assignee', render: (r) => r.assignee || '—' },
    { key: 'reporter', header: 'Reporter', render: (r) => r.reporter || '—' },
    { key: 'dueDate', header: 'Due', render: (r) => formatDate(r.dueDate) },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={TASK_STATUS_TONE[r.status]}>{r.status}</Badge> },
  ]

  if (isLoading) return <Loader label="Loading bugs…" />

  return (
    <div>
      <PageHeader title="Bug Tracking" subtitle="Track, triage and resolve bugs across all projects." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Bugs" value={bugs.length} icon={FiAlertCircle} />
        <StatCard label="Open" value={open.length} icon={FiAlertCircle} tone="warning" />
        <StatCard label="Critical / Blocker" value={critical.length} icon={FiAlertCircle} tone="danger" />
        <StatCard label="Resolved" value={bugs.length - open.length} icon={FiAlertCircle} tone="success" />
      </div>

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={search} onChange={setSearch} className="lg:max-w-xs" />
          <Select className="lg:w-40" value={severity} onChange={(e) => setSeverity(e.target.value)} options={[{ value: '', label: 'All Severities' }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]} />
          <Select className="lg:w-40" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All Status' }, ...TASK_STATUSES.map((s) => ({ value: s, label: s }))]} />
          <div className="lg:ml-auto">
            <ExportMenu rows={filtered} filename="project-bugs" title="Bug Report"
              columns={[{ header: 'Bug', accessor: 'title' }, { header: 'Severity', accessor: 'severity' }, { header: 'Priority', accessor: 'priority' }, { header: 'Assignee', accessor: 'assignee' }, { header: 'Status', accessor: 'status' }]} />
          </div>
        </div>
        <DataTable columns={columns} data={paged} empty="No bugs found" />
        <div className="mt-2"><Pagination page={page} totalPages={totalPages} onChange={setPage} /></div>
      </Card>
    </div>
  )
}
