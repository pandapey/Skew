import { LeaveRequest, LeaveBalance, LeaveType } from '../models/leaveModels.js'
import { Holiday, Attendance } from '../models/attendanceModels.js'
import { Employee } from '../models/Employee.js'
import { User } from '../models/User.js'
import { ApiError } from '../utils/asyncHandler.js'
import {
  resolveLeaveDuration, countSundays, parseDate, SUNDAY, MAX_LEAVE_DAYS_PER_REQUEST,
  HOURLY_PERMISSION_MONTHLY_HOURS, HOURLY_PERMISSION_STEP_HOURS, monthKeyOf, monthBounds,
  isCapExemptLeaveType, maxDaysForRequest,
} from '../utils/leaveDays.js'
import {
  loadShiftContext, buildExpiryInstant, expiryFor,
} from '../utils/leaveExpiry.js'
import { notifyUsersByName } from './notificationService.js'

const daysBetween = (from, to) => resolveLeaveDuration({ from, to }).days

const withId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc)
const withIds = (docs) => docs.map(withId)

// empCodes survive renames: match requests by code with name fallback.
// Pure shape helper — keeps "my" queries working after a name change.
function withEmployeeFallback(filter, user) {
  if (!user?.empCode || filter.employee == null) return filter
  const ors = [{ employee: filter.employee }, { empCode: user.empCode }]
  delete filter.employee
  if (filter.$or) {
    const search = filter.$or
    delete filter.$or
    filter.$and = [...(filter.$and || []), { $or: ors }, { $or: search }]
  } else {
    filter.$or = ors
  }
  return filter
}

// In-app fan-out to everyone who can approve (Admin/Manager), excluding
// the applicant. This replaces the old no-op email stub below it.
async function notifyApprovers(payload, excludeName) {
  const approvers = await User.find({ role: { $in: ['Admin', 'Manager'] }, status: 'Active' })
    .select('name -_id')
    .lean()
  const names = approvers.map((a) => a.name).filter((n) => n && n !== excludeName)
  if (names.length) await notifyUsersByName(names, payload)
}

async function syncAttendanceForApprovedLeave(req) {
  const dates = []
  if (req.halfDay) {
    dates.push(req.from)
  } else {
    const a = parseDate(req.from)
    const b = parseDate(req.to)
    if (a && b) {
      a.setHours(0, 0, 0, 0)
      b.setHours(0, 0, 0, 0)
      const cursor = new Date(a)
      while (cursor <= b) {
        if (cursor.getDay() !== SUNDAY) {
          const y = cursor.getFullYear()
          const m = String(cursor.getMonth() + 1).padStart(2, '0')
          const d = String(cursor.getDate()).padStart(2, '0')
          dates.push(`${y}-${m}-${d}`)
        }
        cursor.setDate(cursor.getDate() + 1)
      }
    }
  }
  if (!dates.length) return

  const emp = await Employee.findOne({ name: req.employee }).lean()
  await Promise.all(dates.map((date) => Attendance.findOneAndUpdate(
    { employee: req.employee, date, checkInAt: { $exists: false } },
    {
      $setOnInsert: {
        employee: req.employee,
        empCode: emp?.empCode,
        employeeId: emp?._id,
        department: emp?.department,
        date,
      },
      $set: { status: 'On Leave' },
    },
    { upsert: true, setDefaultsOnInsert: true },
  )))
}

async function paginate(filter, query) {
  const { page = 1, limit = 8 } = query
  const pageNum = Math.max(1, Number(page))
  const limitNum = Math.min(100, Math.max(1, Number(limit)))
  const [data, total] = await Promise.all([
    LeaveRequest.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    LeaveRequest.countDocuments(filter),
  ])
  return { data: withIds(data), total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
}

function buildFilter({ search = '', status, type, department, employee }) {
  const filter = {}
  if (status) filter.status = status
  if (type) filter.type = type
  if (department) filter.department = department
  if (employee) filter.employee = employee
  if (search) filter.$or = [
    { employee: { $regex: search, $options: 'i' } },
    { empCode: { $regex: search, $options: 'i' } },
    { reason: { $regex: search, $options: 'i' } },
  ]
  return filter
}

const SEES_ALL_LEAVE_TYPES = ['Admin', 'Manager']

const LEAVE_APPROVER_ROLES = ['Admin', 'Manager']

export function canSeeLeaveType(type, user, { forApply = false } = {}) {
  const restriction = type?.genderRestriction || 'Any'

  if (restriction === 'Any') return true
  if (SEES_ALL_LEAVE_TYPES.includes(user?.role) && !forApply) return true
  return restriction === user?.gender
}

export async function expireStaleRequests() {
  const pending = await LeaveRequest.find({ status: 'Pending' })
    .select('_id employee from expiresAt workflow')
    .lean()
  if (!pending.length) return 0

  const ctx = await loadShiftContext()
  const shiftByEmployee = await employeeShiftMap(pending.map((r) => r.employee))
  const now = new Date()

  const due = pending.filter((r) => {
    const at = expiryFor(r, ctx, shiftByEmployee.get(r.employee))
    return at && at <= now
  })
  if (!due.length) return 0

  await LeaveRequest.bulkWrite(due.map((r) => ({
    updateOne: {
      filter: { _id: r._id, status: 'Pending' },
      update: {
        $set: { status: 'Expired', expiredAt: now },
        $push: {
          workflow: {
            stage: 'Expired',
            by: 'System',
            at: now,
            note: 'Automatically expired \u2014 no decision was recorded before month end',
          },
        },
      },
    },
  })))
  return due.length
}

async function assertDatesAreRequestable(user, from, to, { forHourly = false } = {}) {
  const start = parseDate(from)
  const end = parseDate(to) || start
  if (!start || !end) throw new ApiError(422, 'Both a start and end date are required')

  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  if (end < start) {
    throw new ApiError(422, 'The end date cannot be before the start date')
  }

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const who = user?.empCode
    ? { $or: [{ employee: user.name }, { empCode: user.empCode }] }
    : { employee: user.name }
  const marked = await Attendance.find({
    ...who,
    date: { $gte: iso(start), $lte: iso(end) },
  }).select('date status checkIn checkInAt').lean()

  if (forHourly) {
    // Hourly permission is a short break *while at work* — a check-in /
    // Present record must NOT block it. Only block if already on full leave.
    const onLeave = marked.filter((a) => a.status === 'On Leave')
    if (onLeave.length) {
      const dates = onLeave.map((a) => a.date).sort()
      throw new ApiError(
        422,
        `You are already marked On Leave for ${dates.join(', ')}. Hourly permission cannot be requested for a date that is already on full leave.`,
      )
    }
  } else {
    const blocking = marked.filter(
      (a) => a.checkIn || a.checkInAt || (a.status && a.status !== 'Not Marked'),
    )
    if (blocking.length) {
      const dates = blocking.map((a) => a.date).sort()
      const checkedIn = blocking.find((a) => a.checkIn || a.checkInAt)
      if (checkedIn) {
        throw new ApiError(
          422,
          `You already checked in on ${checkedIn.date}, so leave cannot be requested for that date.`,
        )
      }
      throw new ApiError(
        422,
        `Attendance has already been recorded for ${dates.join(', ')}. Leave cannot be requested for a date that is already accounted for.`,
      )
    }
  }

  const clashFilter = {
    ...who,
    status: { $in: ['Pending', 'Approved'] },
    from: { $lte: iso(end) },
    to: { $gte: iso(start) },
  }
  if (forHourly) {
    // Multiple hourly permissions on the same date are allowed (up to the
    // monthly hour allowance) — only full-day leaves clash with them.
    clashFilter.requestKind = { $ne: 'Hourly Permission' }
  }
  const clashes = await LeaveRequest.find(clashFilter).select('from to type status days').lean()

  if (clashes.length) {
    const c = clashes[0]
    const span = c.from === c.to ? c.from : `${c.from} to ${c.to}`
    throw new ApiError(
      422,
      `These dates overlap an existing ${String(c.status).toLowerCase()} ${c.type} request (${span}). Cancel or amend that request first, or pick dates that do not overlap it.`,
    )
  }
}

async function availableBalanceFor(user, typeName) {
  const [type, override, approved] = await Promise.all([
    LeaveType.findOne({ name: typeName }).lean(),
    LeaveBalance.findOne({ employee: user.name, type: typeName }).lean(),
    LeaveRequest.find(withEmployeeFallback({ employee: user.name, type: typeName, status: 'Approved' }, user)).select('days').lean(),
  ])
  if (!type) return 0
  const allocated = override && typeof override.allocated === 'number' && override.allocated > 0
    ? override.allocated
    : (type.allocated || 0)
  const used = approved.reduce((s, r) => s + (r.days || 0), 0)
  return Math.max(0, allocated - used)
}

async function employeeShiftMap(names) {
  const { Employee } = await import('../models/Employee.js')
  const unique = [...new Set((names || []).filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await Employee.find({ name: { $in: unique } }).select('name shift').lean()
  return new Map(rows.map((e) => [e.name, e.shift]))
}

export const leaveService = {
  async list(query) {
    await expireStaleRequests()
    return paginate(buildFilter(query), query)
  },

  async myRequests(user, query) {
    await expireStaleRequests()
    return paginate(withEmployeeFallback(buildFilter({ ...query, employee: user.name }), user), query)
  },

  async get(id, user) {
    const doc = await LeaveRequest.findById(id).lean()
    if (!doc) throw new ApiError(404, 'Leave request not found')
    if (user && !LEAVE_APPROVER_ROLES.includes(user.role) && doc.employee !== user.name) {
      throw new ApiError(403, 'You can only view your own leave requests')
    }
    return withId(doc)
  },

  async apply(user, body) {
    const halfDay = Boolean(body.halfDay)
    const halfDaySession = halfDay ? (body.halfDaySession || null) : null
    const holidayRows = await Holiday.find().select('date').lean()
    const holidayDates = new Set(holidayRows.map((h) => h.date))
    const { days, error } = resolveLeaveDuration({
      from: body.from,
      to: body.to,
      halfDay,
      halfDaySession,
      holidays: holidayDates,
    })
    if (error) throw new ApiError(422, error)

    const availableForType = isCapExemptLeaveType(body.type)
      ? await availableBalanceFor(user, body.type)
      : null
    const requestCap = maxDaysForRequest(body.type, availableForType)
    if (days > requestCap) {
      throw new ApiError(
        422,
        isCapExemptLeaveType(body.type)
          ? `${body.type} is limited by your available balance. You have ${requestCap} day(s) available and this request covers ${days} days.`
          : `A single leave request cannot exceed ${MAX_LEAVE_DAYS_PER_REQUEST} days. This request covers ${days} days — please split it into separate requests.`,
      )
    }

    await assertDatesAreRequestable(user, body.from, body.to)

    const type = await LeaveType.findOne({ name: body.type })
    if (!type) throw new ApiError(422, `Unknown leave type: ${body.type}`)

    // Enforce allocation for paid leave (override-aware via availableBalanceFor).
    // Unpaid types are intentionally unlimited — payroll prices them separately.
    if (type.paid !== false) {
      const available = await availableBalanceFor(user, body.type)
      if (days > available) {
        throw new ApiError(422, `Insufficient balance: ${available} day(s) available, ${days} requested`)
      }
    }

    if (!canSeeLeaveType(type, user)) {
      throw new ApiError(
        422,
        user?.gender
          ? `${type.name} is not available for your profile`
          : `${type.name} is restricted by gender. Ask HR to complete the gender on your profile before applying for this leave type.`,
      )
    }
    if (halfDay && type.paid === false) {
      throw new ApiError(422, 'Half-day leave is only available on paid leave types')
    }

    const sundaysExcluded = halfDay ? 0 : countSundays(body.from, body.to)
    const appliedNote = halfDay
      ? `Half-day (${halfDaySession}) leave request submitted`
      : sundaysExcluded > 0
        ? `Leave request submitted \u2014 ${sundaysExcluded} Sunday(s) excluded from the duration`
        : 'Leave request submitted'

    // Leave requests expire at month end (month of the last leave day).
    const expiresAt = buildExpiryInstant(body.to || body.from)

    const req = await LeaveRequest.create({
      employee: user.name, empCode: user.empCode, department: user.department,
      type: body.type, typeCode: type?.code, from: body.from, to: body.to, days,
      reason: body.reason, status: 'Pending',
      halfDay, halfDaySession, sundaysExcluded,
      expiresAt,
      workflow: [{ stage: 'Applied', by: user.name, note: appliedNote }],
    })
    notifyApprovers({
      type: 'leave',
      title: 'New leave request',
      body: `${user.name} applied for ${days} day(s) of ${body.type} (${body.from === body.to ? body.from : `${body.from} to ${body.to}`}).`,
      sender: user.name,
      link: `/leave?request=${req._id}`,
      priority: 'high',
    }, user.name).catch(() => {})
    return withId(req.toObject())
  },

  async hourlyUsage(employeeName, month, empCode = null) {
    const bounds = monthBounds(month)
    if (!bounds) return 0
    const base = {
      requestKind: 'Hourly Permission',
      status: { $in: ['Pending', 'Approved'] },
      from: { $gte: bounds.start, $lte: bounds.end },
    }
    const filter = empCode
      ? { ...base, $or: [{ employee: employeeName }, { empCode }] }
      : { ...base, employee: employeeName }
    const rows = await LeaveRequest.find(filter).select('hours').lean()
    return rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0)
  },

  async hourlyBalance(user, month) {
    const key = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : monthKeyOf(new Date())
    const used = await this.hourlyUsage(user.name, key, user.empCode)
    const allowance = HOURLY_PERMISSION_MONTHLY_HOURS
    return {
      month: key,
      allowance,
      used: Number(used.toFixed(2)),
      remaining: Number(Math.max(0, allowance - used).toFixed(2)),
      stepHours: HOURLY_PERMISSION_STEP_HOURS,
    }
  },

  async applyHourly(user, body) {
    const date = body.date || body.from
    const hours = Number(body.hours)

    if (!date) throw new ApiError(422, 'A date is required')
    if (!body.reason || !String(body.reason).trim()) {
      throw new ApiError(422, 'A reason is required')
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new ApiError(422, 'Hours requested must be greater than zero')
    }
    if (Math.round(hours * 2) !== hours * 2) {
      throw new ApiError(422, `Hours must be in increments of ${HOURLY_PERMISSION_STEP_HOURS}`)
    }
    if (hours > HOURLY_PERMISSION_MONTHLY_HOURS) {
      throw new ApiError(
        422,
        `A single hourly permission cannot exceed the ${HOURLY_PERMISSION_MONTHLY_HOURS}h monthly allowance`,
      )
    }

    await assertDatesAreRequestable(user, date, date, { forHourly: true })

    const month = monthKeyOf(date)
    const used = await this.hourlyUsage(user.name, month, user.empCode)
    const remaining = HOURLY_PERMISSION_MONTHLY_HOURS - used
    if (hours > remaining) {
      throw new ApiError(
        422,
        `Only ${Number(Math.max(0, remaining).toFixed(2))}h of your ${HOURLY_PERMISSION_MONTHLY_HOURS}h monthly permission allowance remains for ${month} (${Number(used.toFixed(2))}h already committed). You requested ${hours}h.`,
      )
    }

    const expiresAt = buildExpiryInstant(date)

    const req = await LeaveRequest.create({
      employee: user.name, empCode: user.empCode, department: user.department,
      type: 'Hourly Permission', typeCode: 'HP',
      requestKind: 'Hourly Permission',
      from: date, to: date,
      days: 0,
      hours,
      reason: body.reason,
      status: 'Pending',
      expiresAt,
      workflow: [{
        stage: 'Applied',
        by: user.name,
        note: `Hourly permission requested \u2014 ${hours}h on ${date}`,
      }],
    })

    notifyApprovers({
      type: 'leave',
      title: 'New hourly permission request',
      body: `${user.name} requested ${hours}h of permission on ${date}.`,
      sender: user.name,
      link: `/leave?request=${req._id}`,
      priority: 'high',
    }, user.name).catch(() => {})
    return withId(req.toObject())
  },

  async decide(id, action, approver, note) {

    const comment = typeof note === 'string' ? note.trim() : ''
    if (!comment) {
      throw new ApiError(422, 'A comment is required when approving or rejecting a leave request')
    }

    const req = await LeaveRequest.findById(id)
    if (!req) throw new ApiError(404, 'Leave request not found')
    if (req.status === 'Expired') {
      throw new ApiError(409, 'This request expired because it was not actioned before month end. It can no longer be approved or rejected.')
    }
    if (req.status !== 'Pending') throw new ApiError(409, `Request already ${req.status.toLowerCase()}`)

    const status = action === 'approve' ? 'Approved' : 'Rejected'

    if (status === 'Approved' && req.requestKind !== 'Hourly Permission') {
      // Re-check allocation at decision time (balances may have moved since apply).
      const reqType = await LeaveType.findOne({ name: req.type }).lean()
      if (reqType && reqType.paid !== false) {
        const reqUser = await User.findOne({ name: req.employee }).select('name empCode').lean()
        const available = await availableBalanceFor(
          { name: req.employee, empCode: reqUser?.empCode }, req.type,
        )
        if (available < req.days) throw new ApiError(422, 'Insufficient balance to approve')
      }
      const balance = await LeaveBalance.findOne({ employee: req.employee, type: req.type })
      if (balance) {
        balance.used += req.days
        balance.balance -= req.days
        await balance.save()
      }
    }

    const decidedAt = new Date()
    req.status = status
    req.approver = approver
    req.decision = { action: status, comment, by: approver, at: decidedAt }
    req.workflow.push({ stage: status, by: approver, at: decidedAt, note: comment })
    await req.save()

    if (status === 'Approved' && req.requestKind !== 'Hourly Permission') {
      await syncAttendanceForApprovedLeave(req).catch((err) => {
        console.error('syncAttendanceForApprovedLeave failed:', err?.message)
      })
    }

    const isHourly = req.requestKind === 'Hourly Permission'
    const label = isHourly
      ? `Hourly Permission ${status}`
      : req.halfDay ? `Half Day Leave ${status}` : `Leave ${status}`
    const span = isHourly
      ? `${req.hours}h on ${req.from}`
      : req.halfDay
        ? `${req.halfDaySession} on ${req.from}`
        : req.from === req.to ? req.from : `${req.from} \u2192 ${req.to}`
    await notifyUsersByName([req.employee], {
      type: 'leave',
      title: label,
      body: `${req.type} (${span}${isHourly ? '' : `, ${req.days} day(s)`}) was ${status.toLowerCase()} by ${approver}. Comment: ${comment}`,
      sender: approver,
      link: `/leave?request=${req._id}`,
      priority: status === 'Rejected' ? 'high' : 'normal',
    })

    return withId(req.toObject())
  },

  async cancel(user, id) {
    const req = await LeaveRequest.findById(id)
    if (!req) throw new ApiError(404, 'Leave request not found')
    if (req.employee !== user.name) throw new ApiError(403, 'You can only cancel your own requests')
    if (req.status === 'Expired') {
      throw new ApiError(409, 'This request has expired and can no longer be cancelled.')
    }
    if (req.status !== 'Pending') throw new ApiError(409, 'Only pending requests can be cancelled')
    req.status = 'Cancelled'
    req.workflow.push({ stage: 'Cancelled', by: user.name, note: 'Cancelled by employee' })
    await req.save()
    return withId(req.toObject())
  },

  async remove(id) {
    const doc = await LeaveRequest.findByIdAndDelete(id)
    if (!doc) throw new ApiError(404, 'Leave request not found')
    // Undo approval side-effects so balances/attendance stay consistent.
    if (doc.status === 'Approved' && doc.requestKind !== 'Hourly Permission' && (doc.days || 0) > 0) {
      const balance = await LeaveBalance.findOne({ employee: doc.employee, type: doc.type })
      if (balance) {
        balance.used = Math.max(0, (balance.used || 0) - doc.days)
        balance.balance = (balance.balance || 0) + doc.days
        await balance.save().catch(() => {})
      }
      // Remove the auto-created On Leave attendance rows (only untouched ones).
      const dates = []
      if (doc.halfDay) {
        dates.push(doc.from)
      } else {
        const a = parseDate(doc.from)
        const b = parseDate(doc.to)
        if (a && b) {
          a.setHours(0, 0, 0, 0)
          b.setHours(0, 0, 0, 0)
          const cursor = new Date(a)
          while (cursor <= b) {
            if (cursor.getDay() !== SUNDAY) {
              const y = cursor.getFullYear()
              const m = String(cursor.getMonth() + 1).padStart(2, '0')
              const d = String(cursor.getDate()).padStart(2, '0')
              dates.push(`${y}-${m}-${d}`)
            }
            cursor.setDate(cursor.getDate() + 1)
          }
        }
      }
      if (dates.length) {
        await Attendance.deleteMany({
          employee: doc.employee,
          date: { $in: dates },
          status: 'On Leave',
          checkIn: null,
          checkOut: null,
        }).catch(() => {})
      }
    }
    return { id }
  },

  async balances(user) {
    const decidedFilter = withEmployeeFallback(
      { employee: user.name, status: { $in: ['Approved', 'Pending'] } }, user,
    )
    const [allTypes, decided, overrides] = await Promise.all([
      LeaveType.find({ active: { $ne: false } }).sort({ name: 1 }).lean(),
      LeaveRequest.find(decidedFilter).lean(),
      LeaveBalance.find({ employee: user.name }).lean(),
    ])
    const approved = decided.filter((r) => r.status === 'Approved')
    const pending = decided.filter((r) => r.status === 'Pending')
    const types = allTypes.filter((t) => canSeeLeaveType(t, user, { forApply: true }))
    const usedByType = {}
    approved.forEach((r) => { usedByType[r.type] = (usedByType[r.type] || 0) + (r.days || 0) })
    const requestedByType = {}
    pending.forEach((r) => { requestedByType[r.type] = (requestedByType[r.type] || 0) + (r.days || 0) })
    const overrideByType = {}
    overrides.forEach((b) => { overrideByType[b.type] = b })
    return types.map((t) => {
      const ov = overrideByType[t.name]
      const allocated = ov && typeof ov.allocated === 'number' && ov.allocated > 0 ? ov.allocated : (t.allocated || 0)
      const used = usedByType[t.name] || 0
      return {
        id: String(t._id),
        type: t.name,
        code: t.code,
        color: t.color || '#2563EB',
        paid: t.paid,
        allocated,
        used,
        requested: requestedByType[t.name] || 0,
        balance: Math.max(0, allocated - used),
      }
    })
  },

  async holidays() {
    const rows = await Holiday.find().sort({ date: 1 }).lean()
    return withIds(rows)
  },

  async stats() {
    await expireStaleRequests()
    const all = await LeaveRequest.find().lean()
    const byStatus = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired'].map((name) => ({ name, value: all.filter((r) => r.status === name).length }))

    const typeMap = {}
    all.forEach((r) => { const k = r.typeCode || r.type; typeMap[k] = (typeMap[k] || 0) + 1 })
    const byType = Object.entries(typeMap).map(([name, value]) => ({ name, value }))

    const deptMap = {}
    all.filter((r) => r.status === 'Approved').forEach((r) => { deptMap[r.department] = (deptMap[r.department] || 0) + r.days })
    const byDepartment = Object.entries(deptMap).map(([name, value]) => ({ name, value }))

    const hourlyAll = all.filter((r) => r.requestKind === 'Hourly Permission')
    const sumHours = (rows) => Number(rows.reduce((s, r) => s + (Number(r.hours) || 0), 0).toFixed(2))
    const hourlyPermission = {
      total: hourlyAll.length,
      pending: hourlyAll.filter((r) => r.status === 'Pending').length,
      approved: hourlyAll.filter((r) => r.status === 'Approved').length,
      rejected: hourlyAll.filter((r) => r.status === 'Rejected').length,
      totalHoursApproved: sumHours(hourlyAll.filter((r) => r.status === 'Approved')),
      byDepartment: Object.entries(
        hourlyAll.filter((r) => r.status === 'Approved').reduce((acc, r) => {
          acc[r.department] = Number(((acc[r.department] || 0) + (Number(r.hours) || 0)).toFixed(2))
          return acc
        }, {}),
      ).map(([name, value]) => ({ name, value })),
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const trendMap = {}
    all.forEach((r) => {
      const d = new Date(r.from)
      if (Number.isNaN(d.getTime())) return
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const bucket = (trendMap[key] ||= { month: MONTHS[d.getMonth()], approved: 0, rejected: 0 })
      if (r.status === 'Approved') bucket.approved += 1
      if (r.status === 'Rejected') bucket.rejected += 1
    })
    const monthlyTrend = Object.entries(trendMap)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .slice(-6)
      .map(([, v]) => v)

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const upcoming = await Holiday.find({ date: { $gte: today } }).sort({ date: 1 }).limit(4).lean()

    const decidedOn = (row) => (row?.decision?.at
      ? new Date(row.decision.at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      : null)
    const todayApproved = all.filter((r) => r.status === 'Approved' && decidedOn(r) === today).length
    const todayRejected = all.filter((r) => r.status === 'Rejected' && decidedOn(r) === today).length
    const onLeaveToday = all.filter((r) => r.status === 'Approved' && r.from <= today && r.to >= today).length

    return {
      total: all.length,
      pending: all.filter((r) => r.status === 'Pending').length,
      approved: all.filter((r) => r.status === 'Approved').length,
      rejected: all.filter((r) => r.status === 'Rejected').length,
      expired: all.filter((r) => r.status === 'Expired').length,
      todayApproved, todayRejected, onLeaveToday, today,
      totalDaysApproved: all.filter((r) => r.status === 'Approved').reduce((s, r) => s + r.days, 0),
      byStatus, byType, byDepartment, monthlyTrend,
      hourlyPermission,
      upcomingHolidays: withIds(upcoming),
    }
  },
}
