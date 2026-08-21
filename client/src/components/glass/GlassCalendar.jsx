import { useState } from 'react'
import dayjs from 'dayjs'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { cn } from '@/utils'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// Compact glass month calendar (Sunday-start). Used as a dashboard widget and,
// since Phase 6.21 (TASK 2), as the month grid inside the shared meeting
// date/time picker (features/calendar/MeetingDateTimePicker.jsx).
//
// Phase 6.21 (TASK 2): `isDateDisabled` is an OPTIONAL predicate so a caller
// that has booking rules (Sundays / Company Holidays for meetings) can express
// them here instead of forking a second month grid. It defaults to undefined,
// so every existing caller renders and behaves EXACTLY as before.
export function GlassCalendar({ value, onSelect, className, isDateDisabled }) {
  const initial = value && dayjs(value).isValid() ? dayjs(value) : dayjs()
  const [cursor, setCursor] = useState(initial)
  const today = dayjs().startOf('day')
  const selected = value && dayjs(value).isValid() ? dayjs(value).startOf('day') : null

  const first = cursor.startOf('month')
  const start = first.subtract(first.day(), 'day')
  const days = Array.from({ length: 42 }, (_, i) => start.add(i, 'day'))

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{cursor.format('MMMM YYYY')}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((c) => c.subtract(1, 'month'))}
            aria-label="Previous month"
            className="rounded-lg p-1.5 text-muted transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
          >
            <FiChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor((c) => c.add(1, 'month'))}
            aria-label="Next month"
            className="rounded-lg p-1.5 text-muted transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
          >
            <FiChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const inMonth = d.month() === cursor.month()
          const isToday = d.isSame(today, 'day')
          const isSelected = selected && d.isSame(selected, 'day')
          const disabled = typeof isDateDisabled === 'function' ? Boolean(isDateDisabled(d)) : false
          return (
            <button
              type="button"
              key={d.valueOf()}
              disabled={disabled}
              aria-disabled={disabled}
              onClick={() => { if (!disabled) onSelect?.(d) }}
              className={cn(
                'flex h-9 items-center justify-center rounded-xl text-sm transition',
                !inMonth && 'text-muted opacity-50',
                disabled && 'cursor-not-allowed text-muted line-through opacity-40',
                inMonth && !disabled && !isToday && !isSelected && 'hover:bg-black/5 dark:hover:bg-white/10',
                isToday && !isSelected && 'font-semibold text-primary',
                isSelected && 'bg-primary font-semibold text-white shadow-glow-primary'
              )}
            >
              {d.date()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
