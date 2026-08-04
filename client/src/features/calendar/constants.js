// Calendar module constants: event categories, view modes, recurrence options.
import {
  FiUsers, FiCheckSquare, FiCalendar, FiFlag, FiGift, FiRepeat,
  FiStar, FiBookOpen, FiCheckCircle, FiClock, FiXCircle, FiBriefcase,
  FiPlayCircle, FiTarget, FiAward, FiClipboard, FiSunrise,
} from 'react-icons/fi'

// The event categories double as the "My Calendars" sidebar toggles.
// Phase 6.4 (TASK 7): extended additively with birthday/training/leave
// status/company-event so every distinct calendar concept has its own type
// and, below, its own colour. The original five keep their exact prior
// colours and behavior.
export const EVENT_TYPES = [
  'meeting', 'task', 'event', 'deadline', 'holiday',
  'birthday', 'training', 'leave-approved', 'leave-pending', 'leave-rejected',
  'company-event',
  // Phase 6.9 (Task 15): ProjectCalendar merged into this, the ONE calendar —
  // additive-only, same pattern as the Phase 6.4/6.5 categories above.
  'project-start', 'project-deadline', 'milestone', 'task-deadline', 'sunday',
]

export const TYPE_META = {
  meeting: {
    label: 'Meetings',
    singular: 'Meeting',
    tone: 'primary',
    color: '#2563EB',
    icon: FiUsers,
    dot: 'bg-primary',
    soft: 'bg-primary/10',
    text: 'text-primary',
    ring: 'ring-primary/40',
  },
  task: {
    label: 'Tasks',
    singular: 'Task',
    tone: 'accent',
    color: '#06B6D4',
    icon: FiCheckSquare,
    dot: 'bg-accent',
    soft: 'bg-accent/10',
    text: 'text-accent',
    ring: 'ring-accent/40',
  },
  event: {
    label: 'Events',
    singular: 'Event',
    tone: 'warning',
    color: '#F59E0B',
    icon: FiCalendar,
    dot: 'bg-warning',
    soft: 'bg-warning/10',
    text: 'text-warning',
    ring: 'ring-warning/40',
  },
  deadline: {
    label: 'Deadlines',
    singular: 'Deadline',
    tone: 'danger',
    color: '#EF4444',
    icon: FiFlag,
    dot: 'bg-danger',
    soft: 'bg-danger/10',
    text: 'text-danger',
    ring: 'ring-danger/40',
  },
  holiday: {
    label: 'Company Holidays',
    singular: 'Company Holiday',
    tone: 'success',
    color: '#10B981',
    icon: FiGift,
    dot: 'bg-success',
    soft: 'bg-success/10',
    text: 'text-success',
    ring: 'ring-success/40',
  },
  // --- Phase 6.4 (TASK 7): additional event categories, each with its own
  // distinct colour so none of them visually collide with the five above or
  // with each other. ---
  birthday: {
    label: 'Birthdays',
    singular: 'Birthday',
    tone: 'pink',
    color: '#EC4899',
    icon: FiStar,
    dot: 'bg-pink-500',
    soft: 'bg-pink-500/10',
    text: 'text-pink-500',
    ring: 'ring-pink-500/40',
  },
  training: {
    label: 'Training',
    singular: 'Training',
    tone: 'indigo',
    color: '#6366F1',
    icon: FiBookOpen,
    dot: 'bg-indigo-500',
    soft: 'bg-indigo-500/10',
    text: 'text-indigo-500',
    ring: 'ring-indigo-500/40',
  },
  'leave-approved': {
    label: 'Approved Leave',
    singular: 'Approved Leave',
    tone: 'success',
    color: '#22C55E',
    icon: FiCheckCircle,
    dot: 'bg-green-500',
    soft: 'bg-green-500/10',
    text: 'text-green-500',
    ring: 'ring-green-500/40',
  },
  'leave-pending': {
    label: 'Pending Leave',
    singular: 'Pending Leave',
    tone: 'warning',
    color: '#F97316',
    icon: FiClock,
    dot: 'bg-orange-500',
    soft: 'bg-orange-500/10',
    text: 'text-orange-500',
    ring: 'ring-orange-500/40',
  },
  'leave-rejected': {
    label: 'Rejected Leave',
    singular: 'Rejected Leave',
    tone: 'danger',
    color: '#DC2626',
    icon: FiXCircle,
    dot: 'bg-red-600',
    soft: 'bg-red-600/10',
    text: 'text-red-600',
    ring: 'ring-red-600/40',
  },
  'company-event': {
    label: 'Company Events',
    singular: 'Company Event',
    tone: 'accent',
    color: '#0EA5E9',
    icon: FiBriefcase,
    dot: 'bg-sky-500',
    soft: 'bg-sky-500/10',
    text: 'text-sky-500',
    ring: 'ring-sky-500/40',
  },
  // --- Phase 6.9 (Task 15): ProjectCalendar merge categories. Each gets its
  // own distinct colour, same convention as every category above. ---
  'project-start': {
    label: 'Project Start Dates',
    singular: 'Project Start',
    tone: 'teal',
    color: '#14B8A6',
    icon: FiPlayCircle,
    dot: 'bg-teal-500',
    soft: 'bg-teal-500/10',
    text: 'text-teal-500',
    ring: 'ring-teal-500/40',
  },
  'project-deadline': {
    label: 'Project Deadlines',
    singular: 'Project Deadline',
    tone: 'rose',
    color: '#BE123C',
    icon: FiTarget,
    dot: 'bg-rose-700',
    soft: 'bg-rose-700/10',
    text: 'text-rose-700',
    ring: 'ring-rose-700/40',
  },
  milestone: {
    label: 'Milestones',
    singular: 'Milestone',
    tone: 'violet',
    color: '#7C3AED',
    icon: FiAward,
    dot: 'bg-violet-600',
    soft: 'bg-violet-600/10',
    text: 'text-violet-600',
    ring: 'ring-violet-600/40',
  },
  'task-deadline': {
    label: 'Task Deadlines',
    singular: 'Task Deadline',
    tone: 'amber',
    color: '#CA8A04',
    icon: FiClipboard,
    dot: 'bg-amber-600',
    soft: 'bg-amber-600/10',
    text: 'text-amber-600',
    ring: 'ring-amber-600/40',
  },
  sunday: {
    label: 'Sundays',
    singular: 'Sunday',
    tone: 'slate',
    color: '#94A3B8',
    icon: FiSunrise,
    dot: 'bg-slate-400',
    soft: 'bg-slate-400/10',
    text: 'text-slate-400',
    ring: 'ring-slate-400/40',
  },
}

// Phase 6.9 (Task 17): meeting-request lifecycle badge metadata, shared by
// the internal Calendar (EventChip/AgendaView/EventModal) and the Client
// Portal (ClientMeetings.jsx) - ONE badge vocabulary for both surfaces.
export const MEETING_STATUS_META = {
  Pending: {
    label: 'Pending',
    tone: 'warning',
    color: '#F59E0B',
    icon: FiClock,
    dot: 'bg-warning',
    soft: 'bg-warning/10',
    text: 'text-warning',
  },
  Approved: {
    label: 'Approved',
    tone: 'success',
    color: '#16A34A',
    icon: FiCheckCircle,
    dot: 'bg-success',
    soft: 'bg-success/10',
    text: 'text-success',
  },
  Cancelled: {
    label: 'Cancelled',
    // Badge only supports default/primary/success/warning/danger/accent -
    // 'slate' is not one of its tones (unlike TYPE_META.sunday above, which
    // doesn't feed into Badge), so this uses 'default' instead.
    tone: 'default',
    color: '#94A3B8',
    icon: FiXCircle,
    dot: 'bg-slate-400',
    soft: 'bg-slate-400/10',
    text: 'text-slate-400',
  },
  Rejected: {
    label: 'Rejected',
    tone: 'danger',
    color: '#EF4444',
    icon: FiXCircle,
    dot: 'bg-danger',
    soft: 'bg-danger/10',
    text: 'text-danger',
  },
}

// Phase 6.9 (Task 17): a client meeting (o.clientId set, o.meetingStatus set)
// swaps its normal 'meeting' TYPE_META colour/icon for a status-driven one, so
// Pending/Approved/Cancelled/Rejected is visible at a glance on the Calendar
// grid - without introducing a second, parallel event-type system.
export function getEventMeta(o) {
  if (o?.type === 'meeting' && o?.clientId && o?.meetingStatus && MEETING_STATUS_META[o.meetingStatus]) {
    return { ...TYPE_META.meeting, ...MEETING_STATUS_META[o.meetingStatus] }
  }
  return TYPE_META[o?.type] || TYPE_META.event
}

export const VIEW = { MONTH: 'month', WEEK: 'week', DAY: 'day', AGENDA: 'agenda' }

export const VIEW_LIST = [
  { value: VIEW.MONTH, label: 'Month' },
  { value: VIEW.WEEK, label: 'Week' },
  { value: VIEW.DAY, label: 'Day' },
  { value: VIEW.AGENDA, label: 'Agenda' },
]

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LABELS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Recurrence frequency options for the event editor.
export const RECURRENCE_FREQ = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

export const RepeatIcon = FiRepeat

// Height (px) of one hour row in the week/day time grids.
export const HOUR_HEIGHT = 56
export const DAY_START_HOUR = 0
export const DAY_END_HOUR = 24

// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 6) - default meeting length
// ---------------------------------------------------------------------------
// CalendarEvent.end is `required: true` in server/src/models/calendarModels.js.
// The client portal's own request handler (clientController.createMeetingRequest)
// already derives the end as start + 1 hour. That figure was an inline literal
// there and did not exist at all on the internal side, which is what allowed
// the lead's request form to post a meeting with no `end`. It is declared once
// here so both request surfaces agree on the same default instead of each
// carrying their own number.
export const MEETING_DEFAULT_DURATION_MINUTES = 60

// Derive the end instant for a meeting whose start the user picked. Returns ''
// for an unparseable start so callers can fail validation rather than post an
// Invalid Date.
export const addMinutes = (value, minutes) => {
  const d = value ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString()
}
