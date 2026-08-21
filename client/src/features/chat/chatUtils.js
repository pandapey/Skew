// Shared chat display helpers + react-query key constants. Everything here is
// presentation-only; data always comes from the chat API (server-verified
// participant/membership checks), never recomputed client-side.
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

// Query keys used by the chat screens (kept in sync with useRealtimeSync.jsx).
export const QK = {
  users: ['chat-users'],
  conversations: ['chat-conversations'],
  conversation: (id) => ['chat-conversation', id],
  messages: (id) => ['chat-messages', id],
}

// "12:04 PM" for today's messages, otherwise "12 Apr".
export function messageTime(iso) {
  if (!iso) return ''
  const d = dayjs(iso)
  if (!d.isValid()) return ''
  return d.isSame(dayjs(), 'day') ? d.format('hh:mm A') : d.format('DD MMM, hh:mm A')
}

// "12:04 PM" compact variant for the conversation list.
export function listTime(iso) {
  if (!iso) return ''
  const d = dayjs(iso)
  if (!d.isValid()) return ''
  return d.isSame(dayjs(), 'day') ? d.format('hh:mm A') : d.format('DD MMM')
}

// Direct-conversation display participant: `conversation.other` is set by the
// server for direct chats.
export const directPeer = (conversation) => (conversation?.isGroup ? null : conversation?.other || null)

// Human-readable file size ("1.2 MB", "340 KB"…).
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const value = n / 1024 ** i
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}