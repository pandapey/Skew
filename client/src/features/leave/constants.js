export const LEAVE_STATUS = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired']

export const LEAVE_STATUS_TONE = {
  Pending: 'warning', Approved: 'success', Rejected: 'danger', Cancelled: 'default',
  Expired: 'default',
}

export const LEAVE_TERMINAL_STATUSES = ['Approved', 'Rejected', 'Cancelled', 'Expired']
export const isLeaveActionable = (status) => status === 'Pending'
export const LEAVE_APPROVE_ROLES = ['Admin', 'Manager']
export const SUNDAY = 0
export const HALF_DAY_SESSIONS = ['First Half', 'Second Half']
export const HALF_DAY_VALUE = 0.5
export const MAX_LEAVE_DAYS_PER_REQUEST = 5
export const HOURLY_PERMISSION_MONTHLY_HOURS = 3
export const HOURLY_PERMISSION_STEP_HOURS = 0.5
export function formatHours(hours) {
  const n = Number(hours) || 0
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`
}

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

export function toDateKey(value) {
  const d = parseDate(value)
  if (!d) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

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

export function resolveLeaveDuration({ from, to, halfDay = false, holidaySet } = {}) {
  if (halfDay) return from && !isCompanyHoliday(from, holidaySet) ? HALF_DAY_VALUE : 0
  return countWorkingDays(from, to, holidaySet)
}

export const CAP_EXEMPT_LEAVE_TYPES = ['Maternity Leave', 'Paternity Leave']

export const isCapExemptLeaveType = (type) =>
  CAP_EXEMPT_LEAVE_TYPES.some((t) => t.toLowerCase() === String(type || '').trim().toLowerCase())

export function maxDaysForRequest(type, availableBalance) {
  if (!isCapExemptLeaveType(type)) return MAX_LEAVE_DAYS_PER_REQUEST
  const bal = Number(availableBalance)
  return Number.isFinite(bal) && bal > 0 ? bal : Infinity
}

export const OVERLAP_BLOCKING_STATUSES = ['Pending', 'Approved']

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

export function daysBetween(from, to) {
  return countWorkingDays(from, to)
}
