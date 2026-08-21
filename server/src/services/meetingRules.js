// =============================================================================
// Shared meeting scheduling rules.
//
// Phase 6.21 (TASK 2): these two helpers were previously PRIVATE to
// clientController.js, so the Sunday / Company-Holiday rule was only ever
// applied to meetings raised from the CLIENT portal. Now that a Project Lead
// can raise a meeting from the internal side, the same rule has to apply
// there too. They are MOVED here (not copied) and imported by both
// controllers, so there is exactly one definition of "is this slot bookable".
// =============================================================================
import { Holiday } from '../models/attendanceModels.js'

// The calendar day is taken from the LEADING 10 CHARACTERS of the submitted
// string rather than from `new Date(...).toISOString()`. The UI sends a
// datetime-local value ('2026-08-02T10:00') which carries no timezone, so
// converting to UTC would shift the day across midnight for any server not on
// UTC and could reject (or accept) the wrong date. Holiday.date is stored in
// exactly this 'YYYY-MM-DD' form, so the keys compare directly.
export const meetingDayKey = (start) => {
  const raw = String(start || '')
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : ''
}

// Returns a human-readable reason the slot is not bookable, or '' if it is.
// Enforced by the SERVER so the rule cannot be bypassed by posting straight to
// the API with the UI validation skipped.
export const meetingDateRejection = async (start) => {
  const key = meetingDayKey(start)
  if (!key) return ''
  // Parsed at local midnight (not `new Date(key)`, which ISO-parses as UTC and
  // can report the previous day west of Greenwich).
  if (new Date(`${key}T00:00:00`).getDay() === 0) return 'Meetings cannot be scheduled on a Sunday.'
  const holiday = await Holiday.findOne({ date: key }).select('name').lean()
  if (holiday) return `Meetings cannot be scheduled on a company holiday (${holiday.name}).`
  return ''
}

// The existing default meeting length, mirroring the client-side
// MEETING_DEFAULT_DURATION_MINUTES (client/src/features/calendar/constants.js)
// and the 60-minute window clientController.createMeetingRequest already used.
export const MEETING_DEFAULT_DURATION_MINUTES = 60

// Derives the required CalendarEvent.end from a start when the caller does not
// supply one (the Request Meeting form no longer asks for it).
export const deriveMeetingEnd = (start) => {
  const s = new Date(start)
  if (Number.isNaN(s.getTime())) return null
  return new Date(s.getTime() + MEETING_DEFAULT_DURATION_MINUTES * 60 * 1000)
}
