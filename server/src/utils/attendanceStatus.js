import { Attendance, Holiday } from '../models/attendanceModels.js'
import { LeaveRequest } from '../models/leaveModels.js'
import { loadShiftContext, resolveShiftConfig } from './leaveExpiry.js'
import { isSunday, parseDate, toDateKey } from './leaveDays.js'
import { todayIST, nowMinsIST } from './ist.js'

export const ATT_STATUS_PRESENT = 'Present'
export const ATT_STATUS_LATE = 'Late'
export const ATT_STATUS_EARLY_EXIT = 'Early Exit'
export const ATT_STATUS_ABSENT = 'Absent'
export const ATT_STATUS_ON_LEAVE = 'On Leave'
export const ATT_STATUS_NOT_MARKED = 'Not Marked'
export const ATT_STATUS_INACTIVE = 'Inactive'

const hasOpinion = (status) =>
  status && status !== ATT_STATUS_NOT_MARKED
const resolveStatus = (subject, ctx) => {
  const rec = (subject.empCode && ctx.recordsByEmpCode.get(subject.empCode)) ||
    (subject.name && ctx.recordsByName.get(subject.name))
  if (rec && hasOpinion(rec.status)) return rec.status

  if (subject.inactive) return ATT_STATUS_INACTIVE

  if (subject.name && ctx.onLeaveNames.has(subject.name)) return ATT_STATUS_ON_LEAVE

  if (!ctx.isWorkingDay) return ATT_STATUS_NOT_MARKED

  const cfg = resolveShiftConfig([subject.shift || '', 'General'], ctx.shiftCtx)
  if (cfg.startMins == null) return ATT_STATUS_NOT_MARKED
  return ctx.nowMins >= cfg.startMins ? ATT_STATUS_ABSENT : ATT_STATUS_NOT_MARKED
}

// Pure helper behind the attendance mini-calendar: absent days never create
// records, so fill unrecorded elapsed working days with 'Absent'.
// Sundays/holidays are intentionally left out — the client paints those
// itself (Weekend/Holiday). Never mutates the input map.
export function backfillAbsentDays(map = {}, from, to, holidays = new Set(), todayKey = toDateKey(new Date())) {
  const out = { ...(map || {}) }
  const lastKey = to < todayKey ? to : todayKey
  if (!from || !lastKey || lastKey < from) return out
  const cursor = parseDate(from)
  const end = parseDate(lastKey)
  if (!cursor || !end) return out
  cursor.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  while (cursor <= end) {
    const key = toDateKey(cursor)
    if (key && !out[key] && cursor.getDay() !== 0 && !(holidays instanceof Set && holidays.has(key))) {
      out[key] = ATT_STATUS_ABSENT
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export async function computeTodayStatusMap({ date, now = new Date(), subjects = [] } = {}) {
  const dateKey = date || todayIST()

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
    nowMins: nowMinsIST(),
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
