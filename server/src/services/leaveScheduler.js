import { LeaveRequest } from '../models/leaveModels.js'
import { User } from '../models/User.js'
import { Project } from '../models/projectModels.js'
import { expireStaleRequests } from './leaveService.js'
import { notifyUsersByEmail } from './notificationService.js'
import { sendMeetingReminders } from './meetingReminderService.js'
import {
  REMINDER_MILESTONES, buildExpiryInstant,
} from '../utils/leaveExpiry.js'
import { systemLog, SYSTEM_LOG_SOURCES } from '../utils/systemLog.js'

const APPROVER_ROLES = ['Admin', 'Manager']

const MS_PER_HOUR = 3600 * 1000

const intervalMs = () => {
  const mins = Number(process.env.LEAVE_SCHEDULER_INTERVAL_MINUTES)
  return (Number.isFinite(mins) && mins > 0 ? mins : 15) * 60 * 1000
}

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
      const set = byEmployee.get(m.name) || new Set()
      set.add(p.lead)
      byEmployee.set(m.name, set)
    })
  })
  return byEmployee
}

export async function sendPendingReminders() {
  const pending = await LeaveRequest.find({ status: 'Pending' })
    .select('_id employee type from to days halfDay halfDaySession expiresAt remindersSent')
    .lean()
  if (!pending.length) return 0

  const approvers = await User.find({ role: { $in: APPROVER_ROLES }, status: 'Active' })
    .select('email')
    .lean()
  const approverEmails = approvers.map((u) => u.email).filter(Boolean)

  const leadsByEmployee = await projectLeadsFor(pending.map((r) => r.employee))

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
      : buildExpiryInstant(req.to || req.from)
    if (!deadline) continue

    const hoursLeft = (deadline.getTime() - now) / MS_PER_HOUR
    if (hoursLeft <= 0) continue

    const already = new Set(req.remindersSent || [])

    const due = REMINDER_MILESTONES
      .filter((m) => hoursLeft <= m.hours && !already.has(m.key))
      .sort((a, b) => a.hours - b.hours)[0]
    if (!due) continue

    const leadEmails = [...(leadsByEmployee.get(req.employee) || [])]
      .map((name) => leadEmailByName.get(name))
      .filter(Boolean)
    const recipients = [...new Set([...approverEmails, ...leadEmails])]
    if (!recipients.length) continue

    const span = req.halfDay
      ? `${req.halfDaySession} on ${req.from}`
      : req.from === req.to ? req.from : `${req.from} \u2192 ${req.to}`

    const claim = await LeaveRequest.updateOne(
      { _id: req._id, status: 'Pending', remindersSent: { $ne: due.key } },
      { $addToSet: { remindersSent: due.key } },
    )
    if (!claim.modifiedCount) continue

    await notifyUsersByEmail(recipients, {
      type: 'leave',
      title: `Leave approval reminder \u2014 ${due.label} left`,
      body: `${req.employee}'s ${req.type} request (${span}, ${req.days} day(s)) is still pending and will expire at month end.`,
      sender: 'System',
      link: `/leave?request=${req._id}`,
      priority: due.key === '2h' ? 'high' : 'normal',
    })
    sent += 1
  }

  return sent
}

export async function runLeaveMaintenance() {
  try {
    const expired = await expireStaleRequests()
    const reminded = await sendPendingReminders()
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

export function startLeaveScheduler() {
  if (timer) return timer
  runLeaveMaintenance()
  timer = setInterval(runLeaveMaintenance, intervalMs())
  if (typeof timer.unref === 'function') timer.unref()
  systemLog('INFO', `[leave-scheduler] started (every ${intervalMs() / 60000} min)`, SYSTEM_LOG_SOURCES.CRON)
  return timer
}

export function stopLeaveScheduler() {
  if (timer) { clearInterval(timer); timer = null }
}
