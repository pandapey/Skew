import { useSearchParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiUsers, FiTrello, FiFile, FiMessageSquare } from 'react-icons/fi'
import { PageHeader, Card, SearchInput, Badge, EmptyState, Loader } from '@/components/ui'
import apiClient from '@/api/client'
import { useDebounce } from '@/hooks/useDebounce'

// Global search — queries each module's real backend endpoint (MongoDB) and
// aggregates the results. No local data is used.
const SOURCES = [
  {
    type: 'Employee', icon: FiUsers, path: '/employees',
    fetch: (q) => apiClient.get('/employees', { params: { search: q, limit: 5 } }).then((r) => r.data || []),
    label: (r) => r.name, sub: (r) => r.designation || r.department,
  },
  {
    type: 'Project', icon: FiTrello, path: '/projects',
    fetch: (q) => apiClient.get('/project', { params: { search: q, limit: 5 } }).then((r) => r.data || []),
    label: (r) => r.name, sub: (r) => r.client,
  },
  {
    type: 'File', icon: FiFile, path: '/files',
    fetch: (q) => apiClient.get('/files', { params: { search: q } }).then((r) => (r.files || []).slice(0, 5)),
    label: (r) => r.name, sub: (r) => r.owner,
  },
  {
    type: 'Announcement', icon: FiMessageSquare, path: '/announcements',
    fetch: (q) => apiClient.get('/announcements', { params: { search: q, limit: 5 } }).then((r) => (Array.isArray(r) ? r : r.data || []).slice(0, 5)),
    label: (r) => r.title, sub: (r) => r.type || r.category,
  },
]

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') || '')
  const debounced = useDebounce(query, 350)
  const q = debounced.trim()

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['global-search', q],
    enabled: q.length > 0,
    queryFn: async () => {
      const settled = await Promise.allSettled(SOURCES.map((src) => src.fetch(q)))
      return settled.flatMap((res, i) =>
        res.status === 'fulfilled'
          ? res.value.map((row) => ({ ...SOURCES[i], row }))
          : []
      )
    },
  })

  const onChange = (val) => { setQuery(val); setParams(val ? { q: val } : {}) }

  return (
    <div>
      <PageHeader title="Global Search" subtitle="Search across employees, projects, clients, files and more." />

      <Card className="mb-4">
        <SearchInput value={query} onChange={onChange} placeholder="Type to search everything…" />
      </Card>

      {!query.trim() ? (
        <EmptyState title="Start typing to search" description="Results from all modules will appear here." />
      ) : isFetching ? (
        <Loader label="Searching…" />
      ) : results.length === 0 ? (
        <EmptyState title={`No results for "${query}"`} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted">{results.length} results for "{query}"</p>
          {results.map((r, i) => (
            <Link key={i} to={r.path}>
              <Card className="flex items-center gap-3 py-3 transition hover:border-primary">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary"><r.icon /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.label(r.row)}</p>
                  <p className="truncate text-xs text-muted">{r.sub(r.row)}</p>
                </div>
                <Badge tone="default">{r.type}</Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
