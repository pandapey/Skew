// Phase 5 (Tasks 6 + 7) — background leave maintenance.
//
// Two jobs share one timer because they read the same working set (every
// Pending leave request) and depend on the same deadline maths:
//
//   1. expireStaleRequests()  — Task 6. Owned by leaveService, imported here.
//   2. sendPendingReminders() — Task 7. Defined below.
//
// Order matters: expire FIRST, then remind. Reminding first would emit a
// "2 hours left" nudge for a request that is about to be expired in the same
// tick, which is exactly the kind of contradictory noise that makes people
// mute notifications.

import { LeaveRequest } from '../models/leaveModels.js'
import { User } from '../models/User.js'
import { Project } from '../models/projectModels.js'
import { expireStaleRequests } from './leaveService.js'
import { notifyUsersByEmail } from './notificationService.js'
// Phase 6.11 (TASK 5): client meeting reminders share this ONE timer instead of
// starting a scheduler of their own. Same reasoning as the two leave jobs above
// - one interval, started and stopped in one place (server.js).
import { sendMeetingReminders } from './meetingReminderService.js'
import {
  REMINDER_MILESTONES, loadShiftContext, resolveShiftStart, buildExpiryInstant,
} from '../utils/leaveExpiry.js'
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

// Roles that approve leave, and therefore receive the reminders. Mirrors the
// `canApprove` guard on the leave routes so the people who are nagged are
// exactly the people who can actually act.
const APPROVER_ROLES = ['Admin', 'Manager']

const MS_PER_HOUR = 3600 * 1000

// How often the timer fires. Configurable so ops can tune it without a code
// change; 15 minutes is granular enough for a 2-hour milestone while staying
// cheap. Never allow 0/NaN, which would busy-loop the process.
const intervalMs = () => {
  const mins = Number(process.env.LEAVE_SCHEDULER_INTERVAL_MINUTES)
  return (Number.isFinite(mins) && mins > 0 ? mins : 15) * 60 * 1000
}

// Resolve the leads of every project the employee is a member of, so the
// person whose delivery plan is affected is told their teammate may be out.
// "if applicable" in the brief = an employee on no project has no lead, and we
// simply skip that recipient rather than inventing one.
async function projectLeadsFor(employeeNames) {
  const unique = [...new Set((employeeNames || []).filter(Boolean))]
  if (!unique.length) return new Map()
  const projects = await Project.find({ 'members.name': { $in: unique } })
    .select('lead members.name')
    .lean()
  const byEmployee = new Map()
  projects.forEach((p) => {
    if (!p.lead) return
    p.members.forEach((m) => {
      if (!unique.includes(m.name)) return
      // An employee can sit on several projects, so this is a set of leads.
      const set = byEmployee.get(m.name) || new Set()
      set.add(p.lead)
      byEmployee.set(m.name, set)
    })
  })
  return byEmployee
}

// Emit reminder notifications for pending leave requests approaching their
// shift-start deadline.
//
// DUPLICATE SUPPRESSION (the brief's "each user receives only one
// notification"):
//   a) Per request+milestone — the milestone key is written to
//      `remindersSent` in the SAME update, so a restarted or overlapping run
//      cannot re-send it.
//   b) Per person — all recipients (approvers + project leads) are unioned
//      into ONE email set before a single notifyUsersByEmail call, so someone
//      who is both an HR user and a project lead still gets exactly one
//      document.
//   c) Only the MOST URGENT crossed milestone fires per run, so a request that
//      has blown through 24h and 12h during downtime produces one "12 hours"
//      reminder, not two.
//
// Returns the number of requests that produced a reminder.
export async function sendPendingReminders() {
  const pending = await LeaveRequest.find({ status: 'Pending' })
    .select('_id employee type from to days halfDay halfDaySession expiresAt remindersSent')
    .lean()
  if (!pending.length) return 0

  // Recipients are the same for every request, so resolve them once.
  const approvers = await User.find({ role: { $in: APPROVER_ROLES }, status: 'Active' })
    .select('email')
    .lean()
  const approverEmails = approvers.map((u) => u.email).filter(Boolean)

  const ctx = await loadShiftContext()
  const { Employee } = await import('../models/Employee.js')
  const employees = await Employee.find({ name: { $in: pending.map((r) => r.employee) } })
    .select('name shift')
    .lean()
  const shiftByName = new Map(employees.map((e) => [e.name, e.shift]))
  const leadsByEmployee = await projectLeadsFor(pending.map((r) => r.employee))

  // Resolve every possible lead name to an email in one query.
  const allLeadNames = [...new Set([...leadsByEmployee.values()].flatMap((s) => [...s]))]
  const leadUsers = allLeadNames.length
    ? await User.find({ name: { $in: allLeadNames }, role: { $ne: 'Client' } }).select('name email').lean()
    : []
  const leadEmailByName = new Map(leadUsers.map((u) => [u.name, u.email]))

  const now = Date.now()
  let sent = 0

  for (const req of pending) {
    const deadline = req.expiresAt
      ? new Date(req.expiresAt)
      : buildExpiryInstant(req.from, resolveShiftStart(shiftByName.get(req.employee), ctx))
    if (!deadline) continue

    const hoursLeft = (deadline.getTime() - now) / MS_PER_HOUR
    if (hoursLeft <= 0) continue // already due; the expiry sweep owns this one

    const already = new Set(req.remindersSent || [])
    // (c) most urgent crossed milestone only.
    const due = REMINDER_MILESTONES
      .filter((m) => hoursLeft <= m.hours && !already.has(m.key))
      .sort((a, b) => a.hours - b.hours)[0]
    if (!due) continue

    // (b) union approvers + this employee's project leads into one set.
    const leadEmails = [...(leadsByEmployee.get(req.employee) || [])]
      .map((name) => leadEmailByName.get(name))
      .filter(Boolean)
    const recipients = [...new Set([...approverEmails, ...leadEmails])]
    if (!recipients.length) continue

    const span = req.halfDay
      ? `${req.halfDaySession} on ${req.from}`
      : req.from === req.to ? req.from : `${req.from} \u2192 ${req.to}`

    // (a) claim the milestone FIRST. If the write fails we skip the send, which
    // is the safe failure direction: a missed reminder beats a duplicate storm.
    const claim = await LeaveRequest.updateOne(
      { _id: req._id, status: 'Pending', remindersSent: { $ne: due.key } },
      { $addToSet: { remindersSent: due.key } },
    )
    if (!claim.modifiedCount) continue

    await notifyUsersByEmail(recipients, {
      type: 'leave',
      title: `Leave approval reminder \u2014 ${due.label} left`,
      body: `${req.employee}'s ${req.type} request (${span}, ${req.days} day(s)) is still pending and will expire at the shift start time on ${req.from}.`,
      sender: 'System',
      link: `/leave?request=${req._id}`,
      // The final call before expiry is the one that actually needs to cut
      // through, so only that one escalates.
      priority: due.key === '2h' ? 'high' : 'normal',
    })
    sent += 1
  }

  return sent
}

// One tick: expire, then remind. Never throws — a scheduler that crashes the
// API process on a transient database blip would be far worse than a skipped
// cycle, so failures are logged and the timer keeps running.
export async function runLeaveMaintenance() {
  try {
    const expired = await expireStaleRequests()
    const reminded = await sendPendingReminders()
    // Phase 6.11 (TASK 5): client meeting reminders ride on THIS existing tick
    // rather than on a scheduler of their own - see meetingReminderService.js.
    // Wrapped separately so a failure in the meeting sweep can never stop the
    // leave sweeps that this scheduler exists for, and vice versa.
    let meetingReminders = 0
    try {
      meetingReminders = await sendMeetingReminders()
    } catch (err) {
      console.error('[meeting-reminders] cycle failed:', err?.message)
    }
    if (expired || reminded || meetingReminders) {
      systemLog('INFO', `[leave-scheduler] expired=${expired} reminders=${reminded} meetingReminders=${meetingReminders}`, SYSTEM_LOG_SOURCES.CRON)
    }
    return { expired, reminded, meetingReminders }
  } catch (err) {
    systemLog('ERROR', `[leave-scheduler] cycle failed: ${err?.message}`, SYSTEM_LOG_SOURCES.CRON)
    return { expired: 0, reminded: 0, meetingReminders: 0, error: err?.message }
  }
}

let timer = null

// Start the recurring job. Idempotent, and `unref()`d so the timer never holds
// the process open during tests or a graceful shutdown.
export function startLeaveScheduler() {
  if (timer) return timer
  runLeaveMaintenance() // run once at boot to clear any backlog from downtime
  timer = setInterval(runLeaveMaintenance, intervalMs())
  if (typeof timer.unref === 'function') timer.unref()
  systemLog('INFO', `[leave-scheduler] started (every ${intervalMs() / 60000} min)`, SYSTEM_LOG_SOURCES.CRON)
  return timer
}

export function stopLeaveScheduler() {
  if (timer) { clearInterval(timer); timer = null }
}
