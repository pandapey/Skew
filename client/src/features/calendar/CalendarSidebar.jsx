// Left rail: mini-month navigator + "My Calendars" category toggles.
import dayjs from 'dayjs'
import { FiPlus } from 'react-icons/fi'
import { cn } from '@/utils'
import { Button } from '@/components/ui'
import { EVENT_TYPES, TYPE_META, WEEKDAY_LABELS } from './constants'

export default function CalendarSidebar({ current, today, activeTypes, onToggleType, onSelectDate, onCreate }) {
  const start = current.startOf('month')
  const leading = start.day()
  const days = current.daysInMonth()
  const cells = Array.from({ length: Math.ceil((leading + days) / 7) * 7 }, (_, i) =>
    start.add(i - leading, 'day'),
  )

  return (
    <div className="space-y-4">
      {onCreate && (
        <Button className="w-full" icon={FiPlus} onClick={onCreate}>
          Create
        </Button>
      )}

      {/* Mini month */}
      <div className="card p-4">
        <div className="mb-2 text-center text-sm font-semibold">{current.format('MMMM YYYY')}</div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-muted">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d}>{d.charAt(0)}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-0.5">
          {cells.map((day) => {
            const isToday = day.isSame(today, 'day')
            const isSel = day.isSame(current, 'day')
            const other = day.month() !== current.month()
            return (
              <button
                key={day.format('YYYY-MM-DD')}
                onClick={() => onSelectDate(day)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs transition',
                  other && 'text-muted/50',
                  isToday && 'bg-primary font-semibold text-white',
                  !isToday && isSel && 'bg-primary/15 font-semibold text-primary',
                  !isToday && !isSel && 'hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                {day.date()}
              </button>
            )
          })}
        </div>
      </div>

      {/* My calendars */}
      <div className="card p-4">
        <h4 className="mb-3 text-sm font-semibold">My Calendars</h4>
        <div className="space-y-1">
          {EVENT_TYPES.map((t) => {
            const meta = TYPE_META[t]
            const Icon = meta.icon
            const on = activeTypes.includes(t)
            return (
              <button
                key={t}
                onClick={() => onToggleType(t)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border',
                    on ? meta.dot : 'border-app',
                  )}
                >
                  {on && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                </span>
                <Icon className={cn('h-4 w-4', meta.text)} />
                <span className={cn('flex-1', !on && 'text-muted line-through')}>{meta.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
