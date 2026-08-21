// Shared week/day time-grid surface: all-day lane + hourly columns with
// absolutely positioned, drag-andable event blocks and a live "now" line.
import dayjs from 'dayjs'
import { cn } from '@/utils'
import { WEEKDAY_LABELS_LONG, HOUR_HEIGHT } from './constants'
import { occStart, occEnd, isAllDay } from './recurrence'
import EventChip from './EventChip'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function formatHour(h) {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// Greedy column packing so overlapping events sit side-by-side.
function packDay(events) {
  const sorted = [...events].sort(
    (a, b) => occStart(a).valueOf() - occStart(b).valueOf() || occEnd(b).valueOf() - occEnd(a).valueOf(),
  )
  const cols = []
  const layout = {}
  for (const ev of sorted) {
    let ci = cols.findIndex((col) => !col.length || !occEnd(col[col.length - 1]).isAfter(occStart(ev)))
    if (ci === -1) {
      cols.push([])
      ci = cols.length - 1
    }
    cols[ci].push(ev)
  }
  cols.forEach((col, ci) => col.forEach((ev) => (layout[ev.id] = { col: ci, total: cols.length })))
  return layout
}

export default function TimeGrid({
  days,
  occurrences,
  today,
  now,
  minWidth = 640,
  onEventClick,
  onToggleDone,
  onEventDragStart,
  onEventDragEnd,
  onDropToSlot,
  onDropToAllDay,
  onDateClick,
}) {
  // Split into all-day (spanning) and timed occurrences.
  const allDayEvents = occurrences.filter((o) => isAllDay(o) || occStart(o).day() !== occEnd(o).day())
  const timedEvents = occurrences.filter((o) => !isAllDay(o) && occStart(o).day() === occEnd(o).day())

  const allDayFor = (day) =>
    allDayEvents.filter((o) => {
      const s = occStart(o).startOf('day')
      const e = occEnd(o).startOf('day')
      const d = day.startOf('day')
      return !d.isBefore(s) && !d.isAfter(e)
    })

  const timedFor = (day) => timedEvents.filter((o) => occStart(o).isSame(day, 'day'))

  const handleSlotDrop = (e, day) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    let hourFloat = offsetY / HOUR_HEIGHT
    hourFloat = Math.max(0, Math.min(24, hourFloat))
    const whole = Math.floor(hourFloat)
    const minutes = Math.round(((hourFloat - whole) * 60) / 15) * 15
    const newStart = day.startOf('day').add(whole, 'hour').add(minutes, 'minute')
    onDropToSlot?.(day, newStart)
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          {/* Day header */}
          <div className="flex border-b border-app">
            <div className="w-14 shrink-0 border-r border-app" />
            <div className="flex flex-1">
              {days.map((day) => {
                const isToday = day.isSame(today, 'day')
                return (
                  <button
                    key={day.format('YYYY-MM-DD')}
                    onClick={() => onDateClick?.(day)}
                    className="flex-1 border-l border-app p-2 text-center transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  >
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                      {WEEKDAY_LABELS_LONG[day.day()].slice(0, 3)}
                    </div>
                    <div
                      className={cn(
                        'mx-auto mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                        isToday ? 'bg-primary text-white' : '',
                      )}
                    >
                      {day.date()}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* All-day lane */}
          <div className="flex border-b border-app">
            <div className="w-14 shrink-0 border-r border-app p-2 text-[10px] font-medium uppercase text-muted">
              all-day
            </div>
            <div className="flex flex-1">
              {days.map((day) => (
                <div
                  key={day.format('YYYY-MM-DD')}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    onDropToAllDay?.(day)
                  }}
                  className="flex-1 space-y-1 border-l border-app p-1"
                >
                  {allDayFor(day).map((o) => (
                    <EventChip
                      key={o.id}
                      occurrence={o}
                      layout="bar"
                      draggable
                      onDragStart={() => onEventDragStart?.(o)}
                      onDragEnd={onEventDragEnd}
                      onClick={onEventClick}
                      onToggleDone={onToggleDone}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Time grid */}
          <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
            {/* Hour gutter */}
            <div className="relative w-14 shrink-0 border-r border-app">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10px] text-muted"
                  style={{ top: h * HOUR_HEIGHT }}
                >
                  {formatHour(h)}
                </div>
              ))}
            </div>

            {/* Columns */}
            <div className="relative flex flex-1">
              {/* Hour grid lines */}
              {HOURS.map((h) => (
                <div key={h} className="absolute left-0 right-0 border-t border-app" style={{ top: h * HOUR_HEIGHT }} />
              ))}

              {days.map((day) => {
                const isToday = day.isSame(today, 'day')
                const layout = packDay(timedFor(day))
                const nowTop = isToday
                  ? ((now.hour() * 60 + now.minute()) / 60) * HOUR_HEIGHT
                  : null
                return (
                  <div
                    key={day.format('YYYY-MM-DD')}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleSlotDrop(e, day)}
                    className="relative flex-1 border-l border-app"
                  >
                    {nowTop !== null && (
                      <div className="absolute left-0 right-0 z-20 border-t-2 border-danger" style={{ top: nowTop }}>
                        <span className="absolute -left-1 -top-1.5 h-2.5 w-2.5 rounded-full bg-danger" />
                      </div>
                    )}
                    {timedFor(day).map((o) => {
                      const s = occStart(o)
                      const e = occEnd(o)
                      const top = (s.hour() * 60 + s.minute()) / 60 * HOUR_HEIGHT
                      const height = Math.max(((e.hour() * 60 + e.minute()) - (s.hour() * 60 + s.minute())) / 60 * HOUR_HEIGHT, 20)
                      const pack = layout[o.id] || { col: 0, total: 1 }
                      const leftPct = (pack.col / pack.total) * 100
                      const widthPct = 100 / pack.total
                      return (
                        <EventChip
                          key={o.id}
                          occurrence={o}
                          layout="block"
                          draggable
                          onDragStart={() => onEventDragStart?.(o)}
                          onDragEnd={onEventDragEnd}
                          onClick={onEventClick}
                          onToggleDone={onToggleDone}
                          style={{
                            top: `${top}px`,
                            height: `${height}px`,
                            left: `calc(${leftPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                          }}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
