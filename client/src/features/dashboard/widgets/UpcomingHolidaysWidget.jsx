import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { FiSun, FiCalendar } from 'react-icons/fi'
import { CardHeader, Badge, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { leaveApi } from '@/api/services'

// Upcoming company holidays from the shared leave/holiday calendar. Defensive
// about field names (name/title, date/from/start) so it works whichever shape
// the holiday collection returns.
export default function UpcomingHolidaysWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['leave', 'holidays'],
    queryFn: () => leaveApi.holidays(),
    staleTime: 60 * 60 * 1000,
  })

  if (isLoading) return <CardSkeleton />

  const rows = Array.isArray(data) ? data : data?.data || []
  const today = dayjs().startOf('day')
  const upcoming = rows
    .map((h) => ({
      name: h.name || h.title || h.occasion || 'Holiday',
      date: h.date || h.from || h.start,
      optional: h.optional || h.type === 'Optional' || h.category === 'Optional',
    }))
    .filter((h) => h.date && !dayjs(h.date).isBefore(today, 'day'))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5)

  return (
    <GlassWidget>
      <CardHeader title="Upcoming Holidays" action={<FiCalendar className="text-muted" />} />
      {!upcoming.length ? (
        <EmptyState title="No holidays scheduled" description="No upcoming company holidays on the calendar." icon={FiSun} />
      ) : (
        <div className="space-y-2.5">
          {upcoming.map((h) => (
            <div
              key={`${h.name}-${h.date}`}
              className="flex items-center gap-3 rounded-2xl border border-app p-3 transition hover:border-primary/40"
            >
              <div className="flex h-10 w-10 flex-none flex-col items-center justify-center rounded-xl bg-success/10 text-success">
                <span className="text-xs font-bold leading-none">{dayjs(h.date).format('DD')}</span>
                <span className="text-[10px] uppercase leading-none">{dayjs(h.date).format('MMM')}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{h.name}</p>
                <p className="text-xs text-muted">{dayjs(h.date).format('dddd')}</p>
              </div>
              {h.optional && <Badge>Optional</Badge>}
            </div>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
