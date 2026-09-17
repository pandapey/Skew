import { Shift } from '../models/attendanceModels.js'
import { Setting } from '../models/adminModels.js'
import { parseDate } from './leaveDays.js'

export const REMINDER_MILESTONES = [
  { key: '24h', hours: 24, label: '24 hours' },
  { key: '12h', hours: 12, label: '12 hours' },
  { key: '2h', hours: 2, label: '2 hours' },
]

const FALLBACK_SHIFT_START = '09:00'

export function parseClock(value) {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(value ?? ''))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function findShiftFor(employeeShiftName, shifts = []) {
  const wanted = String(employeeShiftName || '').trim().toLowerCase()
  if (!wanted) return null
  return shifts.find((s) => {
    const name = String(s.name || '').trim().toLowerCase()
    if (!name) return false
    return wanted === name || wanted.startsWith(name) || wanted.includes(name)
  }) || null
}

export function resolveShiftStart(employeeShiftName, { shifts = [], setting = null } = {}) {
  const wanted = String(employeeShiftName || '').trim().toLowerCase()

  if (wanted) {
    const match = findShiftFor(employeeShiftName, shifts)
    const mins = match ? parseClock(match.start) : null
    if (mins != null) return mins
  }

  const configured = parseClock(setting?.data?.defaultShiftStart)
  if (configured != null) return configured

  const starts = shifts.map((s) => parseClock(s.start)).filter((v) => v != null)
  if (starts.length) return Math.min(...starts)

  return parseClock(FALLBACK_SHIFT_START)
}

export const DEFAULT_GRACE_MINS = 15
export const DEFAULT_SHIFT_HOURS = 9

export function resolveShiftConfig(candidateNames, ctx = {}) {
  const { shifts = [], setting = null } = ctx
  const names = (Array.isArray(candidateNames) ? candidateNames : [candidateNames])
    .filter((n) => String(n || '').trim())

  let own = null
  for (const n of names) {
    own = findShiftFor(n, shifts)
    if (own) break
  }

  const doc = own || (shifts.length === 1 ? shifts[0] : null)
  const docStart = doc ? parseClock(doc.start) : null
  const configuredStart = parseClock(setting?.data?.defaultShiftStart)

  const grace = Number(doc?.graceMins)
  const hours = Number(doc?.hours)
  return {
    name: doc?.name || '',

    startMins: docStart != null ? docStart : configuredStart,
    endMins: doc ? parseClock(doc.end) : null,
    graceMins: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_GRACE_MINS,
    hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SHIFT_HOURS,

    matched: !!own,
  }
}

export function buildExpiryInstant(dateValue) {
  const day = parseDate(dateValue)
  if (!day) return null
  // Leave requests expire at 23:59:59 on the last day of the month
  // containing the final leave day — a request running into the next
  // month (e.g. 29th → 3rd) expires at the next month's end.
  return new Date(day.getFullYear(), day.getMonth() + 1, 0, 23, 59, 59, 999)
}

export async function loadShiftContext() {
  const [shifts, setting] = await Promise.all([
    Shift.find().lean(),
    Setting.findOne({ category: 'leave' }).lean(),
  ])
  return { shifts, setting }
}

export function expiryFor(request, ctx, employeeShiftName) {
  if (request.expiresAt) return new Date(request.expiresAt)
  return buildExpiryInstant(request.to || request.from)
}
