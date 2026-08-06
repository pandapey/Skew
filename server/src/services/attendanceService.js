import { Attendance, Shift, Holiday } from '../models/attendanceModels.js'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { ApiError } from '../utils/asyncHandler.js'
// PHASE ADMIN ATTENDANCE (TASK 1): the EXISTING shift resolver (already the
// single source of truth for leave expiry + HR reminders) is imported, not
// re-implemented, so "which shift is this employee on and when does it start?"
// has exactly one answer across the whole system.
import { loadShiftContext, resolveShiftConfig, DEFAULT_SHIFT_HOURS } from '../utils/leaveExpiry.js'
// Phase 6.12 (TASK 10): the EXISTING single source of truth for working-day
// arithmetic (Sundays + Company Holidays excluded). It is imported, not
// re-implemented, so payroll counts a working day exactly the way leave apply,
// leave approve, balances and the leave reports already count one.
import { countWorkingDays, toDateKey } from '../utils/leaveDays.js'
import { DEFAULT_TIMEZONE, getTimezone, getLocalDate, getLocalTime } from '../utils/timezone.js'

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

const nowEpoch = () => Math.floor(Date.now() / 1000)

function resolveAttendanceTimezone(explicitTimezone, userTimezone) {
  return getTimezone(explicitTimezone || userTimezone || DEFAULT_TIMEZONE)
}

function attendanceToday(timezone) {
  return getLocalDate(new Date(), timezone)
}

function attendanceNow(timezone) {
  return getLocalTime(new Date(), timezone)
}

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

// Resolve the calendar range [from,to] (YYYY-MM-DD) for a personal-summary
// query. Supports an explicit custom range (from/to), a specific month
// (year + 0-based month), a whole year (year only), or defaults to the
// current calendar month. Pure date math — no data access.
function resolveRange(query = {}, timezone = DEFAULT_TIMEZONE) {
  const safeTimezone = getTimezone(timezone)
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')

  if (query.from && query.to) {
    return { from: String(query.from), to: String(query.to) }
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )

  const currentYear = Number(values.year)
  const currentMonth = Number(values.month) - 1
  const year = Number(query.year) || currentYear

  if (query.month != null && query.month !== '') {
    const m = Number(query.month)
    const last = new Date(Date.UTC(year, m + 1, 0)).getUTCDate()
    return {
      from: `${year}-${pad(m + 1)}-01`,
      to: `${year}-${pad(m + 1)}-${pad(last)}`,
    }
  }

  if (query.year && query.month == null) {
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }

  const last = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate()
  return {
    from: `${currentYear}-${pad(currentMonth + 1)}-01`,
    to: `${currentYear}-${pad(currentMonth + 1)}-${pad(last)}`,
  }
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
  //   Overtime      = sum of max(0, workedHours - shiftHours) across worked days
  // Shift hours come from the Shift collection (matched by the record's shift
  // name), defaulting to 9h when a shift is unknown. Never org-wide, never
  // fabricated.
  async mySummary(user, query = {}) {
    const timezone = resolveAttendanceTimezone(query.timezone, user?.timezone)
    const { from, to } = resolveRange(query, timezone)
    const records = await Attendance.find({ employee: user.name, date: { $gte: from, $lte: to } }).lean()

    // Build a shift-name -> contracted hours map from the Shift collection.
    const shiftDocs = await Shift.find().select('name hours -_id').lean()
    const shiftHours = {}
    shiftDocs.forEach((s) => { shiftHours[s.name] = typeof s.hours === 'number' ? s.hours : DEFAULT_SHIFT_HOURS })
    // PHASE ADMIN ATTENDANCE (TASK 1): the fallback is now the shared schema
    // default constant rather than a bare literal. It is only reached when the
    // record's shift name has no matching Shift document — and check-in now
    // stamps the canonical Shift.name, so that path is the legacy-record case.
    const hoursForShift = (name) => (name != null && shiftHours[name] != null ? shiftHours[name] : DEFAULT_SHIFT_HOURS)

    const worked = records.filter((r) => (r.workingHours || 0) > 0)
    const workingDays = worked.length
    const totalWorked = +worked.reduce((s, r) => s + (r.workingHours || 0), 0).toFixed(1)
    const avgHours = workingDays ? +(totalWorked / workingDays).toFixed(1) : 0
    const overtime = +worked.reduce((s, r) => s + Math.max(0, (r.workingHours || 0) - hoursForShift(r.shift)), 0).toFixed(1)

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
    // this field (`lwpDays = opts.lwpDays ?? attendance.absentDays ?? 0`), so
    // lwp_days was 0, lwp_deduction was 0, and Net Salary came out as the full
    // monthly figure regardless of how many days were actually worked. The Net
    // Salary was not "miscalculated" by the engine - the engine was being fed
    // an attendance figure that could not see unrecorded absences, and there
    // was no notion anywhere of how many working days the period even had.
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
    const todayKey = attendanceToday(timezone)
    const elapsedTo = to > todayKey ? todayKey : to
    const elapsedWorkingDays = countWorkingDays(from, elapsedTo, holidaySet)

    // Working days that have already passed but carry no Attendance document of
    // any kind. Approved leave is excluded because an approved leave day is
    // recorded as 'On Leave' and is paid under the existing payroll policy.
    const accountedDays = presentDays + leaveDays + recordedAbsentDays
    const unrecordedDays = Math.max(0, elapsedWorkingDays - accountedDays)

    return {
      from, to,
      totalRecords: records.length,
      workingDays,
      totalWorked,
      avgHours,
      overtime,
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
      // The figure payroll should charge as loss of pay: days explicitly marked
      // Absent PLUS elapsed working days with no record at all. Sundays and
      // Company Holidays are already excluded by countWorkingDays, and approved
      // leave is already excluded via `accountedDays`.
      payableAbsentDays: recordedAbsentDays + unrecordedDays,
    }
  },

  async dayRecords(query) {
    const { search = '', department, status, page = 1, limit = 10 } = query
    const timezone = resolveAttendanceTimezone(query.timezone)
    const date = query.date || attendanceToday(timezone)
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
    const timezone = resolveAttendanceTimezone(user?.timezone)
    const date = attendanceToday(timezone)
    const doc = await Attendance.findOne({ employee: user.name, date }).lean()

    if (!doc) return doc
    return { ...doc, breakStartedAt: openBreakStart(doc) }
  },

  async checkIn(user, { timezone: timezoneInput } = {}) {
    assertMarksAttendance(user)

    const timezone = resolveAttendanceTimezone(timezoneInput, user?.timezone)
    const ts = new Date()
    const date = getLocalDate(ts, timezone)

    const existing = await Attendance.findOne({ employee: user.name, date })
    if (existing?.checkIn) throw new ApiError(409, 'Already checked in today')

    const checkIn = getLocalTime(ts, timezone)
    const doc = existing || new Attendance({ employee: user.name, empCode: user.empCode, department: user.department, date })
    // Read the employee's configured shift from MongoDB and judge the check-in
    // against it (see the block comment above resolveShiftForUser).
    const shift = await resolveShiftForUser(user, doc.shift)
    const late = isLate(checkIn, shift)
    doc.checkIn = checkIn
    doc.checkInAt = ts
    doc.checkInSeconds = nowEpoch()
    doc.timezone = timezone
    // Stamp the CANONICAL Shift.name onto the record so every downstream figure
    // that looks contracted hours up by shift name (mySummary's overtime, the
    // attendance reports) resolves the employee's real shift instead of the
    // schema default. Left untouched when the Shift collection cannot answer.
    if (shift.name) doc.shift = shift.name
    doc.late = late
    doc.status = late ? 'Late' : 'Present'
    await doc.save()
    return doc
  },

  async checkOut(user, { timezone: timezoneInput } = {}) {
    assertMarksAttendance(user)

    const fallbackTimezone = resolveAttendanceTimezone(timezoneInput, user?.timezone)
    const fallbackDate = attendanceToday(fallbackTimezone)

    let doc = await Attendance.findOne({ employee: user.name, date: fallbackDate })

    // If the user's timezone changed after check-in, find the latest open record.
    if (!doc) {
      doc = await Attendance.findOne({
        employee: user.name,
        checkIn: { $exists: true, $ne: null },
        checkOut: { $exists: false },
      }).sort({ checkInAt: -1 })
    }

    if (!doc?.checkIn) throw new ApiError(400, 'You have not checked in yet')
    if (doc.checkOut) throw new ApiError(409, 'Already checked out')

    const timezone = resolveAttendanceTimezone(doc.timezone, fallbackTimezone)
    const ts = new Date()

    doc.checkOut = getLocalTime(ts, timezone)
    doc.checkOutAt = ts
    doc.checkOutSeconds = nowEpoch()

    const openBreak = [...(doc.breaks || [])].reverse().find((b) => !b.end)
    if (openBreak) {
      openBreak.end = ts
      openBreak.seconds = Math.max(0, Math.floor((ts - new Date(openBreak.start)) / 1000))
    }

    doc.breakSecs = (doc.breaks || []).reduce((s, b) => s + (b.seconds || 0), 0)
    doc.breakMins = Math.round(doc.breakSecs / 60)
    doc.onBreak = false

    const breakSecs = doc.breakSecs
    doc.durationSecs = Math.max(0, (doc.checkOutSeconds || 0) - (doc.checkInSeconds || 0) - breakSecs)
    doc.workingHours = Math.max(0, +(doc.durationSecs / 3600).toFixed(1))

    const shift = await resolveShiftForUser(user, doc.shift)
    if (shift.name) doc.shift = shift.name

    doc.earlyExit = shift.endMins != null && toMins(doc.checkOut) < shift.endMins
    doc.overtimeHours = doc.workingHours > shift.hours
      ? +(doc.workingHours - shift.hours).toFixed(1)
      : 0

    if (doc.earlyExit && !doc.late) doc.status = 'Early Exit'

    await doc.save()
    return doc
  },

  async toggleBreak(user, { onBreak, timezone: timezoneInput } = {}) {
    assertMarksAttendance(user)

    const fallbackTimezone = resolveAttendanceTimezone(timezoneInput, user?.timezone)
    const date = attendanceToday(fallbackTimezone)

    let doc = await Attendance.findOne({ employee: user.name, date })

    if (!doc) {
      doc = await Attendance.findOne({
        employee: user.name,
        checkIn: { $exists: true, $ne: null },
        checkOut: { $exists: false },
      }).sort({ checkInAt: -1 })
    }

    if (!doc) throw new ApiError(400, 'No active attendance record')
    if (!doc.checkIn) throw new ApiError(400, 'You have not checked in yet')
    if (doc.checkOut) throw new ApiError(409, 'Already checked out')

    const now = new Date()

    if (onBreak) {
      const alreadyOpen = (doc.breaks || []).some((b) => b && !b.end)
      if (!alreadyOpen) doc.breaks.push({ start: now })
      doc.onBreak = true
    } else {
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

    return {
      onBreak: doc.onBreak,
      breakMins: doc.breakMins,
      breakSecs: doc.breakSecs,
      breaks: doc.breaks,
      breakStartedAt: openBreakStart(doc),
      timezone: doc.timezone || fallbackTimezone,
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
      const timezone = resolveAttendanceTimezone(query.timezone, user?.timezone)
      const { from, to } = resolveRange(query, timezone)
      filter.date = { $gte: from, $lte: to }
    }
    const records = await Attendance.find(filter).select('date status -_id').lean()
    return records.reduce((acc, r) => { acc[r.date] = r.status; return acc }, {})
  },

  // Aggregated analytics for a given day (default today).
  async stats(query = {}) {
    const timezone = resolveAttendanceTimezone(query.timezone)
    const date = query.date || attendanceToday(timezone)
    const records = await Attendance.find({ date }).lean()
    const count = (s) => records.filter((r) => r.status === s).length
    const present = count('Present'), late = count('Late'), earlyExit = count('Early Exit')
    const absent = count('Absent'), onLeave = count('On Leave')
    const totalOvertime = +records.reduce((s, r) => s + (r.overtimeHours || 0), 0).toFixed(1)
    const avgHours = +(records.reduce((s, r) => s + (r.workingHours || 0), 0) / (records.length || 1)).toFixed(1)

    const deptMap = {}
    records.forEach((r) => {
      deptMap[r.department] ??= { name: r.department, present: 0, absent: 0, late: 0 }
      if (r.status === 'Present') deptMap[r.department].present++
      else if (r.status === 'Absent' || r.status === 'On Leave') deptMap[r.department].absent++
      else if (r.status === 'Late') deptMap[r.department].late++
    })

    // Phase 5.7 (Task 5): role breakdown (Employee / HR / Manager).
    //
    // An Attendance document has NO role field — it stores employee, empCode
    // and department only. The role lives on the User document, so the split
    // has to be resolved by joining on the employee NAME, which is the only
    // key the two collections share. Names are not guaranteed unique, so this
    // is a best-effort projection; anything that cannot be resolved is grouped
    // under 'Unassigned' rather than being silently dropped or guessed.
    const staff = await User.find({ role: { $in: ['Employee', 'HR', 'Manager'] } })
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
    const headcount = await User.countDocuments({
      role: { $in: ['Employee', 'HR', 'Manager'] },
      status: 'Active',
    })
    const markedPresent = present + late + earlyExit
    // People with no Attendance document for this date are absent-by-omission.
    const unmarkedAbsent = Math.max(0, headcount - (markedPresent + onLeave + absent))
    const effectiveAbsent = absent + unmarkedAbsent
    // Fall back to the old behaviour if the User collection cannot answer (e.g.
    // a workspace with no Active staff yet) so the endpoint never divides by a
    // bogus zero and never regresses for existing consumers.
    const totalEmployees = headcount || records.length

    return {
      date,
      totalEmployees,
      present, late, earlyExit, onLeave,
      absent: effectiveAbsent,
      // Additive detail keys — existing consumers that never read them are
      // unaffected, but they let the UI explain where "Absent" came from.
      absentMarked: absent,
      absentUnmarked: unmarkedAbsent,
      totalRecords: records.length,
      totalOvertime, avgHours,
      attendanceRate: Math.round(markedPresent / (totalEmployees || 1) * 100),
      byDepartment: Object.values(deptMap),
      // Additive key — existing consumers that never read it are unaffected.
      byRole: Object.values(roleMap),
      statusSplit: [
        { name: 'Present', value: present }, { name: 'Late', value: late },
        { name: 'Early Exit', value: earlyExit }, { name: 'Absent', value: effectiveAbsent }, { name: 'On Leave', value: onLeave },
      ].filter((s) => s.value > 0),
    }
  },
}
