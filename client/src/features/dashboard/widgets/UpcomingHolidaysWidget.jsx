import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { FiSun, FiArrowRight } from 'react-icons/fi'
import { CardHeader, Badge, Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { leaveApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

export default function UpcomingHolidaysWidget() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canManageHolidays = user?.role === ROLES.ADMIN || user?.role === ROLES.MANAGER
  const holidaysHref = canManageHolidays ? '/attendance/holidays' : '/calendar'
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
      <CardHeader
        title="Upcoming Holidays"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate(holidaysHref)}>
            {canManageHolidays ? 'Holidays' : 'Calendar'}
          </Button>
        }
      />
      {!upcoming.length ? (
        <EmptyState title="No holidays scheduled" description="No upcoming company holidays on the calendar." icon={FiSun} />
      ) : (
        <div className="space-y-2.5">
          {upcoming.map((h) => (
            <button
              type="button"
              key={`${h.name}-${h.date}`}
              onClick={() => navigate(canManageHolidays ? holidaysHref : `/calendar?date=${dayjs(h.date).format('YYYY-MM-DD')}`)}
              className="flex w-full items-center gap-3 rounded-2xl border border-app p-3 text-left transition hover:border-primary/40 focus-visible:border-primary"
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
            </button>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
