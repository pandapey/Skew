import dayjs from 'dayjs'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { Card, CardHeader, Button } from '@/components/ui'
import { CALENDAR_TONE } from './constants'

// ---------------------------------------------------------------------------
// PHASE 6 (TASK 3) - MONTH NAVIGATION
// ---------------------------------------------------------------------------
// ROOT CAUSE of "the calendar opens on July 2026 and never updates":
//
//   const [current, setCurrent] = useState(dayjs('2026-07-15'))
//
// The month was a HARD-CODED DATE LITERAL, so the calendar always opened on
// July 2026 no matter what today is. It was also component-local state, so the
// page above it had no idea which month was on screen and could not scope its
// attendance query to it - the < and > buttons only ever moved the grid while
// the data underneath stayed whatever the one unscoped request had returned.
//
// FIX: the month is a CONTROLLED value owned by the page
// (pages/Attendance.jsx), which seeds it from dayjs() - the same "start on
// today" rule features/calendar/CalendarApp.jsx uses (`useState(() => dayjs())`)
// - and uses it in the React Query key AND in the request params. This
// component only renders and raises change events, exactly like MonthView does
// for the main Calendar. No second calendar engine and no second date library:
// dayjs is the one this project already uses everywhere.
//
// `current` / `onChange` are optional so any other caller keeps working: with
// no props it falls back to the CURRENT month (never a literal).
// ---------------------------------------------------------------------------

// `calendar` = { 'YYYY-MM-DD': status }, `holidays` = [{ date, name }].
export function AttendanceCalendar({ calendar = {}, holidays = [], current, onChange }) {
  // dayjs() is local time, and every key below is produced with
  // .format('YYYY-MM-DD') from that same local value, so a day cell and the
  // date string it looks up in `calendar` can never disagree by a timezone
  // offset. The server stores and compares the identical plain 'YYYY-MM-DD'
  // strings (Attendance.date), so no Date object is built on either side of a
  // month boundary - which is exactly why 2026-08-01 cannot become 2026-07-31.
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

  // PHASE SALARY/PROJECT AUDIT (ATTENDANCE BUG 1) — SATURDAY SHOWN AS A
  // WEEKEND WHILE PAYROLL CHARGES IT AS A WORKING DAY.
  //
  // ROOT CAUSE: this cell test was `wd === 0 || wd === 6`, a hardcoded two-day
  // weekend that exists nowhere else in the system. The company's actual rule
  // lives in server/src/utils/leaveDays.js and is SUNDAY ONLY — its own header
  // says so, `countWorkingDays()` skips only `SUNDAY`, `resolveLeaveDuration()`
  // rejects only Sundays, and meetingRules.meetingDateRejection() blocks only
  // Sundays. attendanceService.mySummary() derives the payroll denominator from
  // that same helper.
  //
  // So an employee looking at this calendar saw every Saturday greyed out as a
  // non-working day, while payroll counted that Saturday as a working day and —
  // if they had not checked in — charged it as an unpaid loss-of-pay day. The
  // calendar and the payslip disagreed about the same date.
  //
  // FIX: one weekly off (Sunday), matching the single source of truth. The tone
  // key stays 'Weekend' so features/attendance/constants.js CALENDAR_TONE and
  // every other consumer are untouched; only the label shown to the user is
  // corrected to "Weekly Off", which is what it actually is.
  const WEEKLY_OFF_DAY = 0 // Sunday — mirrors SUNDAY in server/src/utils/leaveDays.js
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
            {/* "Today" mirrors the main Calendar's toolbar button
                (CalendarApp.jsx: onClick={() => setCurrent(dayjs())}). Hidden
                while already on this month so it is never a dead control. */}
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
