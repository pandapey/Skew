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
  // Standard Sunday-start month grid: 42 cells (6 rows x 7 days).
  const sunday = startOfMonth.subtract(startOfMonth.day(), 'day')
  const cells = []
  {
    let d = sunday
    while (cells.length < 42) {
      cells.push(d)
      d = d.add(1, 'day')
    }
  }

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
      {/* Weekday header — Sunday to Saturday */}
      <div className="grid grid-cols-7 border-b border-app">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">
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
