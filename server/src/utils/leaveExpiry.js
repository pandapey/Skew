// Phase 5 — single source of truth for "when does a pending leave request stop
// being actionable?".
//
// Tasks 6 (expiry) and 7 (reminders) are the same clock question asked twice:
//   Task 6: has the shift-start instant PASSED?        -> expire it
//   Task 7: how long UNTIL the shift-start instant?    -> remind HR
// Both import from here so the two features can never disagree about the
// deadline, which would produce the worst possible bug: a "2 hours left"
// reminder for a request that is already Expired.
//
// PHASE ADMIN ATTENDANCE (TASK 1) — this module is now ALSO the single source of
// truth for "which Shift document governs this employee?", because attendance
// lateness is the same question a third time. `resolveShiftConfig` below returns
// the whole resolved shift (start / end / grace / contracted hours) using the
// EXACT matching rule tier 1 of `resolveShiftStart` has always used, so leave
// expiry and attendance lateness can never disagree about which shift a person
// is on. Nothing about the pre-existing leave behaviour changes: the tiers, the
// order and the fallback constant are untouched.

import { Shift } from '../models/attendanceModels.js'
import { Setting } from '../models/adminModels.js'
import { parseDate } from './leaveDays.js'

// Reminder milestones, in hours before shift start. Ordered widest-first so the
// sweeper always fires the EARLIEST milestone a request has crossed rather than
// spamming every milestone at once after downtime.
export const REMINDER_MILESTONES = [
  { key: '24h', hours: 24, label: '24 hours' },
  { key: '12h', hours: 12, label: '12 hours' },
  { key: '2h', hours: 2, label: '2 hours' },
]

// Last-resort shift start, used ONLY when the database can answer nothing:
// no Setting, no matching Shift document, and no Shift collection at all.
// It is deliberately a named constant rather than a literal buried in the
// logic, and it is the LOWEST-priority source (see resolveShiftStart below).
const FALLBACK_SHIFT_START = '09:00'

// "HH:mm" -> minutes since midnight. Returns null for anything unparseable so
// callers can fall through to the next source instead of silently using 00:00,
// which would expire every request the instant it was created.
export function parseClock(value) {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(value ?? ''))
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// Resolve the shift start time (in minutes past midnight) that applies to one
// employee, in strict priority order. Every tier reads from MongoDB; the
// hardcoded constant is only reachable when the database has no answer at all.
//
//   1. The Shift document matching the employee's assigned shift name.
//      Employee.shift holds display strings like "General (9–6)" while
//      Shift.name is "General", so we match on prefix/containment rather than
//      strict equality.
//   2. The admin-configured default in Setting { category: 'leave' }.
//   3. The Shift document flagged as the organisation default, else the
//      earliest-starting shift on record.
//   4. FALLBACK_SHIFT_START.
//
// `shifts` and `setting` are passed in (already fetched) so the sweeper can
// resolve thousands of requests without re-querying per document.
// Find the Shift DOCUMENT assigned to one employee. Extracted verbatim from
// tier 1 of resolveShiftStart (which now calls it) so there is exactly ONE
// implementation of the employee -> shift matching rule in the codebase.
// Employee.shift holds display strings like "General (9–6)" while Shift.name is
// "General", hence the prefix/containment match rather than strict equality.
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

  // 1. Match the employee's own assigned shift.
  if (wanted) {
    const match = findShiftFor(employeeShiftName, shifts)
    const mins = match ? parseClock(match.start) : null
    if (mins != null) return mins
  }

  // 2. Admin-configured organisation default.
  const configured = parseClock(setting?.data?.defaultShiftStart)
  if (configured != null) return configured

  // 3. Earliest shift on record (a reasonable org-wide deadline).
  const starts = shifts.map((s) => parseClock(s.start)).filter((v) => v != null)
  if (starts.length) return Math.min(...starts)

  // 4. Nothing in the database could answer.
  return parseClock(FALLBACK_SHIFT_START)
}

// PHASE ADMIN ATTENDANCE (TASK 1) ------------------------------------------
//
// These two mirror the SCHEMA defaults on models/attendanceModels.js
// (`graceMins: 15`, `hours: 9`). They are only reachable when the resolved Shift
// document genuinely does not carry the field — they are never used in place of
// a configured value, and they are not a second, competing business rule.
export const DEFAULT_GRACE_MINS = 15
export const DEFAULT_SHIFT_HOURS = 9

// Resolve the FULL shift configuration that governs one employee: start, end,
// grace period and contracted hours, all read from the Shift collection.
//
// `candidateNames` is an ORDERED list of shift names to try, most authoritative
// first. Attendance passes [ Employee.shift, User.shift, Attendance.shift ] —
// the assigned shift wins, and the shift already stamped on the attendance
// record (schema default 'General') is the last named candidate.
//
// RESOLUTION ORDER, and why it stops where it does:
//   1. A Shift document matching one of the candidate names.
//   2. The organisation's ONLY shift, when exactly one is defined — with a
//      single shift there is nothing to guess at.
//   3. The admin-configured `defaultShiftStart` (Setting { category: 'leave' }),
//      which yields a start time but no end/grace/hours document.
//   4. NOTHING. `startMins` comes back null and the caller must NOT judge.
//
// Step 4 is deliberate and is the reason this does not simply delegate to
// resolveShiftStart(). That function's last resorts are "the earliest-starting
// shift on record" and the 09:00 constant, which are sensible for a leave
// DEADLINE (earliest = most conservative) but wrong for attendance: with shifts
// of 06:00 / 09:00 / 14:00 / 22:00 on file, an employee with no assigned shift
// would be judged against 06:00 and stamped Late every single day. Marking
// somebody late against a shift they are not on is precisely the defect this
// task lists ("attendance calculation using a fallback/default shift instead of
// the employee's assigned shift"), so when the data cannot answer, this returns
// "unknown" rather than a guess. Leave expiry keeps using resolveShiftStart and
// is completely unaffected.
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
    // null means "the database could not tell us when this person starts".
    startMins: docStart != null ? docStart : configuredStart,
    endMins: doc ? parseClock(doc.end) : null,
    graceMins: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_GRACE_MINS,
    hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SHIFT_HOURS,
    // True only when a named candidate actually matched a Shift document.
    matched: !!own,
  }
}

// Combine a leave start date (YYYY-MM-DD) with a shift start time to produce
// the exact instant the request stops being actionable.
export function buildExpiryInstant(fromDate, shiftStartMins) {
  const day = parseDate(fromDate)
  if (!day) return null
  const mins = shiftStartMins == null ? parseClock(FALLBACK_SHIFT_START) : shiftStartMins
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  at.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
  return at
}

// Load the two shared lookups once per sweep.
export async function loadShiftContext() {
  const [shifts, setting] = await Promise.all([
    Shift.find().lean(),
    Setting.findOne({ category: 'leave' }).lean(),
  ])
  return { shifts, setting }
}

// Convenience: resolve a request's expiry instant from its own stored value,
// falling back to recomputing it for documents created before Phase 5 (which
// have no `expiresAt`). This is what makes the sweeper correct for the existing
// backlog without requiring the migration to have run first.
export function expiryFor(request, ctx, employeeShiftName) {
  if (request.expiresAt) return new Date(request.expiresAt)
  return buildExpiryInstant(request.from, resolveShiftStart(employeeShiftName, ctx))
}
