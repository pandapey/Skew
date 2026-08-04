// Google Calendar-style month grid with drag-and-drop rescheduling.
import { useState } from 'react'
import dayjs from 'dayjs'
import { cn } from '@/utils'
import { WEEKDAY_LABELS, VIEW } from './constants'
import { occStart, occEnd, isAllDay } from './recurrence'
import EventChip from './EventChip'

const MAX_VISIBLE = 3

export default function MonthView({
  current,
  occurrences,
  today,
  activeTypes,
  onEventClick,
  onToggleDone,
  onEventDragStart,
  onEventDragEnd,
  onDropToDay,
  onDateClick,
  onShowMore,
}) {
  const [dragOverDate, setDragOverDate] = useState(null)

  const startOfMonth = current.startOf('month')
  const leading = startOfMonth.day()
  const daysInMonth = current.daysInMonth()
  const total = Math.ceil((leading + daysInMonth) / 7) * 7

  const cells = Array.from({ length: total }, (_, i) => startOfMonth.add(i - leading, 'day'))

  // Events (already type-filtered) bucketed by the day they cover.
  const byDay = {}
  for (const o of occurrences) {
    const s = occStart(o).startOf('day')
    const e = occEnd(o).startOf('day')
    for (const c of cells) {
      const d = c.startOf('day')
      if (!d.isBefore(s) && !d.isAfter(e)) (byDay[c.format('YYYY-MM-DD')] ||= []).push(o)
    }
  }

  const openDay = (day) => onDateClick?.(day, VIEW.DAY)

  return (
    <div className="card overflow-hidden">
      {/* Weekday header — Phase 6.4 (TASK 7): Sunday (index 0) is tinted to
          match the calendar's own Sunday colour treatment in the grid below. */}
      <div className="grid grid-cols-7 border-b border-app">
        {WEEKDAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={cn(
              'py-2 text-center text-xs font-semibold uppercase tracking-wide',
              i === 0 ? 'text-danger' : 'text-muted',
            )}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 grid-rows-6" style={{ minHeight: '62vh' }}>
        {cells.map((day) => {
          const key = day.format('YYYY-MM-DD')
          const dayEvents = byDay[key] || []
          const isToday = day.isSame(today, 'day')
          const isOtherMonth = day.month() !== current.month()
          const over = dragOverDate === key
          // Phase 6.4 (TASK 7): Sunday cells get a light danger tint so the
          // weekly day-off reads clearly at a glance, distinct from every
          // event-type colour.
          const isSunday = day.day() === 0

          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverDate(key)
              }}
              onDragLeave={() => setDragOverDate((p) => (p === key ? null : p))}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverDate(null)
                onDropToDay?.(day)
              }}
              onClick={(e) => {
                // Clicks on empty space create a new event on this date.
                if (e.target === e.currentTarget) onDateClick?.(day, 'create')
              }}
              className={cn(
                'group relative min-h-[88px] border-b border-r border-app p-1 transition',
                isOtherMonth && 'bg-black/[0.02] dark:bg-white/[0.02]',
                isSunday && !isOtherMonth && 'bg-danger/[0.04]',
                over && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  openDay(day)
                }}
                className={cn(
                  'mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                  isToday ? 'bg-primary text-white' : 'text-muted hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                {day.date()}
              </button>

              <div className="space-y-1">
                {dayEvents.slice(0, MAX_VISIBLE).map((o) => (
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
                {dayEvents.length > MAX_VISIBLE && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onShowMore?.(day)
                    }}
                    className="w-full rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-primary hover:underline"
                  >
                    +{dayEvents.length - MAX_VISIBLE} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
