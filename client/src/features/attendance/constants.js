export const ATTENDANCE_STATUS = ['Present', 'Late', 'Early Exit', 'Absent', 'On Leave']
export const SHIFT_NAMES = ['General', 'Morning', 'Evening', 'Night']
export const HOLIDAY_TYPES = ['Public', 'National', 'Festival', 'Optional']

export const STATUS_TONE = {
  Present: 'success', Late: 'warning', 'Early Exit': 'accent',
  Absent: 'danger', 'On Leave': 'default', 'Not Marked': 'default',
}

export const CALENDAR_TONE = {
  Present: 'bg-success/15 text-success', Late: 'bg-warning/15 text-warning',
  'Early Exit': 'bg-accent/15 text-accent', Absent: 'bg-danger/15 text-danger',
  'On Leave': 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  Holiday: 'bg-primary/15 text-primary', Weekend: 'bg-black/5 text-muted dark:bg-white/5',
}

export const ATTENDANCE_WRITE_ROLES = ['Admin', 'Manager']

// Sunday (dayjs .day() === 0) is the company weekly off.
// Used by AttendanceCalendar to mark weekends.
export const WEEKLY_OFF_DAY = 0
