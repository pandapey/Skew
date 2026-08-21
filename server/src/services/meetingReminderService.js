// =============================================================================
// Phase 6.11 (TASK 5) — meeting reminder sweep.
//
// NO NEW SCHEDULER. This file contains no timer, no setInterval and no cron: it
// exports one function that the EXISTING leave scheduler tick calls, alongside
// the leave expiry/reminder sweeps it already runs (services/leaveScheduler.js,
// started once from server.js). Adding a second timer would have meant a second
// thing to start, stop and unref on shutdown; instead there is still exactly one
// interval in the process.
//
// NO NEW NOTIFICATION SYSTEM either. The reminder is written to the SAME
// ClientNotification collection every other portal notification uses (invoice
// raised, payment recorded, document delivered) and pushed over the SAME
// 'client:notification' socket event, so it lands in the existing bell dropdown
// and the existing Notifications page with the existing icon/route mapping
// ('meeting' -> /client/meetings) and no client-side change at all.
//
// HONEST TIMING NOTE - PLEASE READ:
// The brief asks for a notification "exactly 1 hour before" the meeting. A
// polled sweep cannot be exact to the second, and claiming otherwise would be
// dishonest. What is implemented is: on each tick, any meeting starting within
// the next 60 minutes that has not already been reminded is reminded now. With
// the scheduler's default 15-minute interval
// (LEAVE_SCHEDULER_INTERVAL_MINUTES), the reminder therefore fires between 60
// and 45 minutes before the meeting starts - at most one tick late, never
// early, and never twice. Lowering LEAVE_SCHEDULER_INTERVAL_MINUTES tightens
// that window (e.g. 1 => within a minute of the hour mark) without any code
// change. This is a deliberate, documented trade-off, not an oversight.
// =============================================================================

import { CalendarEvent } from '../models/calendarModels.js'
import { ClientNotification } from '../models/clientModels.js'
import { emitToClient } from '../realtime/index.js'

const ONE_HOUR_MS = 60 * 60 * 1000

// Format the start time for the notification body in a stable, readable way.
// Kept deliberately simple - no locale/timezone guessing on the server.
const formatStart = (start) => {
  try {
    return new Date(start).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return new Date(start).toISOString()
  }
}

// Remind clients about meetings starting within the next hour.
// Returns the number of reminders actually sent.
export async function sendMeetingReminders() {
  const now = new Date()
  const horizon = new Date(now.getTime() + ONE_HOUR_MS)

  const due = await CalendarEvent.find({
    type: 'meeting',
    // Portal reminders only - internal events with no client attached are not
    // this function's business and are left entirely alone.
    clientId: { $ne: null },
    start: { $gt: now, $lte: horizon },
    reminderSentAt: null,
    // A meeting the client cancelled, or staff rejected, must not be announced.
    // Pending is included: an unapproved request still occupies the slot the
    // client asked for, and going silent on it would be worse than reminding.
    meetingStatus: { $nin: ['Cancelled', 'Rejected'] },
  })
    .select('_id title start clientId location')
    .lean()

  let sent = 0

  for (const ev of due) {
    // Claim the event BEFORE notifying, conditional on it still being unclaimed.
    // If two API instances run the sweep on the same tick, only one update can
    // match `reminderSentAt: null`, so only one reminder is ever created.
    const claim = await CalendarEvent.updateOne(
      { _id: ev._id, reminderSentAt: null },
      { $set: { reminderSentAt: new Date() } }
    )
    if (!(claim?.modifiedCount > 0)) continue

    try {
      const doc = await ClientNotification.create({
        clientId: ev.clientId,
        title: `Meeting in 1 hour: ${ev.title}`,
        body: `Starts at ${formatStart(ev.start)}${ev.location ? ` · ${ev.location}` : ''}.`,
        // Existing icon key - maps to the calendar icon and routes the click to
        // /client/meetings through NOTIFICATION_ROUTES on the frontend.
        icon: 'meeting',
        read: false,
      })
      // Same targeted push every other client-portal write uses, so an open
      // portal updates its badge without a refresh.
      emitToClient(ev.clientId, 'client:notification', { action: 'created', id: String(doc._id) })
      sent += 1
    } catch (err) {
      // Notification failed after the claim: release it so the next tick can
      // retry rather than silently swallowing the reminder.
      await CalendarEvent.updateOne({ _id: ev._id }, { $set: { reminderSentAt: null } }).catch(() => {})
      console.error('[meeting-reminders] failed for event', String(ev._id), err?.message)
    }
  }

  return sent
}
