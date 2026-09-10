import dayjs from 'dayjs'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { Card, CardHeader, Button } from '@/components/ui'
import { CALENDAR_TONE, WEEKLY_OFF_DAY } from './constants'

export function AttendanceCalendar({ calendar = {}, holidays = [], current, onChange }) {
  const month = current || dayjs()
  const holidayMap = Object.fromEntries(holidays.map((h) => [String(h.date).slice(0, 10), h.name]))

  const startOfMonth = month.startOf('month')
  const daysInMonth = month.daysInMonth()
  const startWeekday = startOfMonth.day()
  const isCurrentMonth = month.isSame(dayjs(), 'month')
  const todayKey = dayjs().format('YYYY-MM-DD')

  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const go = (next) => onChange?.(next)

  const statusFor = (dateStr, day) => {
    if (holidayMap[dateStr]) return 'Holiday'
    if (calendar[dateStr]) return calendar[dateStr]
    if (month.date(day).day() === WEEKLY_OFF_DAY) return 'Weekend'
    return null
  }

  const legend = ['Present', 'Late', 'Early Exit', 'Absent', 'On Leave', 'Holiday', 'Weekend']
  const legendLabel = (l) => (l === 'Weekend' ? 'Weekly Off (Sun)' : l)

  return (
    <Card>
      <CardHeader
        title="Attendance Calendar"
        subtitle={month.format('MMMM YYYY')}
        action={
          <div className="flex items-center gap-1">
            {!isCurrentMonth && (
              <Button size="sm" variant="ghost" onClick={() => go(dayjs().startOf('month'))}>Today</Button>
            )}
            <button
              className="btn-ghost px-2 py-1.5"
              onClick={() => go(month.subtract(1, 'month').startOf('month'))}
              aria-label="Previous month"
            >
              <FiChevronLeft />
            </button>
            <button
              className="btn-ghost px-2 py-1.5"
              onClick={() => go(month.add(1, 'month').startOf('month'))}
              aria-label="Next month"
            >
              <FiChevronRight />
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = month.date(day).format('YYYY-MM-DD')
          const status = statusFor(dateStr, day)
          const isToday = dateStr === todayKey
          return (
            <div key={i}
              title={holidayMap[dateStr] || status || ''}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${status ? CALENDAR_TONE[status] : 'text-muted'} ${isToday ? 'ring-1 ring-primary' : ''}`}>
              <span className="font-medium">{day}</span>
              {status && status !== 'Weekend' && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current" />}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-app pt-3 text-xs">
        {legend.map((l) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-full ${CALENDAR_TONE[l]}`} />{legendLabel(l)}
          </span>
        ))}
      </div>
    </Card>
  )
}
