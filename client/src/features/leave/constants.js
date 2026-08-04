// Phase 5 (Task 6): 'Expired' is a terminal status applied automatically when
// a request was never actioned before the shift start time on its first day of
// leave. It is included in this list so it appears in every status filter,
// report grouping and dashboard breakdown that maps over LEAVE_STATUS.
export const LEAVE_STATUS = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired']

export const LEAVE_STATUS_TONE = {
  Pending: 'warning', Approved: 'success', Rejected: 'danger', Cancelled: 'default',
  // Neutral-but-visible: an expired request is not a rejection (nobody made a
  // decision), so it must not be coloured like one.
  Expired: 'default',
}

// Statuses that can no longer be acted on by anyone. Used to hide the
// Approve/Reject/Cancel controls; the server enforces the same rule in
// leaveService.decide() and leaveService.cancel().
export const LEAVE_TERMINAL_STATUSES = ['Approved', 'Rejected', 'Cancelled', 'Expired']

export const isLeaveActionable = (status) => status === 'Pending'

export const LEAVE_APPROVE_ROLES = ['Admin', 'HR', 'Manager']

// --- Phase 4: Sunday holidays & half-day leave -------------------------------
// This mirrors server/src/utils/leaveDays.js EXACTLY. The server remains the
// authority (it recomputes duration on every apply and never trusts the client
// `days` value); this copy exists purely so the form can show a live, accurate
// day count and block invalid dates before submitting.

export const SUNDAY = 0
export const HALF_DAY_SESSIONS = ['First Half', 'Second Half']
export const HALF_DAY_VALUE = 0.5

// Phase 5.5 (Task 3): mirrors MAX_LEAVE_DAYS_PER_REQUEST in
// server/src/utils/leaveDays.js. The server is still the authority — it
// re-applies this cap in leaveService.apply() against its own recomputed day
// count — but the form needs the number to give feedback before submitting.
export const MAX_LEAVE_DAYS_PER_REQUEST = 5

// Phase 5.5 (Task 4): mirrors HOURLY_PERMISSION_MONTHLY_HOURS in
// server/src/utils/leaveDays.js. Used only to render the allowance before the
// live balance loads; the server derives and enforces the real figure.
export const HOURLY_PERMISSION_MONTHLY_HOURS = 3
export const HOURLY_PERMISSION_STEP_HOURS = 0.5

// Format 1 as "1h" and 1.5 as "1.5h".
export function formatHours(hours) {
  const n = Number(hours) || 0
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`
}

// Parse YYYY-MM-DD as a LOCAL date. `new Date('2025-01-05')` parses as UTC and
// can report the wrong weekday, which would misidentify Sundays.
export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim())
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

// --- Phase 6.9 (TASK 2): company-holiday awareness in the form -----------------
// server/src/utils/leaveDays.js ALREADY accepts a Set of holiday date keys and
// excludes them from the chargeable count. The client mirror never did, which
// is why a holiday-only range could only be rejected AFTER submit — as a toast
// raised by the api/client.js error interceptor. These helpers close that gap
// so the same rule can be evaluated inline, before submit.

// YYYY-MM-DD key for a Date or date-ish value, computed in LOCAL time so it
// matches how Holiday.date is stored and how parseDate() reads it.
export function toDateKey(value) {
  const d = parseDate(value)
  if (!d) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Normalise whatever the /leave/holidays endpoint returns (array of Holiday
// documents, or plain date strings) into a Set of YYYY-MM-DD keys.
export function toHolidaySet(holidays = []) {
  const set = new Set()
  for (const h of holidays || []) {
    const key = toDateKey(typeof h === 'string' ? h : h?.date)
    if (key) set.add(key)
  }
  return set
}

// Is this date a company holiday (Sunday, or a Holiday record)?
export function isCompanyHoliday(value, holidaySet) {
  if (isSunday(value)) return true
  if (!holidaySet || typeof holidaySet.has !== 'function') return false
  const key = toDateKey(value)
  return key ? holidaySet.has(key) : false
}

// Names of the declared holidays that fall inside an inclusive range. Used to
// render the inline banner (Sundays are excluded — they get their own copy).
export function listHolidaysInRange(from, to, holidays = []) {
  const a = parseDate(from)
  const b = parseDate(to)
  if (!a || !b) return []
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  if (b < a) return []
  const byKey = new Map()
  for (const h of holidays || []) {
    const key = toDateKey(typeof h === 'string' ? h : h?.date)
    if (key && !byKey.has(key)) byKey.set(key, typeof h === 'string' ? 'Company Holiday' : (h?.name || 'Company Holiday'))
  }
  const out = []
  const cursor = new Date(a)
  while (cursor <= b) {
    const key = toDateKey(cursor)
    if (byKey.has(key)) out.push({ date: key, name: byKey.get(key) })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

// Inclusive count of chargeable days, skipping Sundays and — when supplied —
// declared company holidays. `holidaySet` is OPTIONAL: every pre-existing
// caller that passes two arguments keeps its exact previous behaviour.
export function countWorkingDays(from, to, holidaySet) {
  const a = parseDate(from)
  const b = parseDate(to)
  if (!a || !b) return 0
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  if (b < a) return 0
  let days = 0
  const cursor = new Date(a)
  while (cursor <= b) {
    if (!isCompanyHoliday(cursor, holidaySet)) days += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

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

// Chargeable days for a request shape. Half-day collapses to 0.5.
// `holidaySet` is optional and additive (Phase 6.9 TASK 2).
export function resolveLeaveDuration({ from, to, halfDay = false, holidaySet } = {}) {
  if (halfDay) return from && !isCompanyHoliday(from, holidaySet) ? HALF_DAY_VALUE : 0
  return countWorkingDays(from, to, holidaySet)
}

// --- Phase 6.9 (TASK 16): maternity / paternity are exempt from the 5-day cap --
// Mirrors CAP_EXEMPT_LEAVE_TYPES in server/src/utils/leaveDays.js. The server
// stays the authority; this copy only drives inline form feedback.
export const CAP_EXEMPT_LEAVE_TYPES = ['Maternity Leave', 'Paternity Leave']

export const isCapExemptLeaveType = (type) =>
  CAP_EXEMPT_LEAVE_TYPES.some((t) => t.toLowerCase() === String(type || '').trim().toLowerCase())

// Effective per-request maximum for a leave type. Exempt types are limited by
// the available balance instead of the flat policy cap.
export function maxDaysForRequest(type, availableBalance) {
  if (!isCapExemptLeaveType(type)) return MAX_LEAVE_DAYS_PER_REQUEST
  const bal = Number(availableBalance)
  return Number.isFinite(bal) && bal > 0 ? bal : Infinity
}

// --- Phase 6.12 (TASK 4): overlapping leave dates, detected INLINE ------------
//
// ROOT CAUSE of the toast: the overlap rule has always been enforced ONLY on
// the server, in leaveService.assertDatesAreRequestable() (Phase 6.9 TASK 5),
// which throws ApiError(422, 'These dates overlap an existing ... request').
// The apply form had no notion of the employee's other requests at all, so the
// breach could not be discovered until submit, and the 422 was surfaced by the
// global api/client.js response interceptor as a TOAST.
//
// This mirrors the SERVER's test exactly - the standard inclusive interval
// overlap `existing.from <= new.to && existing.to >= new.from`, restricted to
// the same blocking statuses ('Pending', 'Approved'), so Rejected / Cancelled /
// Expired requests release their dates here just as they do server-side. The
// server remains the authority and still re-runs the identical check on submit;
// this copy exists purely to render the message inline, in the same banner the
// day-cap rule uses.
export const OVERLAP_BLOCKING_STATUSES = ['Pending', 'Approved']

// Returns the first blocking request that overlaps [from, to], or null.
// `requests` is the employee's own leave list (leaveApi.myRequests -> /leave/me).
// `excludeId` lets a caller ignore a request being edited.
export function findOverlappingLeave(requests = [], { from, to, excludeId } = {}) {
  const startKey = toDateKey(from)
  const endKey = toDateKey(to) || startKey
  if (!startKey || !endKey) return null
  return (requests || []).find((r) => {
    if (!r) return false
    if (excludeId && String(r.id || r._id) === String(excludeId)) return false
    if (!OVERLAP_BLOCKING_STATUSES.includes(r.status)) return false
    const rFrom = toDateKey(r.from)
    const rTo = toDateKey(r.to) || rFrom
    if (!rFrom || !rTo) return false
    // Date keys are 'YYYY-MM-DD', so lexicographic comparison is chronological.
    return rFrom <= endKey && rTo >= startKey
  }) || null
}

// Human-readable span for an overlapping request, matching the server's wording
// ("2026-08-03" for a single day, "2026-08-03 to 2026-08-05" for a range).
export function formatLeaveSpan(request) {
  const rFrom = toDateKey(request?.from)
  const rTo = toDateKey(request?.to) || rFrom
  if (!rFrom) return ''
  return rFrom === rTo ? rFrom : `${rFrom} to ${rTo}`
}

// Format 0.5 as "0.5 day", 1 as "1 day", 3 as "3 days".
export function formatDays(days) {
  const n = Number(days) || 0
  const label = Number.isInteger(n) ? String(n) : n.toFixed(1)
  return `${label} day${n === 1 ? '' : 's'}`
}

// BREAKING-CHANGE NOTE: `daysBetween` previously counted Sundays. It is kept as
// a named export (other modules import it) but now delegates to the
// Sunday-excluding calculation so every caller stays consistent.
export function daysBetween(from, to) {
  return countWorkingDays(from, to)
}
