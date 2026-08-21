// Agenda view: events grouped by day, sorted chronologically.
import dayjs from 'dayjs'
import { FiMapPin, FiUsers, FiRepeat, FiFlag } from 'react-icons/fi'
import { cn } from '@/utils'
import { TYPE_META, getEventMeta } from './constants'
import { occStart, occEnd, isAllDay } from './recurrence'
import { timeRange } from './format'
import EventChip from './EventChip'

export default function AgendaView({ occurrences, today, onEventClick, onToggleDone }) {
  if (!occurrences.length) {
    return (
      <div className="card flex flex-col items-center justify-center gap-2 py-16 text-muted">
        <FiFlag className="h-8 w-8 opacity-40" />
        <p className="text-sm">No events in this range.</p>
      </div>
    )
  }

  // Group by calendar day.
  const groups = {}
  for (const o of occurrences) {
    const key = occStart(o).startOf('day').format('YYYY-MM-DD')
    ;(groups[key] ||= []).push(o)
  }
  const sortedKeys = Object.keys(groups).sort()

  return (
    <div className="card divide-y divide-app">
      {sortedKeys.map((key) => {
        const day = dayjs(key)
        const isToday = day.isSame(today, 'day')
        const items = groups[key].sort((a, b) => occStart(a).valueOf() - occStart(b).valueOf())
        return (
          <div key={key} className="flex gap-4 p-4">
            <div className="w-16 shrink-0 text-center">
              <div className={cn('text-2xl font-bold', isToday ? 'text-primary' : '')}>{day.format('D')}</div>
              <div className="text-xs uppercase text-muted">{day.format('ddd')}</div>
              <div className="text-[11px] text-muted">{day.format('MMM')}</div>
            </div>
            <div className="flex-1 space-y-2">
              {items.map((o) => {
                // Phase 6.9 (Task 17): client meetings show a status-driven
                // colour/icon (Pending/Approved/Cancelled/Rejected).
                const meta = getEventMeta(o)
                const Icon = meta.icon
                const isRec = o.recurrence?.freq && o.recurrence.freq !== 'none'
                const done = o.type === 'task' && o.done
                return (
                  <button
                    key={o.id}
                    onClick={() => onEventClick?.(o)}
                    className="flex w-full items-start gap-3 rounded-xl border border-app p-3 text-left transition hover:border-primary/40 hover:bg-primary/[0.03]"
                  >
                    <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.soft, meta.text)}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn('truncate text-sm font-semibold', done && 'line-through opacity-60')}>{o.title}</p>
                        {isRec && <FiRepeat className="h-3.5 w-3.5 shrink-0 text-muted" />}
                        {o.type === 'task' && (
                          <input
                            type="checkbox"
                            checked={!!done}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => onToggleDone?.(o)}
                            style={{ accentColor: meta.color }}
                            className="ml-auto h-4 w-4 shrink-0 cursor-pointer"
                            aria-label="Toggle complete"
                          />
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span className={meta.text}>
                          {isAllDay(o) ? 'All day' : timeRange(o.start, o.end)}
                        </span>
                        {o.location && (
                          <span className="flex items-center gap-1"><FiMapPin className="h-3 w-3" />{o.location}</span>
                        )}
                        {o.attendees?.length > 0 && (
                          <span className="flex items-center gap-1"><FiUsers className="h-3 w-3" />{o.attendees.length} attendees</span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
