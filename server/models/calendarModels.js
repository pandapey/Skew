import mongoose from 'mongoose'

// Recurrence descriptor — a single master event expands into many occurrences
// client-side. `freq` of 'none' means a one-off event.
const recurrenceSchema = new mongoose.Schema(
  {
    freq: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
      default: 'none',
    },
    interval: { type: Number, default: 1, min: 1 },
    // 0=Sun … 6=Sat — used when freq === 'weekly'
    byWeekday: { type: [Number], default: [] },
    until: { type: Date, default: null },
    count: { type: Number, default: null },
  },
  { _id: false }
)

const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true },
    // Phase 6.4 (TASK 7): additive event categories so every distinct
    // calendar concept (birthday, training, leave status, company-wide
    // event) can be colour-coded on its own instead of overloading 'event'.
    // Existing 5 values and default are unchanged.
    type: {
      type: String,
      enum: [
        'meeting', 'task', 'event', 'deadline', 'holiday',
        'birthday', 'training', 'leave-approved', 'leave-pending', 'leave-rejected',
        'company-event',
        // Phase 6.9 (Task 15): additive extension, same pattern as the Phase
        // 6.4 categories above. EventModal's "New Event" type dropdown lists
        // every TYPE_META entry, so any type added there (e.g. the ProjectCalendar
        // merge categories) must also be a valid enum value here or manual
        // creation of that type would fail schema validation.
        'project-start', 'project-deadline', 'milestone', 'task-deadline', 'sunday',
      ],
      default: 'event',
      index: true,
    },
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    location: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    attendees: { type: [String], default: [] },
    // Phase 6.9 (Task 17): client-meeting fields, added directly on the real
    // CalendarEvent model instead of a third, disconnected ClientMeeting
    // table. clientId/projectId are nullable so every existing non-meeting
    // event (and internally-created meetings with no client) is unaffected.
    clientId: { type: String, default: null, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    // Approval workflow for a client's meeting request. null = not a client
    // meeting request (ordinary internal meeting/event).
    meetingStatus: { type: String, enum: ['Pending', 'Approved', 'Cancelled', 'Rejected'], default: null },
    // Phase 6.17 (TASK 3) ROOT CAUSE FIX: which side RAISED this meeting
    // request, so the response-authorization rule can point the other way.
    // A meeting the Client raised ('client') is answered by staff (unchanged,
    // pre-6.17 behaviour). A meeting STAFF raised ('staff') is a request TO
    // the Client, so only the Client may Accept/Reject/Reschedule it. Additive
    // and nullable, same pattern as clientId/projectId/meetingStatus above -
    // legacy rows (null) keep exactly their pre-6.17 behaviour (staff-only
    // management), so this never changes any existing meeting's authorization.
    requestedBy: { type: String, enum: ['client', 'staff'], default: null },
    // Phase 6.11 (TASK 5): idempotency marker for the 1-hour-before meeting
    // reminder. The reminder sweep runs on the EXISTING scheduler tick, so it
    // will look at the same upcoming meeting on several consecutive ticks;
    // stamping the event once it has been reminded is what stops the client
    // receiving a duplicate notification every cycle. Nullable and defaulted,
    // so every CalendarEvent already in the database stays valid and unchanged.
    reminderSentAt: { type: Date, default: null },
    recurrence: { type: recurrenceSchema, default: () => ({}) },
    // Completion flag for task-type events.
    done: { type: Boolean, default: false },
    createdBy: { type: String, default: null },
  },
  { timestamps: true }
)

calendarEventSchema.index({ start: 1, end: 1 })

export const CalendarEvent = mongoose.model('CalendarEvent', calendarEventSchema)
