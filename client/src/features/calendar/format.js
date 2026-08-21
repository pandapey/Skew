// Small formatting helpers for the calendar views.
import dayjs from 'dayjs'

// 24h "09:30" -> "9:30 AM"
export function timeLabel(d) {
  return dayjs(d).format('h:mm A')
}

// Compact range "9:30 – 10:00 AM" (omits repeated AM/PM where possible).
export function timeRange(start, end) {
  const s = dayjs(start)
  const e = dayjs(end)
  const sStr = s.format('h:mm')
  if (s.isSame(e, 'day')) return `${sStr} – ${e.format('h:mm A')}`
  return `${s.format('h:mm A')} – ${e.format('h:mm A')}`
}

export function dayLabel(d) {
  return dayjs(d).format('ddd, MMM D')
}

// "#2563EB" + 0.12 -> "rgba(37,99,235,0.12)"
export function hexToRgba(hex, alpha = 1) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
