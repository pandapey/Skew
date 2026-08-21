import { Attendance, Holiday } from '../models/attendanceModels.js'
// PHASE SALARY/PROJECT AUDIT (SALARY BUG 5): the EXISTING leave policy store.
// LeaveType.paid is the flag that already distinguishes paid leave from
// loss-of-pay leave; it is read here rather than a new "unpaid" concept being
// invented, so HR keeps configuring the rule from the Leave Types screen.
import { LeaveType, LeaveRequest } from '../models/leaveModels.js'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { ApiError } from '../utils/asyncHandler.js'
// PHASE ADMIN ATTENDANCE (TASK 1): the EXISTING shift resolver (already the
// single source of truth for leave expiry + HR reminders) is imported, not
// re-implemented, so "which shift is this employee on and when does it start?"
// has exactly one answer across the whole system.
import { loadShiftContext, resolveShiftConfig } from '../utils/leaveExpiry.js'
// PHASE ATTENDANCE STATUS (TASKS 1-3): the ONE shared per-person status
// resolver. This stats() endpoint and the Employees page's Status column both
// read from it, so the org-wide "Absent" count and the per-employee status can
// never disagree (see utils/attendanceStatus.js for the full rule).
import { computeTodayStatusMap, ATT_STATUS_ABSENT, ATT_STATUS_ON_LEAVE, ATT_STATUS_NOT_MARKED } from '../utils/attendanceStatus.js'
// Phase 6.12 (TASK 10): the EXISTING single source of truth for working-day
// arithmetic (Sundays + Company Holidays excluded). It is imported, not
// re-implemented, so payroll counts a working day exactly the way leave apply,
// leave approve, balances and the leave reports already count one.
import { countWorkingDays, toDateKey, parseDate } from '../utils/leaveDays.js'
// Phase 7.2 (TASK 3): the Overtime imports (OVERTIME_DAILY_CAP_HOURS,
// dayOvertime, overtimeBreakdown) were REMOVED together with the feature.
import { notifyUsersByName } from './notificationService.js'
import { emitResource } from '../realtime/index.js'

// Phase 5.7 (Task 5): Admin is an oversight role, not a tracked headcount, so
// it must never be required to mark attendance. Enforced on the SERVER as well
// as hidden in the UI — hiding the button alone would still leave the endpoint
// reachable, and an Admin attendance row would pollute every org-wide figure
// (totalEmployees, attendanceRate, department and role breakdowns).
const ATTENDANCE_EXEMPT_ROLES = ['Admin']
function assertMarksAttendance(user) {
  if (ATTENDANCE_EXEMPT_ROLES.includes(user?.role)) {
    throw new ApiError(403, 'Admin accounts are not required to mark attendance.')
  }
}

// Phase 6.9 (TASK 1): start instant of the currently-open break session, or
// null when no break is running. ONE helper, reused by getToday/toggleBreak so
// the "which break is open?" rule cannot drift between the two endpoints.
function openBreakStart(doc) {
  if (!doc || doc.checkOut) return null
  const open = [...(doc.breaks || [])].reverse().find((b) => b && b.start && !b.end)
  return open ? open.start : null
}

const today = () => new Date().toISOString().slice(0, 10)
const nowHMS = () => new Date().toTimeString().slice(0, 8)
const nowEpoch = () => Math.floor(Date.now() / 1000)

// Parse "HH:mm" to minutes-since-midnight.
const toMins = (hm) => {
  if (!hm) return 0
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

// ---------------------------------------------------------------------------
// PHASE ADMIN ATTENDANCE (TASK 1) — SHIFT-DRIVEN LATENESS
//
// TRACE: Attendance -> Shift Management (pages/attendance/Shifts.jsx)
//        -> attendanceApi.shifts -> /api/attendance/shifts (resourceRouter)
//        -> Shift model  { name, code, start, end, hours, graceMins }
//        -> employee check-in (CheckInCard -> POST /api/attendance/check-in)
//        -> attendanceController.checkIn -> attendanceService.checkIn
//        -> Attendance.status -> Attendance page / Dashboard / reports / payroll
//
// ROOT CAUSE: attendanceService.checkIn NEVER READ THE SHIFT COLLECTION. It
// decided lateness with a literal:
//
//     const late = toMins(checkIn) > 9 * 60 + 15   // after 09:15 grace
//
// so the entire Shift Management screen — start time AND the configured grace
// period — was decorative as far as attendance was concerned. With a shift
// configured to start at 09:30, anybody arriving after 09:15 (e.g. 09:20, a full
// ten minutes EARLY) was stamped 'Late'. That is the exact reported symptom.
// checkOut carried the same defect twice more: `< 17 * 60` for Early Exit
// (ignoring Shift.end) and `> 9` hours for overtime (ignoring Shift.hours).
//
// A third, quieter defect: the Attendance document's `shift` field was never
// written, so every record kept the schema default 'General'. mySummary() DOES
// read contracted hours out of the Shift collection, but it matches on that
// stale name — so overtime was computed against the wrong shift for anyone not
// actually on General.
//
// The fix resolves the employee's real shift from MongoDB and derives all three
// values from it. This is the ONLY place in the codebase that computes `late` /
// `earlyExit` / `status` (verified by grep: every other consumer — Attendance
// page, Dashboard, attendance reports, reportController, payrollEngine via
// mySummary — reads the stored `status`), so fixing it here fixes it everywhere
// without duplicating the calculation.
//
// TIMEZONE: both sides of the comparison are server-local minutes-since-midnight
// — `nowHMS()` formats the local wall clock and Shift.start is a local "HH:mm"
// typed by an admin. No UTC conversion happens on either side, so there is no
// UTC/local mismatch to correct. `checkInAt` / `checkInSeconds` remain absolute
// instants and are unaffected.
//
// Resolution order for the employee's shift name mirrors leaveService exactly:
// the linked Employee HR record first (canonical), then the User account. The
// shift already stamped on today's Attendance document is offered last — it is
// existing stored data (schema default 'General'), not an invented value, and it
// keeps records created before shifts were assigned resolving the same way they
// always did. If none of them names a real Shift, resolveShiftConfig returns
// `startMins: null` and NOTHING is judged — see its comment.
async function resolveShiftForUser(user, recordShiftName) {
  const [ctx, emp] = await Promise.all([
    loadShiftContext(),
    Employee.findOne({
      $or: [
        ...(user?._id ? [{ userId: user._id }] : []),
        ...(user?.empCode ? [{ empCode: user.empCode }] : []),
        { name: user?.name },
      ],
    }).select('shift -_id').lean(),
  ])
  return resolveShiftConfig([emp?.shift, user?.shift, recordShiftName], ctx)
}

// Is this check-in late? Late means "after the configured shift start PLUS the
// shift's own configured grace period" — the pre-existing business rule from the
// Shift schema (`graceMins`, surfaced and edited on the Shift Management page),
// applied to the configured start instead of to a hardcoded 09:00.
//
// With a 09:30 shift and graceMins = 0:  09:29 on time, 09:30 on time, 09:31 late.
// With the schema default graceMins = 15: the 15-minute allowance an admin can
// see and change on the Shift Management screen is honoured, as required.
const isLate = (checkInHMS, shift) => {
  if (!shift || shift.startMins == null) return false
  return toMins(checkInHMS) > shift.startMins + shift.graceMins
}

// Shift end as an absolute instant on the given (check-in) instant's LOCAL day.
// Overnight shifts (end earlier than start, e.g. 22:00 -> 06:00) land on the
// next day. Returns null when the Shift collection cannot answer.
function shiftEndInstant(inTime, shift) {
  if (!inTime || shift?.endMins == null) return null
  const d = new Date(inTime)
  d.setHours(Math.floor(shift.endMins / 60), shift.endMins % 60, 0, 0)
  if (shift.startMins != null && shift.endMins <= shift.startMins) {
    d.setDate(d.getDate() + 1)
  }
  return d
}

// ---------------------------------------------------------------------------
// CLOSING AN ATTENDANCE SESSION (ONE authoritative path). Used by checkOut()
// for a live logout — including a NEXT-DAY logout of a forgotten session — and
// by checkIn() for the safe auto-close of a session that was never logged out.
// Every derived figure (workingHours, durationSecs, earlyExit) is computed HERE
// and only here, so the server always validates from the stored attendance +
// resolved shift config and never trusts anything the client sends.
//
// Phase 7.2 (TASK 3): the Overtime split (auto/excess/approved, the review
// flag and the approval request) was REMOVED together with the feature. Worked
// time is now the plain elapsed wall time (checkOut − checkIn − breaks).
// A safe AUTO-CLOSE of a forgotten session is still bounded — at the
// configured shift end on its own check-in day, or at the end of that LOCAL
// DAY when no Shift config can answer — so a session left open across midnight
// can never absorb the next day's hours or inflate workingHours. A LIVE
// next-day logout records the real elapsed time.
async function finalizeSession(user, doc, checkOutAt, { autoClose = false } = {}) {
  const ts = new Date(checkOutAt)
  if (Number.isNaN(ts.getTime())) throw new ApiError(400, 'Invalid check-out time')
  doc.checkOut = ts.toTimeString().slice(0, 8)
  doc.checkOutAt = ts
  doc.checkOutSeconds = Math.floor(ts.getTime() / 1000)
  // Close any still-open break, then total all break time precisely.
  const openBreak = [...(doc.breaks || [])].reverse().find((b) => !b.end)
  if (openBreak) {
    openBreak.end = ts
    openBreak.seconds = Math.max(0, Math.floor((ts - new Date(openBreak.start)) / 1000))
  }
  doc.breakSecs = (doc.breaks || []).reduce((s, b) => s + (b.seconds || 0), 0)
  doc.breakMins = Math.round(doc.breakSecs / 60)
  doc.onBreak = false
  const breakSecs = doc.breakSecs

  const shift = await resolveShiftForUser(user, doc.shift)
  if (shift.name) doc.shift = shift.name

  // Early Exit — the pre-existing judgment, preserved verbatim (shift-driven,
  // overnight-aware). `endMins == null` means the Shift collection could not
  // answer at all; nothing is judged rather than inventing a literal.
  const overnightShift = shift.startMins != null && shift.endMins != null && shift.endMins <= shift.startMins
  if (shift.endMins == null) {
    doc.earlyExit = false
  } else if (overnightShift) {
    const outMins = toMins(doc.checkOut)
    const normalisedOut = outMins <= shift.endMins ? outMins + 24 * 60 : outMins
    doc.earlyExit = normalisedOut < shift.endMins + 24 * 60
  } else {
    doc.earlyExit = toMins(doc.checkOut) < shift.endMins
  }

  // Safe auto-close boundary (Phase 7.2 TASK 3, OT-free): a forgotten session
  // ends at the configured shift end on its OWN check-in day (e.g. 18:00 for a
  // 09:00-18:00 shift), or at the end of that local day when no Shift config
  // can answer, so it can never absorb the next day's hours or inflate
  // workingHours.
  let outAt = ts
  if (autoClose) {
    const endInst = shiftEndInstant(doc.checkInAt, shift)
    outAt = endInst || (() => {
      const dayEnd = new Date(doc.checkInAt)
      dayEnd.setHours(23, 59, 59, 0)
      return dayEnd
    })()
  }

  const checkInSecs = doc.checkInSeconds || Math.floor(new Date(doc.checkInAt).getTime() / 1000)
  const elapsedSecs = Math.max(0, Math.floor(outAt.getTime() / 1000) - checkInSecs - breakSecs)
  doc.durationSecs = elapsedSecs
  doc.workingHours = +(elapsedSecs / 3600).toFixed(1)
  if (doc.earlyExit && !doc.late) doc.status = 'Early Exit'
  await doc.save()
  emitResource('attendance', 'update', doc)
  return doc
}

// Resolve the calendar range [from,to] (YYYY-MM-DD) for a personal-summary
// query. Supports an explicit custom range (from/to), a specific month
// (year + 0-based month), a whole year (year only), or defaults to the
// current calendar month. Pure date math — no data access.
function resolveRange(query = {}) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  if (query.from && query.to) return { from: String(query.from), to: String(query.to) }
  const year = Number(query.year) || now.getFullYear()
  if (query.month != null && query.month !== '') {
    const m = Number(query.month) // 0-based
    const last = new Date(year, m + 1, 0).getDate()
    return { from: `${year}-${pad(m + 1)}-01`, to: `${year}-${pad(m + 1)}-${pad(last)}` }
  }
  if (query.year && query.month == null) {
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }
  const m = now.getMonth()
  const last = new Date(year, m + 1, 0).getDate()
  return { from: `${year}-${pad(m + 1)}-01`, to: `${year}-${pad(m + 1)}-${pad(last)}` }
}

// Attendance service: personal + org queries, check-in/out/break, analytics.
export const attendanceService = {
  async myHistory(user, query) {
    const { status, page = 1, limit = 8 } = query
    const filter = { employee: user.name }
    if (status) filter.status = status
    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(100, Number(limit))
    const [data, total] = await Promise.all([
      Attendance.find(filter).sort({ date: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Attendance.countDocuments(filter),
    ])
    return { data, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
  },

  // Personal attendance analytics for the LOGGED-IN employee only, over a
  // selected period (custom range / month / year / current month). All figures
  // are derived from that employee's own Attendance documents in MongoDB:
  //   Average Hours = total worked hours / working days (days actually worked)
  //   Overtime      = Phase 7.2 (TASK 3): feature REMOVED — always 0.
  // Never org-wide, never fabricated.
  async mySummary(user, query = {}) {
    const { from, to } = resolveRange(query)
    const records = await Attendance.find({ employee: user.name, date: { $gte: from, $lte: to } }).lean()

    const worked = records.filter((r) => (r.workingHours || 0) > 0)
    const workingDays = worked.length
    const totalWorked = +worked.reduce((s, r) => s + (r.workingHours || 0), 0).toFixed(1)
    const avgHours = workingDays ? +(totalWorked / workingDays).toFixed(1) : 0

    // -----------------------------------------------------------------------
    // Phase 7.2 (TASK 3) — OVERTIME REMOVED.
    //
    // The whole aggregation above (shift-hour map, per-day dayOvertime, the
    // OVERTIME_DAILY_CAP_HOURS ceiling, the auto/excess/approved split and the
    // pending/approved transparency keys) was deleted together with the
    // feature. `overtime` / `overtimeRaw` are still returned as 0 so every
    // pre-existing consumer (Attendance page, reports, salary UI) keeps
    // working and simply sees zero overtime everywhere.

    const countStatus = (s) => records.filter((r) => r.status === s).length
    const presentDays = records.filter((r) => ['Present', 'Late', 'Early Exit'].includes(r.status)).length
    const recordedAbsentDays = countStatus('Absent')
    const leaveDays = countStatus('On Leave')

    // --- Phase 6.12 (TASK 10): real calendar working days -------------------
    //
    // ROOT CAUSE of the incorrect Net Salary. `absentDays` above counts ONLY
    // Attendance documents whose status is literally 'Absent'. In this system
    // an Attendance document is created when an employee CHECKS IN (or when HR
    // explicitly marks a day) - a day on which somebody simply never appears
    // leaves NO document behind at all. Those days were therefore invisible to
    // this summary, so `absentDays` was almost always 0.
    //
    // payrollEngine.computePayroll() derives its loss-of-pay days from exactly
    // this field (`lwpDays = opts.lwpDays ?? attendance.payableAbsentDays ??
    // attendance.absentDays ?? 0`), so lwp_days was 0, lwp_deduction was 0, and
    // Net Salary came out as the full monthly figure regardless of how many
    // days were actually worked. The Net Salary was not "miscalculated" by the
    // engine - the engine was being fed an attendance figure that could not see
    // unrecorded absences, and there was no notion anywhere of how many working
    // days the period even had.
    //
    // PHASE LOP SALARY FIX: `payableAbsentDays` is the exact figure the engine
    // now prices as loss-of-pay (LOP Days × Daily Payable Rate, subtracted
    // from the monthly gross), so this count is the single source of truth for
    // what an unpaid absence is worth.
    //
    // The fix is to give the engine the missing denominator, computed here in
    // the backend from real Attendance + Holiday data. Nothing is hardcoded and
    // no payroll money maths happens in this service - it only counts days.
    const holidayDocs = await Holiday.find({ date: { $gte: from, $lte: to } }).select('date -_id').lean()
    const holidaySet = new Set(holidayDocs.map((h) => toDateKey(h.date)).filter(Boolean))

    // Working days in the whole period, Sundays and Company Holidays excluded,
    // via the shared resolver in utils/leaveDays.js.
    const expectedWorkingDays = countWorkingDays(from, to, holidaySet)

    // A period that has not finished yet (typically the current month, whose
    // range runs to the last calendar day) must only be judged up to TODAY -
    // future working days are not absences and must never be deducted.
    //
    // PHASE SALARY/PROJECT AUDIT: the boundary is taken from the LOCAL calendar
    // (toDateKey) rather than from today(), which is
    // `new Date().toISOString().slice(0,10)` and therefore a UTC date. Every
    // other date in this calculation - resolveRange's month bounds,
    // countWorkingDays' weekday test, the Holiday keys - is resolved in local
    // time, so mixing in a UTC "today" made the elapsed window run one day long
    // (and charge one phantom loss-of-pay day) whenever the server's local date
    // was behind UTC. today() itself is deliberately NOT changed here: it also
    // keys check-in/check-out documents, and re-basing those is a separate,
    // data-affecting decision.
    const todayKey = toDateKey(new Date())
    const elapsedTo = to > todayKey ? todayKey : to
    const elapsedWorkingDays = countWorkingDays(from, elapsedTo, holidaySet)

    // Working days that have already passed but carry no Attendance document of
    // any kind. Approved leave is excluded because an approved leave day is
    // recorded as 'On Leave' and is paid under the existing payroll policy.
    const accountedDays = presentDays + leaveDays + recordedAbsentDays
    const unrecordedDays = Math.max(0, elapsedWorkingDays - accountedDays)

    // --- PHASE SALARY/PROJECT AUDIT (SALARY BUG 5): UNPAID LEAVE ------------
    //
    // ROOT CAUSE: LeaveType carries a `paid` flag and the seeded policy set
    // includes "Unpaid Leave" (code LWP, paid: false). When ANY leave request is
    // approved, leaveService.syncAttendanceForApprovedLeave() stamps its days
    // 'On Leave' in Attendance. This summary then counted every 'On Leave' day
    // in `leaveDays`, folded it into `accountedDays`, and therefore excluded it
    // from `payableAbsentDays`. Attendance status alone cannot distinguish paid
    // from unpaid leave, so approved UNPAID leave was paid in full: lwp_days
    // stayed 0 and Net Salary came out as if the employee had worked.
    //
    // FIX: consult the leave policy (the existing LeaveType.paid flag - no new
    // field, no new collection) for the caller's own approved requests that
    // overlap this period, and count only those days that are ALREADY recorded
    // as 'On Leave' in the attendance documents loaded above. Intersecting with
    // the recorded days is what makes double-counting impossible: an unpaid day
    // is either recorded ('On Leave' -> counted here, never in unrecordedDays)
    // or unrecorded (counted once by unrecordedDays). Half-days need no special
    // case because leaveService.apply() rejects half-day on an unpaid type.
    const onLeaveDateKeys = new Set(
      records.filter((r) => r.status === 'On Leave').map((r) => toDateKey(r.date)).filter(Boolean)
    )
    let unpaidLeaveDays = 0
    if (onLeaveDateKeys.size) {
      const unpaidTypeNames = (await LeaveType.find({ paid: false }).select('name -_id').lean())
        .map((t) => t.name)
        .filter(Boolean)
      if (unpaidTypeNames.length) {
        const unpaidRequests = await LeaveRequest.find({
          employee: user.name,
          status: 'Approved',
          type: { $in: unpaidTypeNames },
          from: { $lte: elapsedTo },
          to: { $gte: from },
        }).select('from to -_id').lean()
        const charged = new Set()
        unpaidRequests.forEach((r) => {
          const a = parseDate(r.from)
          const b = parseDate(r.to)
          if (!a || !b) return
          const cursor = new Date(a)
          cursor.setHours(0, 0, 0, 0)
          b.setHours(0, 0, 0, 0)
          while (cursor <= b) {
            const key = toDateKey(cursor)
            if (key && onLeaveDateKeys.has(key)) charged.add(key)
            cursor.setDate(cursor.getDate() + 1)
          }
        })
        unpaidLeaveDays = charged.size
      }
    }

    // Phase 7.2 (TASK 3): Overtime REMOVED — these keys stay as 0 so existing
    // consumers (Attendance page, reports, salary UI) keep reading them.
    const overtime = 0
    const overtimeRaw = 0

    return {
      from, to,
      totalRecords: records.length,
      workingDays,
      totalWorked,
      avgHours,
      overtime,
      overtimeRaw,
      presentDays,
      lateDays: countStatus('Late'),
      earlyExitDays: countStatus('Early Exit'),
      absentDays: recordedAbsentDays,
      leaveDays,
      // Phase 6.12 (TASK 10) - ADDITIVE fields. Every pre-existing key above is
      // unchanged and keeps its exact prior meaning, so the Attendance page and
      // any other consumer of GET /attendance/me/summary is unaffected.
      expectedWorkingDays,
      elapsedWorkingDays,
      holidayDays: holidaySet.size,
      unrecordedDays,
      // PHASE SALARY/PROJECT AUDIT: approved leave days taken on a leave type
      // whose policy says `paid: false`. Reported separately so the Salary page
      // can explain the deduction and so `leaveDays` keeps its exact prior
      // meaning (ALL approved leave, paid or not) for the Attendance page.
      unpaidLeaveDays,
      paidLeaveDays: Math.max(0, leaveDays - unpaidLeaveDays),
      // The figure payroll should charge as loss of pay: days explicitly marked
      // Absent, PLUS elapsed working days with no record at all, PLUS approved
      // leave on an unpaid leave type. Sundays and Company Holidays are already
      // excluded by countWorkingDays, and approved PAID leave stays excluded.
      payableAbsentDays: recordedAbsentDays + unrecordedDays + unpaidLeaveDays,
    }
  },

  async dayRecords(query) {
    const { search = '', department, status, date = today(), page = 1, limit = 10 } = query
    const filter = { date }
    if (department) filter.department = department
    if (status) filter.status = status
    if (search) filter.$or = [
      { employee: { $regex: search, $options: 'i' } },
      { empCode: { $regex: search, $options: 'i' } },
    ]
    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(100, Number(limit))
    const [data, total] = await Promise.all([
      Attendance.find(filter).sort({ employee: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Attendance.countDocuments(filter),
    ])
    return { data, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
  },

  // Phase 6.9 (TASK 1): the record is returned with an ADDITIVE `breakStartedAt`
  // field holding the start instant of the currently-open break session (null
  // when no break is running). The client derives its live break timer from
  // this absolute timestamp instead of incrementing a local counter, which is
  // what makes the timer survive navigation and stay synchronised with the
  // stored attendance data. `breaks[]` already carried the anchor; exposing it
  // explicitly means callers do not have to re-scan the array, and every
  // pre-existing response key is unchanged (purely additive, so any existing
  // consumer is unaffected).
  async getToday(user) {
    const doc = await Attendance.findOne({ employee: user.name, date: today() }).lean()
    if (!doc) return doc
    return { ...doc, breakStartedAt: openBreakStart(doc) }
  },

  async checkIn(user, { timezone } = {}) {
    assertMarksAttendance(user)
    const date = today()
    // Safe server-side session boundary. If an EARLIER session is still open
    // (checked in on a previous day, never checked out), close it NOW at its
    // own day's boundary (the configured shift end, or the end of its local day
    // when no Shift config can answer — see finalizeSession) through the SAME
    // path a live logout uses. Monday 09:00 -> Tuesday 10:00 therefore NEVER
    // becomes one 25-hour session: Monday is closed at Monday's boundary, and
    // Tuesday's check-in starts an independent Tuesday session.
    const stale = await Attendance.findOne({
      employee: user.name,
      checkIn: { $ne: null },
      checkOut: null,
      date: { $lt: date },
    }).sort({ date: 1 }).limit(1)
    if (stale) await finalizeSession(user, stale, new Date(), { autoClose: true })
    const existing = await Attendance.findOne({ employee: user.name, date })
    if (existing?.checkIn) throw new ApiError(409, 'Already checked in today')
    const checkIn = nowHMS()
    const ts = new Date()
    const doc = existing || new Attendance({ employee: user.name, empCode: user.empCode, department: user.department, date })
    // Read the employee's configured shift from MongoDB and judge the check-in
    // against it (see the block comment above resolveShiftForUser).
    const shift = await resolveShiftForUser(user, doc.shift)
    const late = isLate(checkIn, shift)
    doc.checkIn = checkIn
    doc.checkInAt = ts
    doc.checkInSeconds = nowEpoch()
    doc.timezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    // Stamp the CANONICAL Shift.name onto the record so every downstream figure
    // that looks contracted hours up by shift name (the attendance reports)
    // resolves the employee's real shift instead of the schema default. Left
    // untouched when the Shift collection cannot answer.
    if (shift.name) doc.shift = shift.name
    doc.late = late
    doc.status = late ? 'Late' : 'Present'
    await doc.save()
    return doc
  },

  async checkOut(user) {
    assertMarksAttendance(user)
    const date = today()
    // The OPEN session is the one to close, not necessarily today's record. A
    // forgotten logout is typically completed on the NEXT day, when no record
    // exists for "today" yet; closing the most recent open session (bounded to
    // its own day by finalizeSession) is what lets Monday 09:00 -> Tuesday
    // 10:00 close safely instead of erroring or inflating working hours.
    const doc = await Attendance.findOne({
      employee: user.name,
      checkIn: { $ne: null },
      checkOut: null,
    }).sort({ date: -1 }).limit(1)
    if (!doc) {
      const todayDoc = await Attendance.findOne({ employee: user.name, date })
      if (todayDoc?.checkIn) throw new ApiError(409, 'Already checked out')
      throw new ApiError(400, 'You have not checked in yet')
    }
    // The client body is deliberately NOT read (only the authenticated user):
    // a manipulated payload cannot inject or inflate the worked time.
    return finalizeSession(user, doc, new Date())
  },

  async toggleBreak(user, { onBreak }) {
    assertMarksAttendance(user)
    const doc = await Attendance.findOne({ employee: user.name, date: today() })
    if (!doc) throw new ApiError(400, 'No active attendance record')
    if (!doc.checkIn) throw new ApiError(400, 'You have not checked in yet')
    if (doc.checkOut) throw new ApiError(409, 'Already checked out')
    const now = new Date()
    if (onBreak) {
      // Break start: open a new session (idempotent if already on break).
      if (!doc.onBreak) doc.breaks.push({ start: now })
      doc.onBreak = true
    } else {
      // Break end: close the last open session and accumulate its duration.
      const openBreak = [...(doc.breaks || [])].reverse().find((b) => !b.end)
      if (openBreak) {
        openBreak.end = now
        openBreak.seconds = Math.max(0, Math.floor((now - new Date(openBreak.start)) / 1000))
      }
      doc.onBreak = false
    }
    doc.breakSecs = (doc.breaks || []).reduce((s, b) => s + (b.seconds || 0), 0)
    doc.breakMins = Math.round(doc.breakSecs / 60)
    await doc.save()
    // Phase 6.9 (TASK 1): `breakStartedAt` is additive - it hands the client the
    // authoritative anchor for the break that was just started (null on stop),
    // so the UI clock is derived from a server timestamp rather than guessed.
    return {
      onBreak: doc.onBreak,
      breakMins: doc.breakMins,
      breakSecs: doc.breakSecs,
      breaks: doc.breaks,
      breakStartedAt: openBreakStart(doc),
    }
  },

  // PHASE 6 (TASK 3) - THE ATTENDANCE CALENDAR NOW HONOURS A MONTH.
  //
  // ROOT CAUSE (server half): this read EVERY Attendance document the employee
  // has ever had and returned one flat { 'YYYY-MM-DD': status } map. It took no
  // query at all, so the endpoint had no notion of "which month am I looking
  // at?" - the client could only ever receive the same blob and re-slice it.
  // Combined with a single ['attendance-calendar'] React Query key on the
  // client, changing month could not possibly refetch anything.
  //
  // It now accepts the SAME range vocabulary the rest of this service already
  // speaks, through the EXISTING resolveRange() helper (from/to | year+month |
  // year | current month) - no second date utility is introduced.
  //
  // TIMEZONE: Attendance.date is stored as a plain 'YYYY-MM-DD' STRING (see
  // models/attendanceModels.js), and resolveRange builds plain 'YYYY-MM-DD'
  // strings too, so this is a pure lexicographic string comparison. No Date
  // object is constructed on either side of the boundary, which is exactly why
  // 2026-08-01 cannot drift to 2026-07-31 under a UTC conversion.
  //
  // BACKWARD COMPATIBLE: with no range params the behaviour is unchanged - the
  // whole history is returned, so any existing caller keeps working.
  async calendar(user, query = {}) {
    const filter = { employee: user.name }
    const hasRange = ['from', 'to', 'year', 'month'].some(
      (k) => query[k] != null && query[k] !== ''
    )
    if (hasRange) {
      const { from, to } = resolveRange(query)
      filter.date = { $gte: from, $lte: to }
    }
    const records = await Attendance.find(filter).select('date status -_id').lean()
    return records.reduce((acc, r) => { acc[r.date] = r.status; return acc }, {})
  },

  // Aggregated analytics for a given day (default today).
  async stats(query = {}) {
    const date = query.date || today()
    const records = await Attendance.find({ date }).lean()
    const count = (s) => records.filter((r) => r.status === s).length
    const present = count('Present'), late = count('Late'), earlyExit = count('Early Exit')
    const absent = count('Absent'), onLeave = count('On Leave')
    // Phase 7.2 (TASK 3): Overtime REMOVED — the key stays as 0 so existing
    // consumers (Attendance dashboard, reports) keep reading it.
    const totalOvertime = 0
    const avgHours = +(records.reduce((s, r) => s + (r.workingHours || 0), 0) / (records.length || 1)).toFixed(1)

    const deptMap = {}
    records.forEach((r) => {
      deptMap[r.department] ??= { name: r.department, present: 0, absent: 0, late: 0 }
      if (r.status === 'Present') deptMap[r.department].present++
      else if (r.status === 'Absent' || r.status === 'On Leave') deptMap[r.department].absent++
      else if (r.status === 'Late') deptMap[r.department].late++
    })

    // Phase 5.7 (Task 5): role breakdown (Employee / Manager).
    //
    // An Attendance document has NO role field — it stores employee, empCode
    // and department only. The role lives on the User document, so the split
    // has to be resolved by joining on the employee NAME, which is the only
    // key the two collections share. Names are not guaranteed unique, so this
    // is a best-effort projection; anything that cannot be resolved is grouped
    // under 'Unassigned' rather than being silently dropped or guessed.
    const staff = await User.find({ role: { $in: ['Employee', 'Manager'] } })
      .select('name role -_id').lean()
    const roleByName = new Map(staff.map((u) => [u.name, u.role]))
    const roleMap = {}
    records.forEach((r) => {
      const role = roleByName.get(r.employee) || 'Unassigned'
      roleMap[role] ??= { name: role, total: 0, present: 0, absent: 0, late: 0, onLeave: 0 }
      roleMap[role].total++
      if (r.status === 'Present') roleMap[role].present++
      else if (r.status === 'Late') roleMap[role].late++
      else if (r.status === 'On Leave') roleMap[role].onLeave++
      else if (r.status === 'Absent') roleMap[role].absent++
    })

    // -----------------------------------------------------------------------
    // Phase 5.9 (Task 5) — ADMIN ATTENDANCE ROOT CAUSE
    //
    // TRACE: Attendance.jsx -> CompanyAttendanceDashboard -> attendanceApi.stats
    //        -> GET /attendance/stats -> attendanceController.stats
    //        -> attendanceService.stats() -> Attendance.find({ date })
    //
    // RBAC was NOT the problem: the route is guarded by
    // authorize('Admin','HR','Manager') and Admin passes cleanly. The controller
    // and the Mongo query are both correct too.
    //
    // THE REAL ROOT CAUSE was in this function: organisation headcount was
    // derived from the ATTENDANCE collection — `totalEmployees: records.length`.
    // An Attendance document only comes into existence when somebody checks in.
    // Employees who never check in have no document at all, so they were not
    // merely counted as absent, they did not exist as far as this endpoint was
    // concerned. Consequences the Admin saw on the dashboard:
    //   * "Total Employees" showed the number of people who checked in, not the
    //     headcount — and read 0 before the first check-in of the day.
    //   * "Absent" only ever counted rows explicitly stamped 'Absent'. Nobody
    //     stamps a row for a person who simply never showed up, so Absent read 0.
    //   * attendanceRate divided the present count by the present count, so it
    //     was pinned at ~100% (or 0% on an empty day) and was meaningless.
    // Compounding this, ATTENDANCE_EXEMPT_ROLES = ['Admin'] means Admins never
    // mark attendance, so on a small workspace the collection was frequently
    // empty for the day and every tile rendered zero.
    //
    // FIX: take the headcount from the USER collection (the system of record for
    // who works here) and derive absence from it. Only staff roles are counted,
    // and only Active users — Admin is excluded because it is attendance-exempt,
    // and Clients are not staff, so including either would inflate the
    // denominator. Every pre-existing response key is preserved with the same
    // meaning; the additional keys are purely additive.
    // -----------------------------------------------------------------------
    // PHASE ATTENDANCE STATUS (TASKS 1-3) — SHIFT-AWARE ABSENCE
    //
    // The Phase 5.9 fix above (headcount from the USER collection instead of
    // the Attendance collection) is preserved, but its "absent-by-omission"
    // arithmetic judged every unmarked person absent from MIDNIGHT. A
    // workspace whose shifts start at 09:00 therefore reported everyone absent
    // at 00:01, and the "Absent" tile flipped at a clock time that had nothing
    // to do with anyone's shift.
    //
    // The computation now goes through the ONE shared resolver
    // (utils/attendanceStatus.js) that the Employees page's per-employee
    // Status column uses: a stamped record wins, then approved leave, then the
    // working-day (Sunday/Company Holiday) and shift-window rules. People
    // whose shift has not started yet are 'Not Marked' — genuinely not absent
    // yet — and only become 'Absent' once their shift start passes without a
    // check-in. No Attendance / User / Employee document is written, so the
    // permanent account status is untouched.
    //
    // Every pre-existing response key keeps its meaning:
    //   absent         = the true "absent today" count (was: midnight-based)
    //   absentMarked   = Attendance docs explicitly stamped 'Absent'
    //   absentUnmarked = absent - absentMarked (no record + shift started)
    //   onLeave        = staff on approved leave today (docs + requests)
    //   notMarked      = ADDITIVE: staff whose shift has not started yet, or
    //                    no shift resolution, or a non-working day
    //   attendanceRate = present / expected, where expected excludes people
    //                    legitimately not yet at work (Not Marked + On Leave),
    //                    so the tile no longer reads 0% before the first
    //                    shift of the day starts.
    const staffUsers = await User.find({ role: { $in: ['Employee', 'Manager'] } })
      .select('name shift status -_id').lean()
    const statusMap = await computeTodayStatusMap({
      date, now: new Date(),
      subjects: staffUsers.map((u) => ({
        name: u.name, empCode: '', shift: u.shift, inactive: u.status !== 'Active',
      })),
    })
    const statusOf = (u) => statusMap.byName.get(u.name) || ATT_STATUS_NOT_MARKED
    const countStatus = (s) => staffUsers.filter((u) => statusOf(u) === s).length

    // Only Active users form the headcount (unchanged from Phase 5.9).
    const headcount = staffUsers.filter((u) => u.status === 'Active').length
    const effectiveAbsent = countStatus(ATT_STATUS_ABSENT)
    const effectiveOnLeave = countStatus(ATT_STATUS_ON_LEAVE)
    const notMarked = countStatus(ATT_STATUS_NOT_MARKED)
    const markedPresent = present + late + earlyExit
    const expected = Math.max(0, headcount - effectiveOnLeave - notMarked)
    const unmarkedAbsent = Math.max(0, effectiveAbsent - absent)
    // Fall back to the old behaviour if the User collection cannot answer (e.g.
    // a workspace with no Active staff yet) so the endpoint never divides by a
    // bogus zero and never regresses for existing consumers.
    const totalEmployees = headcount || records.length

    return {
      date,
      totalEmployees,
      present, late, earlyExit, onLeave: effectiveOnLeave,
      absent: effectiveAbsent,
      // Additive detail keys — existing consumers that never read them are
      // unaffected, but they let the UI explain where "Absent" came from.
      absentMarked: absent,
      absentUnmarked: unmarkedAbsent,
      // ADDITIVE (PHASE ATTENDANCE STATUS): staff not yet counted as absent —
      // shift not started, non-working day, or unresolvable shift.
      notMarked,
      totalRecords: records.length,
      totalOvertime, avgHours,
      attendanceRate: Math.round(markedPresent / (expected || 1) * 100),
      byDepartment: Object.values(deptMap),
      // Additive key — existing consumers that never read it are unaffected.
      byRole: Object.values(roleMap),
      statusSplit: [
        { name: 'Present', value: present }, { name: 'Late', value: late },
        { name: 'Early Exit', value: earlyExit }, { name: 'Absent', value: effectiveAbsent }, { name: 'On Leave', value: effectiveOnLeave },
        { name: 'Not Marked', value: notMarked },
      ].filter((s) => s.value > 0),
    }
  },
}
