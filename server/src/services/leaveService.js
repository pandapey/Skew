import { LeaveRequest, LeaveBalance, LeaveType } from '../models/leaveModels.js'
import { Holiday, Attendance } from '../models/attendanceModels.js'
import { Employee } from '../models/Employee.js'
import { ApiError } from '../utils/asyncHandler.js'
import {
  resolveLeaveDuration, countSundays, parseDate, SUNDAY, MAX_LEAVE_DAYS_PER_REQUEST,
  HOURLY_PERMISSION_MONTHLY_HOURS, HOURLY_PERMISSION_STEP_HOURS, monthKeyOf, monthBounds,
  // Phase 6.9 (TASK 16): per-type request cap, declared once in leaveDays.js.
  isCapExemptLeaveType, maxDaysForRequest,
} from '../utils/leaveDays.js'
import {
  loadShiftContext, resolveShiftStart, buildExpiryInstant, expiryFor,
} from '../utils/leaveExpiry.js'
import { notifyUsersByName } from './notificationService.js'

// Phase 4: day arithmetic moved to ../utils/leaveDays.js so that Sunday
// exclusion and half-day handling are identical everywhere (apply, approve,
// balances, reports, payroll). The old inclusive `daysBetween` counted Sundays
// and could not express 0.5, so it was replaced rather than kept alongside.
const daysBetween = (from, to) => resolveLeaveDuration({ from, to }).days

// Frontend keys every row on `.id`; Mongo returns `_id`. Normalize on the way out.
const withId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc)
const withIds = (docs) => docs.map(withId)

// Email-ready notification hook. Swap console for Nodemailer in production.
function notify(to, subject, body) {
  // e.g. await mailer.sendMail({ to, subject, text: body })
}

// Phase 5.2 (Bug #4) root cause: approving a leave request only ever updated
// the LeaveRequest/LeaveBalance documents — the Attendance module is a
// separate collection and was never told, so an approved employee still showed
// as 'Absent' / 'Not Marked' on their leave days in attendance, reports and
// payroll. Reuses the exact chargeable-day rules already used for balance
// deduction (Sundays excluded, half-day = the single 'from' day) via
// parseDate/SUNDAY from leaveDays.js — no parallel calendar logic.
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
    // Never clobber a day the employee actually punched in for — only mark a
    // day 'On Leave' when there is no real check-in on record for it.
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

// Shared paginated finder for leave requests.
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

// Build a filter from list/report query params.
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

// --- Phase 5 (Task 2): gender-based leave type visibility -------------------
// Roles that always see every leave type regardless of their own gender, so HR
// and Admin can apply on behalf of, and report across, the whole company.
// Phase 7.2: HR was merged into Manager.
const SEES_ALL_LEAVE_TYPES = ['Admin', 'Manager']

// PHASE SALARY/PROJECT AUDIT (LEAVE BUG 1): the roles that may read/approve
// ANY employee's leave request. Mirrors `canApprove` in routes/leaveRoutes.js
// exactly, declared once here so the service-layer ownership check in `get()`
// below cannot drift away from the route-layer guard.
const LEAVE_APPROVER_ROLES = ['Admin', 'Manager']

// Is one leave type visible to one user? A type is hidden only when it declares
// a gender restriction that conflicts with the user's gender.
//
// A user whose gender is still null (a legacy account) sees ONLY unrestricted
// types. Hiding is the safe direction: showing Maternity to an unknown gender
// is the exact bug this task exists to fix, and the employee simply has to have
// their profile completed to unlock the gender-specific type.
export function canSeeLeaveType(type, user, { forApply = false } = {}) {
  const restriction = type?.genderRestriction || 'Any'
  // No gender restriction — visible to everyone.
  if (restriction === 'Any') return true
  // Admin/HR may MANAGE all types. But when applying leave for themselves,
  // they should only see types applicable to their own gender (forApply=true).
  if (SEES_ALL_LEAVE_TYPES.includes(user?.role) && !forApply) return true
  // Gender-restricted: check the user's stored gender.
  return restriction === user?.gender
}

// --- Phase 5 (Task 6): expiry sweeper ---------------------------------------
// A Pending request whose shift-start deadline has passed becomes Expired.
//
// This runs BOTH on a timer (see startLeaveScheduler) and lazily before every
// read of the request lists. The lazy call is what guarantees correctness: a
// user must never open the approvals inbox and see an actionable Approve button
// on a request that is already past its deadline, even if the scheduler is not
// running (single-run scripts, tests, a crashed worker).
//
// Returns the number of requests expired.
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

  // One bulk write rather than N saves — the sweeper runs on every list read.
  await LeaveRequest.bulkWrite(due.map((r) => ({
    updateOne: {
      // Re-assert status:'Pending' in the filter so a request approved by HR
      // in the milliseconds since the read above is never clobbered.
      filter: { _id: r._id, status: 'Pending' },
      update: {
        $set: { status: 'Expired', expiredAt: now },
        $push: {
          workflow: {
            stage: 'Expired',
            by: 'System',
            at: now,
            note: 'Automatically expired \u2014 no decision was recorded before the shift start time on the first day of leave',
          },
        },
      },
    },
  })))
  return due.length
}

// --- Phase 5 (Task 3): reject leave for time that has already happened ------
// Phase 5.5 (Task 2) — ATTENDANCE, NOT THE CALENDAR, decides requestability.
//
// Previously rule 1 was a blanket "no start date before today", which made a
// common real-world case impossible: an employee who was absent last Thursday
// and never had a record created could not retroactively regularise that day
// as leave. The calendar was being used as a proxy for "this day is already
// accounted for", and that proxy was simply wrong.
//
// The rule now asks the actual business question. A date is blocked if and
// only if MongoDB already holds a real Attendance record for it:
//   1. No date in the range that already has an Attendance record.
//   2. No leave for a day the employee has already checked in on.
//
// A past date with NO attendance record is therefore requestable, and today is
// still allowed while untouched (the "I woke up ill before my shift" case).
// Because this is a single range query across the whole from..to span, it
// applies identically to full-day, half-day and hourly-permission requests —
// there is no separate code path to keep in sync.
async function assertDatesAreRequestable(user, from, to) {
  const start = parseDate(from)
  const end = parseDate(to) || start
  if (!start || !end) throw new ApiError(422, 'Both a start and end date are required')

  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  if (end < start) {
    throw new ApiError(422, 'The end date cannot be before the start date')
  }

  // Rules 1 + 2: any day in the range that the employee has already worked.
  // One indexed range query over the employee's own attendance.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const marked = await Attendance.find({
    employee: user.name,
    date: { $gte: iso(start), $lte: iso(end) },
  }).select('date status checkIn checkInAt').lean()

  // 'Not Marked' is a placeholder row the attendance module creates for days
  // that were never actioned, so it must NOT block a leave request. Anything
  // else means the day was genuinely accounted for.
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

  // --- Phase 6.9 (TASK 5): overlapping leave dates -------------------------
  // ROOT CAUSE: this validator only ever consulted the ATTENDANCE collection.
  // Nothing anywhere in apply() looked at the employee's OTHER LeaveRequest
  // documents, and the LeaveRequest schema has no range constraint (its only
  // indexes are employee/status/date). So requesting the 1st-3rd and then the
  // 2nd created two independent Pending rows covering the same calendar day,
  // and if both were approved the balance was deducted twice for that day.
  //
  // The check is added HERE, inside the one shared validator that apply()
  // already calls for full-day, half-day and hourly-permission requests, so
  // there is no second code path and no new endpoint. Only Pending and
  // Approved requests block: Rejected, Cancelled and Expired requests release
  // their dates, which is what makes re-applying after a rejection work.
  //
  // Standard inclusive interval-overlap test: two ranges collide when
  // existing.from <= new.to AND existing.to >= new.from.
  const clashes = await LeaveRequest.find({
    employee: user.name,
    status: { $in: ['Pending', 'Approved'] },
    from: { $lte: iso(end) },
    to: { $gte: iso(start) },
  }).select('from to type status days').lean()

  if (clashes.length) {
    const c = clashes[0]
    const span = c.from === c.to ? c.from : `${c.from} to ${c.to}`
    throw new ApiError(
      422,
      `These dates overlap an existing ${String(c.status).toLowerCase()} ${c.type} request (${span}). Cancel or amend that request first, or pick dates that do not overlap it.`,
    )
  }
}

// --- Phase 6.9 (TASK 16): available balance for ONE leave type ---------------
// Reuses the EXACT derivation already used by leaveService.balances()
// (allocation from the LeaveType, optionally overridden by a per-employee
// LeaveBalance row, minus the sum of APPROVED days) so the cap can never
// disagree with the number the balance card shows. Scoped to a single type so
// apply() does not have to build the whole balance list.
async function availableBalanceFor(user, typeName) {
  const [type, override, approved] = await Promise.all([
    LeaveType.findOne({ name: typeName }).lean(),
    LeaveBalance.findOne({ employee: user.name, type: typeName }).lean(),
    LeaveRequest.find({ employee: user.name, type: typeName, status: 'Approved' }).select('days').lean(),
  ])
  if (!type) return 0
  const allocated = override && typeof override.allocated === 'number' && override.allocated > 0
    ? override.allocated
    : (type.allocated || 0)
  const used = approved.reduce((s, r) => s + (r.days || 0), 0)
  return Math.max(0, allocated - used)
}

// Map employee name -> assigned shift name, for expiry/reminder maths.
// Imported lazily to avoid a circular import at module load time
// (Employee -> identityLink -> ... -> leaveService).
async function employeeShiftMap(names) {
  const { Employee } = await import('../models/Employee.js')
  const unique = [...new Set((names || []).filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await Employee.find({ name: { $in: unique } }).select('name shift').lean()
  return new Map(rows.map((e) => [e.name, e.shift]))
}

export const leaveService = {
  // Org-wide requests (approvals inbox / reports).
  // The sweep runs first so the caller can never act on a stale Pending row.
  async list(query) {
    await expireStaleRequests()
    return paginate(buildFilter(query), query)
  },

  // Current user's own requests.
  async myRequests(user, query) {
    await expireStaleRequests()
    return paginate(buildFilter({ ...query, employee: user.name }), query)
  },

  // PHASE SALARY/PROJECT AUDIT (LEAVE BUG 1) — CROSS-EMPLOYEE LEAVE READ.
  //
  // TRACE: GET /api/leave/requests/:id -> leaveController.get -> here.
  //
  // ROOT CAUSE: routes/leaveRoutes.js mounts this path WITHOUT the `canApprove`
  // guard its sibling routes carry, and deliberately so — an ordinary employee
  // has to be able to open their own request (this is the target of the
  // "Leave Approved/Rejected" notification deep link and of the HR reminder).
  // But the service then loaded the document by id with no scoping at all, so
  // any authenticated staff account could read ANY employee's leave request —
  // type, dates, the stated reason, and the approver's private comment — just by
  // changing the id. The route guard was intentionally relaxed; the ownership
  // check that was supposed to replace it was never written.
  //
  // FIX: scope in the service, where the caller identity is known. Approvers
  // (Admin / HR / Manager) keep the org-wide read they already have through
  // GET /leave/requests, so no existing capability is removed. `user` is
  // optional so any internal caller that legitimately has no session (none
  // today) keeps working rather than failing closed on a null.
  async get(id, user) {
    const doc = await LeaveRequest.findById(id).lean()
    if (!doc) throw new ApiError(404, 'Leave request not found')
    if (user && !LEAVE_APPROVER_ROLES.includes(user.role) && doc.employee !== user.name) {
      throw new ApiError(403, 'You can only view your own leave requests')
    }
    return withId(doc)
  },

  async apply(user, body) {
    // The server NEVER trusts a client-supplied `days`. Duration is always
    // recomputed from the date range so Sunday exclusion and the 0.5 half-day
    // rule cannot be bypassed by crafting a request payload.
    const halfDay = Boolean(body.halfDay)
    const halfDaySession = halfDay ? (body.halfDaySession || null) : null
    // Phase 6.4 (TASK 6) ROOT CAUSE FIX: leave duration previously only ever
    // excluded Sundays, so a Company Holiday that fell inside a requested
    // range was still charged as a leave day. Company Holidays are the single
    // source of truth in the Holiday collection, so we load their dates here
    // and hand them to the SAME shared resolver (resolveLeaveDuration) rather
    // than forking a second calculation.
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

    // --- Phase 5.5 (Task 3): cap a single request at 5 chargeable days -------
    // Checked against the SERVER-recomputed `days` (never a client-supplied
    // figure), and against chargeable days rather than the raw calendar span,
    // so the cap composes correctly with Sunday exclusion: Mon..Sat spans six
    // calendar dates but costs 5 days and is therefore allowed.
    // This is a balance-independent policy limit — an employee holding 30 days
    // still cannot take more than 5 in one request.
    //
    // Phase 6.9 (TASK 16): the cap is now TYPE-AWARE. Maternity and Paternity
    // leave are statutory continuous absences (180 / 15 day entitlements), so
    // splitting them into five-day chunks was never workable. For those two
    // types the ceiling becomes the employee's AVAILABLE BALANCE; every other
    // type keeps the unchanged flat 5-day limit. The exempt list and the
    // ceiling calculation both live in utils/leaveDays.js, so the client mirror
    // and the server read the same rule.
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

    // --- Phase 5.5 (Task 2): the dates must not already be accounted for -----
    // Attendance state, not the calendar, decides this. See
    // assertDatesAreRequestable above. Enforced in the service (not just the
    // form) so it holds for any caller of POST /leave/apply.
    await assertDatesAreRequestable(user, body.from, body.to)

    // Balance check (skip for unpaid types with no balance record).
    const balance = await LeaveBalance.findOne({ employee: user.name, type: body.type })
    if (balance && balance.balance < days) {
      throw new ApiError(422, `Insufficient balance: ${balance.balance} day(s) available, ${days} requested`)
    }

    const type = await LeaveType.findOne({ name: body.type })
    if (!type) throw new ApiError(422, `Unknown leave type: ${body.type}`)

    // --- Phase 5 (Task 2): the type must be visible to this employee ---------
    // The dropdown already filters, but filtering the UI is not access control.
    // Without this check a male employee could still apply for Maternity Leave
    // by posting the type name directly.
    if (!canSeeLeaveType(type, user)) {
      throw new ApiError(
        422,
        user?.gender
          ? `${type.name} is not available for your profile`
          : `${type.name} is restricted by gender. Ask HR to complete the gender on your profile before applying for this leave type.`,
      )
    }
    // A half-day only makes sense against a PAID allocation, since the whole
    // point is to deduct 0.5 from that balance.
    if (halfDay && type.paid === false) {
      throw new ApiError(422, 'Half-day leave is only available on paid leave types')
    }

    const sundaysExcluded = halfDay ? 0 : countSundays(body.from, body.to)
    const appliedNote = halfDay
      ? `Half-day (${halfDaySession}) leave request submitted`
      : sundaysExcluded > 0
        ? `Leave request submitted \u2014 ${sundaysExcluded} Sunday(s) excluded from the duration`
        : 'Leave request submitted'

    // Phase 5 (Task 6): stamp the deadline at creation time so the expiry
    // sweeper is a cheap comparison instead of a per-document recompute.
    const ctx = await loadShiftContext()
    const shifts = await employeeShiftMap([user.name])
    const expiresAt = buildExpiryInstant(
      body.from,
      resolveShiftStart(shifts.get(user.name) || user.shift, ctx),
    )

    const req = await LeaveRequest.create({
      employee: user.name, empCode: user.empCode, department: user.department,
      type: body.type, typeCode: type?.code, from: body.from, to: body.to, days,
      reason: body.reason, status: 'Pending',
      halfDay, halfDaySession, sundaysExcluded,
      expiresAt,
      workflow: [{ stage: 'Applied', by: user.name, note: appliedNote }],
    })
    notify('hr@skew.com', 'New leave request', `${user.name} applied for ${days} day(s) of ${body.type}`)
    return withId(req.toObject())
  },

  // --- Phase 5.5 (Task 4): hourly permission -------------------------------

  // How many permission hours are already committed in a calendar month.
  //
  // PENDING requests count against the allowance alongside APPROVED ones. If
  // they did not, an employee could stack six pending 0.5h requests and blow
  // straight through the 3h cap the moment they were all approved. Rejected,
  // Cancelled and Expired requests release their hours automatically, simply
  // by falling out of this query — no compensating write is needed.
  async hourlyUsage(employeeName, month) {
    const bounds = monthBounds(month)
    if (!bounds) return 0
    const rows = await LeaveRequest.find({
      employee: employeeName,
      requestKind: 'Hourly Permission',
      status: { $in: ['Pending', 'Approved'] },
      from: { $gte: bounds.start, $lte: bounds.end },
    }).select('hours').lean()
    return rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0)
  },

  // Balance view model for the apply form, the leave dashboard and reports.
  // Derived on read, so it resets on the 1st with no scheduled job and can
  // never carry forward or accumulate yearly.
  async hourlyBalance(user, month) {
    const key = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : monthKeyOf(new Date())
    const used = await this.hourlyUsage(user.name, key)
    const allowance = HOURLY_PERMISSION_MONTHLY_HOURS
    return {
      month: key,
      allowance,
      used: Number(used.toFixed(2)),
      remaining: Number(Math.max(0, allowance - used).toFixed(2)),
      stepHours: HOURLY_PERMISSION_STEP_HOURS,
    }
  },

  // Create an hourly permission request.
  //
  // Stored in the SAME LeaveRequest collection as ordinary leave, so from this
  // point on it flows through the existing pipeline untouched: the approvals
  // inbox lists it, decide() approves/rejects it with the mandatory comment,
  // the expiry sweeper ages it out, cancel() works, and reports pick it up.
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
    // Half-hour increments only. Compared via a scaled integer because
    // floating-point modulo on 0.5 is not reliably exact.
    if (Math.round(hours * 2) !== hours * 2) {
      throw new ApiError(422, `Hours must be in increments of ${HOURLY_PERMISSION_STEP_HOURS}`)
    }
    if (hours > HOURLY_PERMISSION_MONTHLY_HOURS) {
      throw new ApiError(
        422,
        `A single hourly permission cannot exceed the ${HOURLY_PERMISSION_MONTHLY_HOURS}h monthly allowance`,
      )
    }

    // Phase 5.5 (Task 2) applies identically here — the brief requires the
    // attendance rule to cover hourly permission too. Reusing the same helper
    // means there is exactly one implementation of that rule.
    await assertDatesAreRequestable(user, date, date)

    const month = monthKeyOf(date)
    const used = await this.hourlyUsage(user.name, month)
    const remaining = HOURLY_PERMISSION_MONTHLY_HOURS - used
    if (hours > remaining) {
      throw new ApiError(
        422,
        `Only ${Number(Math.max(0, remaining).toFixed(2))}h of your ${HOURLY_PERMISSION_MONTHLY_HOURS}h monthly permission allowance remains for ${month} (${Number(used.toFixed(2))}h already committed). You requested ${hours}h.`,
      )
    }

    // Same expiry stamping as ordinary leave, so the existing sweeper and
    // reminder milestones apply without a second code path.
    const ctx = await loadShiftContext()
    const shifts = await employeeShiftMap([user.name])
    const expiresAt = buildExpiryInstant(
      date,
      resolveShiftStart(shifts.get(user.name) || user.shift, ctx),
    )

    const req = await LeaveRequest.create({
      employee: user.name, empCode: user.empCode, department: user.department,
      type: 'Hourly Permission', typeCode: 'HP',
      requestKind: 'Hourly Permission',
      from: date, to: date,
      // An hourly permission costs no leave DAYS — it draws down the separate
      // monthly hour allowance instead.
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

    notify('hr@skew.com', 'New hourly permission request', `${user.name} requested ${hours}h of permission on ${date}`)
    return withId(req.toObject())
  },

  async decide(id, action, approver, note) {
    // Phase 4: the approver's comment is MANDATORY for both Approve and Reject.
    // Enforced here (the service layer) rather than only in the UI, so the rule
    // holds for every caller of the endpoint.
    const comment = typeof note === 'string' ? note.trim() : ''
    if (!comment) {
      throw new ApiError(422, 'A comment is required when approving or rejecting a leave request')
    }

    const req = await LeaveRequest.findById(id)
    if (!req) throw new ApiError(404, 'Leave request not found')
    // Phase 5 (Task 6): an expired request is terminal and gets a dedicated
    // message, because "Request already expired" reads like a bug to HR whereas
    // this explains WHY the buttons no longer work.
    if (req.status === 'Expired') {
      throw new ApiError(409, 'This request expired because it was not actioned before the shift start time on the first day of leave. It can no longer be approved or rejected.')
    }
    if (req.status !== 'Pending') throw new ApiError(409, `Request already ${req.status.toLowerCase()}`)

    const status = action === 'approve' ? 'Approved' : 'Rejected'

    // Deduct balance on approval (before persisting the decision).
    // req.days already excludes Sundays and is 0.5 for a half-day, so the
    // deduction stays correct for both new leave shapes with no extra maths.
    // Phase 5.5 (Task 4): an Hourly Permission draws down the derived monthly
    // HOUR allowance, never a LeaveBalance day bucket, so the day deduction is
    // skipped for it. Its allowance was enforced at apply time and is
    // recomputed from the requests themselves, so there is nothing to
    // decrement here.
    if (status === 'Approved' && req.requestKind !== 'Hourly Permission') {
      const balance = await LeaveBalance.findOne({ employee: req.employee, type: req.type })
      if (balance) {
        if (balance.balance < req.days) throw new ApiError(422, 'Insufficient balance to approve')
        balance.used += req.days
        balance.balance -= req.days
        await balance.save()
      }
    }

    const decidedAt = new Date()
    req.status = status
    req.approver = approver
    // Flat projection for history/details/reports...
    req.decision = { action: status, comment, by: approver, at: decidedAt }
    // ...plus the full append-only audit trail.
    req.workflow.push({ stage: status, by: approver, at: decidedAt, note: comment })
    await req.save()

    // Phase 5.2 (Bug #4): mirror the approval into Attendance immediately, so
    // attendance views/reports/payroll never read a stale status. Failure here
    // is logged but never blocks the approval itself.
    // Phase 5.5 (Task 4): deliberately NOT run for an hourly permission. An
    // employee stepping out for an hour is still PRESENT that day; stamping
    // the whole day 'On Leave' in Attendance would corrupt attendance reports
    // and payroll for a day that was actually worked.
    if (status === 'Approved' && req.requestKind !== 'Hourly Permission') {
      await syncAttendanceForApprovedLeave(req).catch((err) => {
        console.error('syncAttendanceForApprovedLeave failed:', err?.message)
      })
    }

    notify(req.employee, `Leave ${status}`, `Your ${req.type} request was ${status.toLowerCase()} by ${approver}`)

    // Phase 4 notifications: one PRIVATE document addressed to the requesting
    // employee only. Half-day decisions get their own wording as required.
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
    // Phase 5 (Task 6): expired requests cannot be cancelled either.
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
    return { id }
  },

  async balances(user) {
    // Balances are DERIVED, never seeded manually:
    //  - entitlement  = each ACTIVE LeaveType's allocated days (single source of truth)
    //  - used         = sum of the employee's APPROVED leave-request days for that type
    //  - remaining    = entitlement - used
    // A per-employee LeaveBalance row (if one exists) may override the allocation
    // only. This guarantees the dropdown/cards populate for EVERY role from real
    // MongoDB data and update automatically on approval/rejection.
    //
    // Phase 6.9 (TASK 4): `requested` is added alongside them - the sum of the
    // employee's PENDING (not yet decided) days for that type. It is derived
    // from the real LeaveRequest documents in exactly the same way `used` is
    // derived from the approved ones, so the card can never show a figure that
    // does not correspond to live requests. It is reported SEPARATELY from
    // `balance` on purpose: pending days are not yet deducted, and folding them
    // into the remaining balance would change the meaning of a field that
    // apply(), approve() and the reports already depend on.
    const [allTypes, decided, overrides] = await Promise.all([
      LeaveType.find({ active: { $ne: false } }).sort({ name: 1 }).lean(),
      // ONE query for both buckets instead of two round-trips.
      LeaveRequest.find({ employee: user.name, status: { $in: ['Approved', 'Pending'] } }).lean(),
      LeaveBalance.find({ employee: user.name }).lean(),
    ])
    const approved = decided.filter((r) => r.status === 'Approved')
    const pending = decided.filter((r) => r.status === 'Pending')
    // Phase 5 (Task 2): gender filter applied HERE, at the single source that
    // feeds both the balance cards and the Apply-Leave dropdown. Filtering in
    // one place is what keeps "dropdown, balances and reports follow the rule"
    // true without three separate implementations drifting apart.
    const types = allTypes.filter((t) => canSeeLeaveType(t, user, { forApply: true }))
    const usedByType = {}
    approved.forEach((r) => { usedByType[r.type] = (usedByType[r.type] || 0) + (r.days || 0) })
    // Phase 6.9 (TASK 4): pending days per type, from real Pending requests.
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
        // Phase 6.9 (TASK 4): days sitting in Pending requests for this type.
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
    // Sweep first so the Pending count on the dashboard never includes
    // requests that are actually past their deadline.
    await expireStaleRequests()
    const all = await LeaveRequest.find().lean()
    // Phase 5 (Task 6): 'Expired' is a first-class status in the breakdown.
    const byStatus = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Expired'].map((name) => ({ name, value: all.filter((r) => r.status === name).length }))

    const typeMap = {}
    all.forEach((r) => { const k = r.typeCode || r.type; typeMap[k] = (typeMap[k] || 0) + 1 })
    const byType = Object.entries(typeMap).map(([name, value]) => ({ name, value }))

    // Day-based department totals. Hourly permissions carry days: 0, so they
    // contribute nothing here by construction and cannot inflate day figures.
    const deptMap = {}
    all.filter((r) => r.status === 'Approved').forEach((r) => { deptMap[r.department] = (deptMap[r.department] || 0) + r.days })
    const byDepartment = Object.entries(deptMap).map(([name, value]) => ({ name, value }))

    // Phase 5.5 (Task 4): hourly permissions reported as their OWN aggregates
    // rather than being folded into the day totals — mixing hours into a
    // "days" figure would misstate both. `byType` above already lists them
    // under the 'HP' type code automatically.
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

    // Approved-vs-rejected trend over the last 6 months (keyed by request `from`).
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

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = await Holiday.find({ date: { $gte: today } }).sort({ date: 1 }).limit(4).lean()

    // Phase 5.7 (Task 6): "decided TODAY" counters for the Admin dashboard.
    //
    // These are derived from `decision.at` — the flat projection of the final
    // Approve/Reject decision — NOT from `updatedAt`, which changes on any
    // write (a reminder flag, an expiry sweep) and would therefore overcount.
    // Requests decided before the `decision` subdocument existed simply have
    // decision === null and are excluded rather than guessed at.
    const decidedOn = (row) => (row?.decision?.at
      ? new Date(row.decision.at).toISOString().slice(0, 10)
      : null)
    const todayApproved = all.filter((r) => r.status === 'Approved' && decidedOn(r) === today).length
    const todayRejected = all.filter((r) => r.status === 'Rejected' && decidedOn(r) === today).length

    // Leave that is actually ACTIVE today (approved and spanning today).
    const onLeaveToday = all.filter((r) => r.status === 'Approved' && r.from <= today && r.to >= today).length

    return {
      total: all.length,
      pending: all.filter((r) => r.status === 'Pending').length,
      approved: all.filter((r) => r.status === 'Approved').length,
      rejected: all.filter((r) => r.status === 'Rejected').length,
      expired: all.filter((r) => r.status === 'Expired').length,
      // Additive keys — existing consumers are unaffected.
      todayApproved, todayRejected, onLeaveToday, today,
      totalDaysApproved: all.filter((r) => r.status === 'Approved').reduce((s, r) => s + r.days, 0),
      byStatus, byType, byDepartment, monthlyTrend,
      // Phase 5.5 (Task 4): additive key — existing consumers that never read
      // it are unaffected.
      hourlyPermission,
      upcomingHolidays: withIds(upcoming),
    }
  },
}
