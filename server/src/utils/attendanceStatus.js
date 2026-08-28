// PHASE ATTENDANCE STATUS (TASKS 1-3) — single source of truth for "what is this
// person's attendance status for a given day?".
//
// Three surfaces must agree on this answer:
//   1. GET /attendance/stats   -> the org-wide "Absent" count (Attendance page)
//   2. GET /employees          -> the per-employee "Status" column (Employees
//      page and Employee Details), which must AUTO-UPDATE from attendance
//      instead of showing the static stored status.
//   3. Any future widget that asks "who is absent today?" (Task 1).
//
// Previously each of these had its own idea of absence:
//   * attendanceService.stats() counted "unmarked = headcount minus marked",
//     from MIDNIGHT — so at 00:01 every employee whose shift had not started
//     was already "Absent", and the count flipped over at a time that has
//     nothing to do with anyone's shift.
//   * The Employees page showed Employee.status, a STORED value that is the
//     account state (set once at creation, synced from User.status by
//     identityLink.js) — it never changes with attendance.
//
// The rule encoded here, in priority order, for each person:
//   1. A stamped Attendance record for the day wins (Present / Late / Early
//      Exit / Absent / On Leave). A record still at the schema default
//      'Not Marked' is treated as NO record — the day was opened but nothing
//      was marked, so the shift window below decides.
//   2. An approved LeaveRequest covering the day  -> 'On Leave'.
//   3. A Sunday or Company Holiday               -> 'Not Marked' (nobody is
//      expected to work, so nobody can be absent).
//   4. No record and a WORKING day:
//        - the person's shift has STARTED (now >= shift start) -> 'Absent'
//        - the shift has NOT started yet, or the database cannot resolve a
//          shift start at all -> 'Not Marked' (not absent — their day has
//          simply not begun; this is the fix for "absent at midnight").
//
// The shift resolution is imported from utils/leaveExpiry.js (resolveShiftConfig
// + loadShiftContext), the SAME authority leave expiry and late marking use, so
// "when does this employee's shift start?" has exactly one answer everywhere.
// The working-day rule reuses utils/leaveDays.js (isSunday / toDateKey), the
// same Sunday+Company-Holiday logic payroll and leave duration use.
//
// Deliberately NOT written here: grace minutes. `graceMins` is a lateness
// allowance for people who DO check in; an employee who never checks in at all
// is absent once their shift starts. Adding grace would silently tolerate
// unmarked shifts past their start.
//
// This module is a pure READ projection: it never writes Attendance, Employee
// or User documents, so the permanent account status (User.status /
// Employee.status) is untouched — the computed value is additive and displayed,
// not persisted.

import { Attendance, Holiday } from '../models/attendanceModels.js'
import { LeaveRequest } from '../models/leaveModels.js'
import { loadShiftContext, resolveShiftConfig } from './leaveExpiry.js'
import { isSunday, toDateKey } from './leaveDays.js'
import { todayIST, nowMinsIST } from './ist.js' 
export const ATT_STATUS_PRESENT = 'Present'
export const ATT_STATUS_LATE = 'Late'
export const ATT_STATUS_EARLY_EXIT = 'Early Exit'
export const ATT_STATUS_ABSENT = 'Absent'
export const ATT_STATUS_ON_LEAVE = 'On Leave'
export const ATT_STATUS_NOT_MARKED = 'Not Marked'
export const ATT_STATUS_INACTIVE = 'Inactive'

// The schema default (models/attendanceModels.js) means "no opinion yet". A
// record in this state must not shadow the shift-window rule.
const hasOpinion = (status) =>
  status && status !== ATT_STATUS_NOT_MARKED

// Resolve one subject against the already-loaded context. `subjects` may be
// staff users (from the User collection, by NAME only — the User document
// carries no empCode) or Employee documents (name + empCode + shift).
const resolveStatus = (subject, ctx) => {
  const rec = (subject.empCode && ctx.recordsByEmpCode.get(subject.empCode)) ||
    (subject.name && ctx.recordsByName.get(subject.name))
  if (rec && hasOpinion(rec.status)) return rec.status

  // Not on the books as active: an Inactive account is not expected to work,
  // so it is never "absent". The account state wins here precisely so the
  // per-employee Status column does not call a suspended person Absent.
  if (subject.inactive) return ATT_STATUS_INACTIVE

  // An approved leave covering the day is a legitimate, planned absence.
  if (subject.name && ctx.onLeaveNames.has(subject.name)) return ATT_STATUS_ON_LEAVE

  // Sundays and Company Holidays are days nobody works.
  if (!ctx.isWorkingDay) return ATT_STATUS_NOT_MARKED

  // The person's own shift (then the Attendance schema default 'General'),
  // resolved by the SAME rule leave expiry and late marking use. When the
  // database cannot tell us the start time, we must NOT judge (see
  // resolveShiftConfig: "the caller must NOT judge").
  const cfg = resolveShiftConfig([subject.shift || '', 'General'], ctx.shiftCtx)
  if (cfg.startMins == null) return ATT_STATUS_NOT_MARKED
  return ctx.nowMins >= cfg.startMins ? ATT_STATUS_ABSENT : ATT_STATUS_NOT_MARKED
}

// Compute today's (or any date's) attendance status for every subject in one
// pass: one Attendance query, one LeaveRequest query, one Holiday query, one
// shift-context load. Returns:
//   byName     Map(name -> status)      — join key for User-derived subjects
//   byEmpCode  Map(empCode -> status)   — join key for Employee-derived subjects
//   counts     { status: n }
//
// `subjects`: [{ name, empCode, shift, inactive }]. `name` may be empty for
// empCode-only subjects; `empCode` may be empty for User-derived subjects.
export async function computeTodayStatusMap({ date, now = new Date(), subjects = [] } = {}) {
  const dateKey = date || todayIST() // was new Date().toISOString().slice(0,10)

  const [records, leaves, holidays, shiftCtx] = await Promise.all([
    Attendance.find({ date: dateKey }).select('employee empCode status -_id').lean(),
    LeaveRequest.find({ status: 'Approved', from: { $lte: dateKey }, to: { $gte: dateKey } })
      .select('employee -_id').lean(),
    Holiday.find({}).select('date -_id').lean(),
    loadShiftContext(),
  ])

  const recordsByName = new Map()
  const recordsByEmpCode = new Map()
  for (const r of records) {
    if (r.employee) recordsByName.set(r.employee, r)
    if (r.empCode) recordsByEmpCode.set(r.empCode, r)
  }

  const ctx = {
    recordsByName,
    recordsByEmpCode,
    onLeaveNames: new Set(leaves.map((l) => l.employee).filter(Boolean)),
    isWorkingDay: !isSunday(dateKey) &&
      !new Set(holidays.map((h) => toDateKey(h.date)).filter(Boolean)).has(dateKey),
    shiftCtx,
    nowMins: nowMinsIST(), // was now.getHours()*60+now.getMinutes()
  }

  const byName = new Map()
  const byEmpCode = new Map()
  const counts = {}
  for (const subject of subjects) {
    const status = resolveStatus(subject, ctx)
    if (subject.name) byName.set(subject.name, status)
    if (subject.empCode) byEmpCode.set(subject.empCode, status)
    counts[status] = (counts[status] || 0) + 1
  }

  return { byName, byEmpCode, counts }
}
