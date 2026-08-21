import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { FiUsers, FiArrowRight } from 'react-icons/fi'
import { CardHeader, Avatar, Badge, Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { attendanceApi } from '@/api/services'

const SUMMARY = [
  { key: 'Present', tone: 'success' },
  { key: 'Late', tone: 'warning' },
  { key: 'On Leave', tone: 'default' },
  { key: 'Absent', tone: 'danger' },
]

export default function TeamAvailabilityWidget() {
  const navigate = useNavigate()
  const today = dayjs().format('YYYY-MM-DD')
  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'day', today],
    queryFn: () => attendanceApi.dayRecords({ date: today }),
    staleTime: 60_000,
  })

  if (isLoading) return <CardSkeleton />

  const rows = Array.isArray(data) ? data : data?.data || data?.records || []
  const normalized = rows.map((r) => ({
    name: r.name || r.employee || 'Unknown',
    status: r.status || 'Not Marked',
  }))
  const counts = normalized.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {})
  const present = normalized.filter((r) => r.status === 'Present' || r.status === 'Late').slice(0, 6)

  return (
    <GlassWidget>
      <CardHeader
        title="Team Availability"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/attendance')}>
            Attendance
          </Button>
        }
      />
      {!normalized.length ? (
        <EmptyState title="No records today" description="Attendance for today hasn't been recorded yet." icon={FiUsers} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {SUMMARY.filter((s) => counts[s.key]).map((s) => (
              <Badge key={s.key} tone={s.tone}>{s.key}: {counts[s.key]}</Badge>
            ))}
          </div>
          {present.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {present.map((r) => (
                <span key={r.name} className="flex items-center gap-1.5 rounded-full border border-app py-1 pl-1 pr-2.5">
                  <Avatar name={r.name} size={22} ring={false} />
                  <span className="text-xs font-medium">{r.name.split(' ')[0]}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassWidget>
  )
}
