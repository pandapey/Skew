import { Attendance, Holiday } from '../models/attendanceModels.js'
import { LeaveType, LeaveRequest } from '../models/leaveModels.js'
import { User } from '../models/User.js'
import { Employee } from '../models/Employee.js'
import { ApiError } from '../utils/asyncHandler.js'
import { loadShiftContext, resolveShiftConfig } from '../utils/leaveExpiry.js'
import { computeTodayStatusMap, ATT_STATUS_ABSENT, ATT_STATUS_ON_LEAVE, ATT_STATUS_NOT_MARKED } from '../utils/attendanceStatus.js'
import { countWorkingDays, toDateKey, parseDate } from '../utils/leaveDays.js'
import { notifyUsersByName } from './notificationService.js'
import { emitResource } from '../realtime/index.js'
import { todayIST, nowHMSIST } from '../utils/ist.js'

const ATTENDANCE_EXEMPT_ROLES = ['Admin']
function assertMarksAttendance(user) {
  if (ATTENDANCE_EXEMPT_ROLES.includes(user?.role)) {
    throw new ApiError(403, 'Admin accounts are not required to mark attendance.')
  }
}

function openBreakStart(doc) {
  if (!doc || doc.checkOut) return null
  const open = [...(doc.breaks || [])].reverse().find((b) => b && b.start && !b.end)
  return open ? open.start : null
}

const today = todayIST
const nowHMS = nowHMSIST
const nowEpoch = () => Math.floor(Date.now() / 1000)

const toMins = (hm) => {
  if (!hm) return 0
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

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

const isLate = (checkInHMS, shift) => {
  if (!shift || shift.startMins == null) return false
  return toMins(checkInHMS) > shift.startMins + shift.graceMins
}

function shiftEndInstant(inTime, shift) {
  if (!inTime || shift?.endMins == null) return null
  const d = new Date(inTime)
  d.setHours(Math.floor(shift.endMins / 60), shift.endMins % 60, 0, 0)
  if (shift.startMins != null && shift.endMins <= shift.startMins) {
    d.setDate(d.getDate() + 1)
  }
  return d
}

async function finalizeSession(user, doc, checkOutAt, { autoClose = false } = {}) {
  const ts = new Date(checkOutAt)
  if (Number.isNaN(ts.getTime())) throw new ApiError(400, 'Invalid check-out time')
  doc.checkOut = ts.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })
  doc.checkOutAt = ts
  doc.checkOutSeconds = Math.floor(ts.getTime() / 1000)

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

function resolveRange(query = {}) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  if (query.from && query.to) return { from: String(query.from), to: String(query.to) }
  const year = Number(query.year) || now.getFullYear()
  if (query.month != null && query.month !== '') {
    const m = Number(query.month)
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

  async mySummary(user, query = {}) {
    const { from, to } = resolveRange(query)
    const records = await Attendance.find({ employee: user.name, date: { $gte: from, $lte: to } }).lean()
    const worked = records.filter((r) => (r.workingHours || 0) > 0)
    const workingDays = worked.length
    const totalWorked = +worked.reduce((s, r) => s + (r.workingHours || 0), 0).toFixed(1)
    const avgHours = workingDays ? +(totalWorked / workingDays).toFixed(1) : 0
    const countStatus = (s) => records.filter((r) => r.status === s).length
    const presentDays = records.filter((r) => ['Present', 'Late', 'Early Exit'].includes(r.status)).length
    const recordedAbsentDays = countStatus('Absent')
    const leaveDays = countStatus('On Leave')
    const holidayDocs = await Holiday.find({ date: { $gte: from, $lte: to } }).select('date -_id').lean()
    const holidaySet = new Set(holidayDocs.map((h) => toDateKey(h.date)).filter(Boolean))
    const expectedWorkingDays = countWorkingDays(from, to, holidaySet)
    const todayKey = toDateKey(new Date())
    const elapsedTo = to > todayKey ? todayKey : to
    const elapsedWorkingDays = countWorkingDays(from, elapsedTo, holidaySet)
    const accountedDays = presentDays + leaveDays + recordedAbsentDays
    const unrecordedDays = Math.max(0, elapsedWorkingDays - accountedDays)

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
      expectedWorkingDays,
      elapsedWorkingDays,
      holidayDays: holidaySet.size,
      unrecordedDays,
      unpaidLeaveDays,
      paidLeaveDays: Math.max(0, leaveDays - unpaidLeaveDays),
      payableAbsentDays: recordedAbsentDays + unrecordedDays + unpaidLeaveDays,
    }
  },

  async dayRecords(query) {
    const { search = '', department, status, date = today(), page = 1, limit = 10 } = query
    const pageNum = Math.max(1, Number(page))
    const limitNum = Math.min(100, Number(limit))

    const [records, staffUsers] = await Promise.all([
      Attendance.find({ date }).lean(),
      User.find({ role: { $in: ['Employee', 'Manager'] } })
        .select('name empCode department shift status -_id').lean(),
    ])
    const byName = new Map(records.map((r) => [r.employee, r]))
    const statusMap = await computeTodayStatusMap({
      date, now: new Date(),
      subjects: staffUsers.map((u) => ({
        name: u.name, empCode: u.empCode || '', shift: u.shift || '', inactive: u.status !== 'Active',
      })),
    })
    const merged = staffUsers
      .map((u) => {
        const rec = byName.get(u.name)
        const effective = statusMap.byName.get(u.name) || rec?.status || ATT_STATUS_NOT_MARKED
        if (effective === 'Inactive') return null
        return {
          ...(rec || {}),
          employee: u.name,
          empCode: rec?.empCode || u.empCode || '',
          department: rec?.department || u.department || '',
          date,
          shift: rec?.shift || u.shift || 'General',
          checkIn: rec?.checkIn || null,
          checkOut: rec?.checkOut || null,
          workingHours: rec?.workingHours ?? 0,
          status: effective,
        }
      })
      .filter(Boolean)
    const seen = new Set(staffUsers.map((u) => u.name))
    records.forEach((r) => {
      if (!seen.has(r.employee)) merged.push(r)
    })

    const term = String(search || '').trim().toLowerCase()
    let rows = merged
    if (department) rows = rows.filter((r) => r.department === department)
    if (status) rows = rows.filter((r) => r.status === status)
    if (term) {
      rows = rows.filter((r) =>
        String(r.employee || '').toLowerCase().includes(term)
        || String(r.empCode || '').toLowerCase().includes(term)
      )
    }
    rows.sort((a, b) => String(a.employee).localeCompare(String(b.employee)))
    const total = rows.length
    const data = rows.slice((pageNum - 1) * limitNum, pageNum * limitNum)
    return { data, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
  },

  async getToday(user) {
    const doc = await Attendance.findOne({ employee: user.name, date: today() }).lean()
    if (!doc) return doc
    return { ...doc, breakStartedAt: openBreakStart(doc) }
  },

  async checkIn(user, { timezone } = {}) {
    assertMarksAttendance(user)
    const date = today()

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
    const shift = await resolveShiftForUser(user, doc.shift)
    const late = isLate(checkIn, shift)
    doc.checkIn = checkIn
    doc.checkInAt = ts
    doc.checkInSeconds = nowEpoch()
    doc.timezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone

    if (shift.name) doc.shift = shift.name
    doc.late = late
    doc.status = late ? 'Late' : 'Present'
    await doc.save()
    return doc
  },

  async checkOut(user) {
    assertMarksAttendance(user)
    const date = today()

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

      if (!doc.onBreak) doc.breaks.push({ start: now })
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
    }
  },

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

  async stats(query = {}) {
    const date = query.date || today()
    const records = await Attendance.find({ date }).lean()
    const count = (s) => records.filter((r) => r.status === s).length
    const present = count('Present'), late = count('Late'), earlyExit = count('Early Exit')
    const absent = count('Absent'), onLeave = count('On Leave')
    const totalOvertime = 0
    const avgHours = +(records.reduce((s, r) => s + (r.workingHours || 0), 0) / (records.length || 1)).toFixed(1)

    const deptMap = {}
    records.forEach((r) => {
      deptMap[r.department] ??= { name: r.department, present: 0, absent: 0, late: 0 }
      if (r.status === 'Present') deptMap[r.department].present++
      else if (r.status === 'Absent' || r.status === 'On Leave') deptMap[r.department].absent++
      else if (r.status === 'Late') deptMap[r.department].late++
    })

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

    const headcount = staffUsers.filter((u) => u.status === 'Active').length
    const effectiveAbsent = countStatus(ATT_STATUS_ABSENT)
    const effectiveOnLeave = countStatus(ATT_STATUS_ON_LEAVE)
    const notMarked = countStatus(ATT_STATUS_NOT_MARKED)
    const markedPresent = present + late + earlyExit
    const expected = Math.max(0, headcount - effectiveOnLeave - notMarked)
    const unmarkedAbsent = Math.max(0, effectiveAbsent - absent)
    const totalEmployees = headcount || records.length

    const monthPrefix = String(date).slice(0, 7)
    const [mYear, mMonth] = monthPrefix.split('-').map(Number)
    const lastDay = new Date(mYear, mMonth, 0).getDate()
    const pad = (n) => String(n).padStart(2, '0')
    const monthFrom = `${monthPrefix}-01`
    const monthTo = `${monthPrefix}-${pad(lastDay)}`
    const monthRecords = await Attendance.find({ date: { $gte: monthFrom, $lte: monthTo } })
      .select('date status workingHours -_id').lean()
    const bucketOf = (day) => (day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3)
    const monthlyTrend = ['Week 1', 'Week 2', 'Week 3', 'Week 4'].map((week) => ({ week, present: 0, absent: 0, late: 0 }))
    monthRecords.forEach((r) => {
      const day = Number(String(r.date).slice(8, 10))
      if (!Number.isFinite(day)) return
      const b = monthlyTrend[bucketOf(day)]
      if (!b) return
      if (r.status === 'Present' || r.status === 'Early Exit') b.present += 1
      else if (r.status === 'Late') b.late += 1
      else if (r.status === 'Absent' || r.status === 'On Leave') b.absent += 1
    })

    const endD = new Date(`${date}T00:00:00`)
    const hoursTrend = []
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(endD)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      hoursTrend.push({ day: key.slice(5), date: key, hours: 0 })
    }
    const weekFrom = hoursTrend[0].date
    const weekRecords = await Attendance.find({ date: { $gte: weekFrom, $lte: date } })
      .select('date workingHours -_id').lean()
    const sumByDate = new Map()
    const nByDate = new Map()
    weekRecords.forEach((r) => {
      if (r.workingHours == null) return
      sumByDate.set(r.date, (sumByDate.get(r.date) || 0) + Number(r.workingHours || 0))
      nByDate.set(r.date, (nByDate.get(r.date) || 0) + 1)
    })
    hoursTrend.forEach((h) => {
      const n = nByDate.get(h.date) || 0
      h.hours = n ? +((sumByDate.get(h.date) || 0) / n).toFixed(1) : 0
    })

    return {
      date,
      totalEmployees,
      present, late, earlyExit, onLeave: effectiveOnLeave,
      absent: effectiveAbsent,
      absentMarked: absent,
      absentUnmarked: unmarkedAbsent,
      notMarked,
      totalRecords: records.length,
      totalOvertime, avgHours,
      attendanceRate: Math.round(markedPresent / (expected || 1) * 100),
      byDepartment: Object.values(deptMap),
      monthlyTrend,
      hoursTrend,

      byRole: Object.values(roleMap),
      statusSplit: [
        { name: 'Present', value: present }, { name: 'Late', value: late },
        { name: 'Early Exit', value: earlyExit }, { name: 'Absent', value: effectiveAbsent }, { name: 'On Leave', value: effectiveOnLeave },
        { name: 'Not Marked', value: notMarked },
      ].filter((s) => s.value > 0),
    }
  },
}
