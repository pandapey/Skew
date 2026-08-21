import {
  FiCheckSquare, FiCalendar, FiClock, FiTrello, FiUsers, FiMessageSquare, FiZap,
  FiShield,
} from 'react-icons/fi'

// Notification categories. `announcement` doubles as the company-wide broadcast.
export const NOTIF_TYPES = [
  { key: 'task', label: 'Tasks', icon: FiCheckSquare, tone: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  { key: 'leave', label: 'Leaves', icon: FiCalendar, tone: 'bg-success/10 text-success', dot: 'bg-success' },
  { key: 'attendance', label: 'Attendance', icon: FiClock, tone: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  { key: 'meeting', label: 'Meetings', icon: FiUsers, tone: 'bg-danger/10 text-danger', dot: 'bg-danger' },
  { key: 'project', label: 'Projects', icon: FiTrello, tone: 'bg-accent/10 text-accent', dot: 'bg-accent' },
  { key: 'announcement', label: 'Announcements', icon: FiMessageSquare, tone: 'bg-primary/10 text-primary', dot: 'bg-primary' },
  { key: 'admin', label: 'Admin', icon: FiShield, tone: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  { key: 'chat', label: 'Chat', icon: FiMessageSquare, tone: 'bg-accent/10 text-accent', dot: 'bg-accent' },
]

export const NOTIF_META = Object.fromEntries(NOTIF_TYPES.map((t) => [t.key, t]))
export const NOTIF_ICON = Object.fromEntries(NOTIF_TYPES.map((t) => [t.key, t.icon]))
export const NOTIF_TONE = Object.fromEntries(NOTIF_TYPES.map((t) => [t.key, t.tone]))
export const NOTIF_LABEL = Object.fromEntries(NOTIF_TYPES.map((t) => [t.key, t.label]))

// Per-category preference toggles.
export const DEFAULT_SETTINGS = {
  task: true,
  leave: true,
  attendance: true,
  meeting: true,
  project: true,
  announcement: true,
  admin: true, // user created / reset / status / role changes
  chat: true, // new chat messages from the internal messaging center
  push: true, // master in-app push toggle
  emailDigest: false, // daily email digest
}

export const SETTINGS_META = [
  { key: 'task', label: 'Task assignments', desc: 'When a task is assigned or updated' },
  { key: 'leave', label: 'Leave updates', desc: 'Approvals, rejections and reminders' },
  { key: 'attendance', label: 'Attendance', desc: 'Check-in reminders and anomalies' },
  { key: 'meeting', label: 'Meeting reminders', desc: 'Upcoming meetings and invites' },
  { key: 'project', label: 'Project deadlines', desc: 'Deadline and milestone alerts' },
  { key: 'announcement', label: 'Announcements', desc: 'Company-wide announcements' },
  { key: 'admin', label: 'Admin events', desc: 'User creation, resets, role & status changes' },
  { key: 'chat', label: 'Chat messages', desc: 'New messages in the internal chat' },
]

// Compact relative time from an ISO string.
export function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, Date.now() - then)
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  return `${w}w ago`
}

export { FiZap }
