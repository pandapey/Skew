import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { projectApi } from '@/api/services'
import { PageHeader, Card, Select, Badge, Loader } from '@/components/ui'
import { PROJECT_STATUS_TONE } from '@/features/projects/constants'
import { formatDate } from '@/utils'

// Build an evenly spaced month axis spanning all project date ranges.
function useTimeline(projects) {
  return useMemo(() => {
    const dates = projects.flatMap((p) => [p.startDate, p.deadline]).filter(Boolean).map((d) => dayjs(d))
    if (!dates.length) return null
    let min = dates.reduce((a, b) => (a.isBefore(b) ? a : b)).startOf('month')
    let max = dates.reduce((a, b) => (a.isAfter(b) ? a : b)).endOf('month')
    const months = []
    let cur = min.clone()
    while (cur.isBefore(max) || cur.isSame(max, 'month')) { months.push(cur.clone()); cur = cur.add(1, 'month') }
    const totalDays = max.diff(min, 'day') || 1
    const pct = (d) => Math.max(0, Math.min(100, (dayjs(d).diff(min, 'day') / totalDays) * 100))
    return { min, max, months, pct, totalDays }
  }, [projects])
}

export default function Timeline() {
  const navigate = useNavigate()
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects-all'], queryFn: projectApi.all })
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = projects.filter((p) => !statusFilter || p.status === statusFilter)
  const tl = useTimeline(filtered)
  const todayPct = tl && dayjs().isAfter(tl.min) && dayjs().isBefore(tl.max) ? tl.pct(dayjs()) : null

  return (
    <div>
      <PageHeader
        title="Timeline"
        subtitle="Gantt-style schedule of project delivery windows."
        actions={
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44"
            options={[{ value: '', label: 'All Status' }, ...['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'].map((s) => ({ value: s, label: s }))]} />
        }
      />

      {isLoading ? <Loader label="Loading timeline…" /> : !tl ? (
        <Card><p className="py-10 text-center text-sm text-muted">No dated projects to display</p></Card>
      ) : (
        <Card className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Month axis */}
            <div className="mb-2 flex border-b border-app pb-2">
              <div className="w-48 flex-none" />
              <div className="flex flex-1">
                {tl.months.map((m) => (
                  <div key={m.format('YYYY-MM')} className="flex-1 text-center text-xs font-medium text-muted">{m.format('MMM YY')}</div>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div className="space-y-2">
              {filtered.map((p) => {
                const left = tl.pct(p.startDate)
                const right = tl.pct(p.deadline)
                const width = Math.max(2, right - left)
                return (
                  <div key={p.id} className="flex items-center">
                    <button onClick={() => navigate(`/projects/${p.id}`)} className="w-48 flex-none truncate pr-3 text-left text-sm font-medium hover:text-primary">
                      {p.name}
                    </button>
                    <div className="relative h-7 flex-1 rounded bg-black/[0.03] dark:bg-white/[0.03]">
                      {todayPct != null && <div className="absolute bottom-0 top-0 z-10 w-px bg-danger/60" style={{ left: `${todayPct}%` }} />}
                      <div
                        className="absolute top-1 flex h-5 items-center justify-between rounded-full px-2 text-[10px] font-medium text-white shadow-soft"
                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: p.color }}
                        title={`${formatDate(p.startDate, 'DD MMM')} – ${formatDate(p.deadline, 'DD MMM')}`}
                      >
                        <span className="truncate">{p.progress}%</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {todayPct != null && (
              <div className="mt-2 flex">
                <div className="w-48 flex-none" />
                <div className="relative flex-1 text-[10px] text-danger" style={{ paddingLeft: `${todayPct}%` }}>
                  <span className="-ml-3">▲ Today</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Legend */}
      {!isLoading && tl && (
        <div className="mt-4 flex flex-wrap gap-3">
          {filtered.map((p) => (
            <span key={p.id} className="flex items-center gap-2 text-xs text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}<Badge tone={PROJECT_STATUS_TONE[p.status]}>{p.status}</Badge>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
