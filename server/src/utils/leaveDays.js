// Phase 4 — single source of truth for leave DURATION arithmetic.
//
// Two rules are encoded here and reused by every layer that needs to know how
// many days a leave request costs (apply, approve/deduct, balances, reports and
// the payroll/attendance read models):
//
//   1. Sundays are company holidays. They are never selectable and never
//      consume leave balance, even when a request spans across them.
//      Fri + Sat + Sun + Mon  =>  3 chargeable days (Sunday excluded).
//   2. A half-day request costs exactly 0.5 of a single working day.
//
// Keeping this in ONE module is what makes "everything stays synchronized"
// true: leaveService, the leave reports aggregation and the attendance/payroll
// read models all import from here rather than re-implementing day maths.

export const SUNDAY = 0

// Parse a YYYY-MM-DD string as a *local* calendar date. Using `new Date('...')`
// on a bare date string parses as UTC, which shifts the weekday for negative
// timezone offsets and would misclassify Sundays. This avoids that class of bug.
export function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function isSunday(value) {
  const d = parseDate(value)
  return d ? d.getDay() === SUNDAY : false
}

// Phase 6.4 (TASK 6): normalize any date-ish value to a 'YYYY-MM-DD' key so it
// can be compared against a Set of Company Holiday date strings regardless of
// whether the caller passed a Date object or a date string.
export function toDateKey(value) {
  const d = parseDate(value)
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Inclusive count of chargeable days between two dates, skipping Sundays and
// any date present in `holidays` (a Set of 'YYYY-MM-DD' Company Holiday date
// keys). `holidays` defaults to an empty Set so every existing caller that
// does not pass it keeps the exact prior Sunday-only behavior.
// Returns 0 for an invalid or inverted range.
export function countWorkingDays(from, to, holidays = new Set()) {
  const a = parseDate(from)
  const b = parseDate(to)
  if (!a || !b) return 0
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  if (b < a) return 0
  let days = 0
  const cursor = new Date(a)
  while (cursor <= b) {
    const isHoliday = holidays instanceof Set && holidays.has(toDateKey(cursor))
    if (cursor.getDay() !== SUNDAY && !isHoliday) days += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

// How many Sundays a range spans (used for transparent UI/report messaging).
export function countSundays(from, to) {
  const a = parseDate(from)
  const b = parseDate(to)
  if (!a || !b) return 0
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  if (b < a) return 0
  let n = 0
  const cursor = new Date(a)
  while (cursor <= b) {
    if (cursor.getDay() === SUNDAY) n += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return n
}

export const HALF_DAY_SESSIONS = ['First Half', 'Second Half']
export const HALF_DAY_VALUE = 0.5

// Phase 5.5 (Task 3) — a single leave REQUEST may span at most 5 chargeable
// days, independent of how much balance the employee holds. Declared here
// beside the rest of the duration arithmetic so the frontend, the apply
// service and any future caller all read the same number instead of each
// hardcoding a 5.
//
// Deliberately NOT enforced inside resolveLeaveDuration(): that helper is also
// called by approve, balances, reports and the payroll read models, which must
// keep recomputing historical requests correctly. Requests longer than 5 days
// already exist in MongoDB from earlier phases, and making the shared resolver
// reject them would break reading that history. The cap is therefore applied
// at the point of CREATION only (leaveService.apply), which preserves backward
// compatibility.
export const MAX_LEAVE_DAYS_PER_REQUEST = 5

// --- Phase 6.9 (TASK 16): maternity / paternity exemption --------------------
// Maternity and Paternity leave are statutory, continuous absences (the seeded
// entitlements are 180 and 15 days). Forcing them through the 5-day cap meant
// an employee had to file 36 separate requests for a single maternity leave,
// which is why the exemption is required. For these two types the effective
// per-request maximum becomes the AVAILABLE BALANCE instead of the flat cap.
//
// Declared beside MAX_LEAVE_DAYS_PER_REQUEST so the cap rule stays in ONE
// module; leaveService.apply() and the client mirror both read from here rather
// than each hardcoding the type names.
export const CAP_EXEMPT_LEAVE_TYPES = ['Maternity Leave', 'Paternity Leave']

// Case/whitespace-insensitive so a differently-cased seed or an imported legacy
// record still resolves correctly.
export function isCapExemptLeaveType(type) {
  const t = String(type || '').trim().toLowerCase()
  return CAP_EXEMPT_LEAVE_TYPES.some((x) => x.toLowerCase() === t)
}

// Effective per-request maximum. `availableBalance` is only consulted for the
// exempt types; every other type keeps the flat 5-day policy cap unchanged.
export function maxDaysForRequest(type, availableBalance) {
  if (!isCapExemptLeaveType(type)) return MAX_LEAVE_DAYS_PER_REQUEST
  const bal = Number(availableBalance)
  return Number.isFinite(bal) && bal > 0 ? bal : 0
}

// --- Phase 5.5 (Task 4): hourly permission allowance -------------------------
// Every employee gets 3 hours per CALENDAR MONTH.
//
// Design note on "reset automatically every month / no carry forward / no
// yearly accumulation": there is deliberately NO stored balance document and
// NO scheduled reset job. The remaining allowance is DERIVED on demand by
// summing the hours already committed within the requested date's calendar
// month. A derived balance resets on the 1st by construction, can never carry
// forward, and cannot drift out of sync with the underlying requests — whereas
// a stored counter would need a cron job that, if it ever failed to run, would
// silently grant or deny hours incorrectly.
export const HOURLY_PERMISSION_MONTHLY_HOURS = 3
// Requests are made in half-hour increments; 0.5h is the smallest useful unit
// and keeps 3h divisible into exactly six slots.
export const HOURLY_PERMISSION_STEP_HOURS = 0.5

// 'YYYY-MM' key for a date string or Date, in LOCAL time (parseDate already
// avoids the UTC shift that would misfile a request on the 1st or 31st).
export function monthKeyOf(value) {
  const d = parseDate(value)
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Inclusive first/last calendar day of a 'YYYY-MM' key, as YYYY-MM-DD strings.
// Used to build the indexed range query that derives the monthly usage, so the
// lookup matches how `from`/`to` are stored (plain date strings).
export function monthBounds(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const last = new Date(year, month, 0).getDate()
  return {
    start: `${m[1]}-${m[2]}-01`,
    end: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`,
  }
}

// --- Phase 6.9 (TASK 3): month-end expiry instant ----------------------------
// AUDIT RESULT (recorded here because the fix is a rule, not a patch): the
// codebase was grepped for every expiry path — utils/leaveExpiry.js,
// services/leaveScheduler.js, leaveService.expireStaleRequests() and
// migrations/phase5-migrate.js. All of those expire an individual PENDING
// REQUEST at the shift-start time of its first leave day; none of them expire a
// monthly BALANCE. The only month-boundary arithmetic in the server was
// monthBounds() above, which already resolves the true last calendar day via
// `new Date(year, month, 0).getDate()`.
//
// The "expires one day before month end" behaviour is nevertheless easy to
// reintroduce accidentally, because the two idioms that produce it —
// `new Date(y, m + 1, 0)` left at 00:00:00 (which makes anything later on the
// last day already "expired"), and `setDate(last - 1)` — look correct at a
// glance. This helper removes the ambiguity by publishing ONE authoritative
// month-end instant that every current and future balance-expiry calculation
// must use: the last calendar day of the month at 23:59:59.999 local time.
// A balance is therefore live for the whole of the final day and expires only
// once the month is genuinely over.

// Last calendar day of the month containing `value`, at 23:59:59.999 local.
export function monthExpiryInstant(value = new Date()) {
  const d = parseDate(value) || new Date()
  // Day 0 of the FOLLOWING month is the last day of this month.
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

// 'YYYY-MM-DD' of the last calendar day of the month containing `value`.
export function monthEndDateKey(value = new Date()) {
  return toDateKey(monthExpiryInstant(value))
}

// True only once the month containing `value` is completely over. Use this
// instead of any `<`/`<=` comparison against a bare month-end date, which is
// where the off-by-one-day class of bug originates.
export function isMonthBalanceExpired(value, at = new Date()) {
  const expiry = monthExpiryInstant(value)
  const now = at instanceof Date ? at : new Date(at)
  return now.getTime() > expiry.getTime()
}

// Authoritative chargeable-days resolver for a leave request payload.
// `halfDay` collapses the request to a single 0.5-day working day.
// `holidays` (Phase 6.4, TASK 6) is an optional Set of 'YYYY-MM-DD' Company
// Holiday date keys; when provided, those dates are excluded from the
// chargeable count in addition to Sundays. This remains the ONE reusable
// duration calculation used by every caller (apply, approve, balances,
// reports, payroll read models) — callers that don't pass holidays keep the
// exact prior Sunday-only behavior.
// Throws-free: callers validate the returned `error`.
export function resolveLeaveDuration({ from, to, halfDay = false, halfDaySession = null, holidays = new Set() }) {
  if (!from || !to) return { days: 0, error: 'Both a start and end date are required' }
  if (isSunday(from) || isSunday(to)) {
    return { days: 0, error: 'Sundays are company holidays and cannot be selected as leave dates' }
  }

  if (halfDay) {
    if (String(from) !== String(to)) {
      return { days: 0, error: 'A half-day leave must start and end on the same date' }
    }
    if (!HALF_DAY_SESSIONS.includes(halfDaySession)) {
      return { days: 0, error: 'Select First Half or Second Half for a half-day leave' }
    }
    return { days: HALF_DAY_VALUE, sundaysExcluded: 0, error: null }
  }

  const days = countWorkingDays(from, to, holidays)
  if (days < 1) {
    return { days: 0, error: 'The selected range contains no working days, after excluding Sundays and Company Holidays' }
  }
  return { days, sundaysExcluded: countSundays(from, to), error: null }
}
