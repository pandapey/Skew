import { useState } from 'react'
import dayjs from 'dayjs'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { Card, CardHeader } from '@/components/ui'
import { CALENDAR_TONE } from './constants'

// Monthly attendance calendar. `calendar` = { 'YYYY-MM-DD': status }, `holidays` = [{date,name}].
export function AttendanceCalendar({ calendar = {}, holidays = [] }) {
  const [current, setCurrent] = useState(dayjs('2026-07-15'))
  const holidayMap = Object.fromEntries(holidays.map((h) => [h.date, h.name]))

  const startOfMonth = current.startOf('month')
  const daysInMonth = current.daysInMonth()
  const startWeekday = startOfMonth.day()

  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const statusFor = (day) => {
    const dateStr = current.date(day).format('YYYY-MM-DD')
    if (holidayMap[dateStr]) return 'Holiday'
    if (calendar[dateStr]) return calendar[dateStr]
    const wd = current.date(day).day()
    if (wd === 0 || wd === 6) return 'Weekend'
    return null
  }

  const legend = ['Present', 'Late', 'Early Exit', 'Absent', 'On Leave', 'Holiday']

  return (
    <Card>
      <CardHeader
        title="Attendance Calendar"
        subtitle={current.format('MMMM YYYY')}
        action={
          <div className="flex gap-1">
            <button className="btn-ghost px-2 py-1.5" onClick={() => setCurrent(current.subtract(1, 'month'))} aria-label="Previous month"><FiChevronLeft /></button>
            <button className="btn-ghost px-2 py-1.5" onClick={() => setCurrent(current.add(1, 'month'))} aria-label="Next month"><FiChevronRight /></button>
          </div>
        }
      />

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const status = statusFor(day)
          const dateStr = current.date(day).format('YYYY-MM-DD')
          return (
            <div key={i}
              title={holidayMap[dateStr] || status || ''}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${status ? CALENDAR_TONE[status] : 'text-muted'}`}>
              <span className="font-medium">{day}</span>
              {status && status !== 'Weekend' && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current" />}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-app pt-3 text-xs">
        {legend.map((l) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-full ${CALENDAR_TONE[l]}`} />{l}
          </span>
        ))}
      </div>
    </Card>
  )
}
