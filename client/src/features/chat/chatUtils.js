import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export const QK = {
  users: ['chat-users'],
  conversations: ['chat-conversations'],
  conversation: (id) => ['chat-conversation', id],
  messages: (id) => ['chat-messages', id],
  presence: (ids) => ['chat-presence', ids?.join?.(',') || ''],
  starred: (id) => ['chat-starred', id],
  media: (id) => ['chat-media', id],
}

export function messageTime(iso) {
  if (!iso) return ''
  const d = dayjs(iso)
  if (!d.isValid()) return ''
  return d.isSame(dayjs(), 'day') ? d.format('hh:mm A') : d.format('DD MMM, hh:mm A')
}

export function listTime(iso) {
  if (!iso) return ''
  const d = dayjs(iso)
  if (!d.isValid()) return ''
  return d.isSame(dayjs(), 'day') ? d.format('hh:mm A') : d.format('DD MMM')
}

export function lastSeenText(iso) {
  if (!iso) return 'offline'
  const d = dayjs(iso)
  if (!d.isValid()) return 'offline'
  if (d.isSame(dayjs(), 'day')) return `last seen today at ${d.format('hh:mm A')}`
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return `last seen yesterday at ${d.format('hh:mm A')}`
  return `last seen ${d.format('DD MMM, hh:mm A')}`
}

export const directPeer = (conversation) => (conversation?.isGroup ? null : conversation?.other || null)

export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const value = n / 1024 ** i
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function tickStatus(message, meId, participantCount = 1) {
  if (String(message.sender) !== String(meId)) return null
  if (message.isDeletedForEveryone || message.isDeleted) return null
  const readBy = (message.readBy || []).length
  const deliveredTo = (message.deliveredTo || []).length
  const needed = Math.max(1, participantCount - 1)
  if (readBy >= needed) return 'read'
  if (deliveredTo >= Math.min(needed, 1) || deliveredTo > 0) return 'delivered'
  return 'sent'
}

export function groupedReactions(reactions = []) {
  const map = {}
  reactions.forEach((r) => { map[r.emoji] = (map[r.emoji] || 0) + 1 })
  return Object.entries(map).map(([emoji, count]) => ({ emoji, count }))
}

export const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '🙏', '👍']
