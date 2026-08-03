import { useNavigate } from 'react-router-dom'
import { FiArrowRight, FiClock, FiMapPin, FiUsers, FiVideo } from 'react-icons/fi'
import dayjs from 'dayjs'
import { CardHeader, Badge, Button, CardSkeleton, EmptyState } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { useTodayEvents } from '@/hooks/queries/useTodayEvents'

// Today's schedule (meetings + events) from the shared calendar cache. Reuses
// the same `useTodayEvents` hook as My Work so both read one request.
const TYPE_TONE = { meeting: 'primary', deadline: 'danger', task: 'warning', holiday: 'success' }

export default function TodayMeetingsWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useTodayEvents()

  if (isLoading) return <CardSkeleton />

  const rows = Array.isArray(data) ? data : data?.data || []
  const events = [...rows].sort((a, b) => new Date(a.start) - new Date(b.start)).slice(0, 5)

  return (
    <GlassWidget>
      <CardHeader
        title="Today's Meetings"
        action={
          <Button variant="ghost" size="sm" icon={FiArrowRight} onClick={() => navigate('/calendar')}>
            Calendar
          </Button>
        }
      />
      {!events.length ? (
        <EmptyState title="No events today" description="Your schedule is clear. Enjoy the focus time." icon={FiClock} />
      ) : (
        <div className="space-y-2.5">
          {events.map((e) => (
            <div
              key={e._id || e.id}
              className="flex items-center gap-3 rounded-2xl border border-app p-3 transition hover:border-primary/40"
            >
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-accent/10 text-accent">
                {e.type === 'meeting' ? <FiVideo className="h-4 w-4" /> : <FiClock className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span>{e.allDay ? 'All day' : dayjs(e.start).format('hh:mm A')}</span>
                  {e.location && (
                    <span className="flex items-center gap-1"><FiMapPin className="h-3 w-3" />{e.location}</span>
                  )}
                  {!!e.attendees?.length && (
                    <span className="flex items-center gap-1"><FiUsers className="h-3 w-3" />{e.attendees.length}</span>
                  )}
                </p>
              </div>
              {e.type && e.type !== 'event' && <Badge tone={TYPE_TONE[e.type]}>{e.type}</Badge>}
            </div>
          ))}
        </div>
      )}
    </GlassWidget>
  )
}
