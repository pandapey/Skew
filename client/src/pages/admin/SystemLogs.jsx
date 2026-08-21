import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PageHeader, Card, DataTable, Pagination, SearchInput, Select, Badge } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { useDebounce } from '@/hooks/useDebounce'
import { adminApi } from '@/api/adminApi'
import { SYS_LEVELS, SYS_SOURCES } from '@/features/admin/constants'

const LEVEL_TONE = { INFO: 'accent', WARN: 'warning', ERROR: 'danger', DEBUG: 'default' }
const PAGE_SIZE = 12

const INITIAL = {
  search: '', level: '', source: '',
  // `at` is the event time; `createdAt` (the backend default) is insert time.
  sortBy: 'at', order: 'desc',
}

const fmtTime = (r) => {
  const raw = r.at || r.createdAt
  if (!raw) return '—'
  const d = new Date(raw)
  return isNaN(d) ? String(raw) : d.toLocaleString()
}

export default function SystemLogs() {
  const [params, setParams] = useState(INITIAL)
  const [page, setPage] = useState(1)
  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced, page, limit: PAGE_SIZE }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-system', queryParams],
    queryFn: () => adminApi.systemLogs.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const totalPages = data?.totalPages || 1
  const total = data?.total || 0

  const setP = (patch) => { setParams((p) => ({ ...p, ...patch })); setPage(1) }

  const exportCols = [
    { header: 'Level', accessor: 'level' }, { header: 'Source', accessor: 'source' },
    { header: 'Message', accessor: 'message' }, { header: 'Time', accessor: (r) => fmtTime(r) },
  ]

  return (
    <div>
      <PageHeader
        title="System Logs"
        subtitle="Application and infrastructure events."
        actions={<ExportMenu rows={rows} columns={exportCols} filename="system-logs" title="System Logs" subtitle="Skew Enterprise Hub" />}
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setP({ search: v })} className="lg:max-w-xs" placeholder="Search messages…" />
          <Select value={params.level} onChange={(e) => setP({ level: e.target.value })} className="lg:w-40" options={[{ value: '', label: 'All Levels' }, ...SYS_LEVELS.map((l) => ({ value: l, label: l }))]} />
          <Select value={params.source} onChange={(e) => setP({ source: e.target.value })} className="lg:w-48" options={[{ value: '', label: 'All Sources' }, ...SYS_SOURCES.map((s) => ({ value: s, label: s }))]} />
          <span className="text-sm text-muted lg:ml-auto">{total} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && <div className="absolute right-2 top-2 z-10"><span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>}
          <DataTable
            columns={[
              { key: 'level', header: 'Level', render: (r) => <Badge tone={LEVEL_TONE[r.level]}>{r.level}</Badge> },
              { key: 'source', header: 'Source', render: (r) => <span className="font-mono text-xs text-muted">{r.source}</span> },
              { key: 'message', header: 'Message', render: (r) => r.message },
              { key: 'time', header: 'Time', render: (r) => <span className="text-muted">{fmtTime(r)}</span> },
            ]}
            data={rows}
            loading={isLoading}
            empty="No system logs yet"
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">
            {total === 0
              ? 'No records'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} · Page ${data?.page || page} of ${totalPages}`}
          </p>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </Card>
    </div>
  )
}
