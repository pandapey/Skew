import dayjs from 'dayjs'

export const WINDOW_DAYS = 30

export function daysUntil(date) {
  if (!date) return Infinity
  const a = dayjs(date).startOf('day')
  const b = dayjs().startOf('day')
  return a.diff(b, 'day')
}

export function toneFor(date) {
  const d = daysUntil(date)
  if (d < 0) return 'danger'
  if (d <= WINDOW_DAYS) return 'warning'
  return 'success'
}

export function labelFor(date) {
  const d = daysUntil(date)
  if (d < 0) return 'Expired'
  if (d <= WINDOW_DAYS) return 'Expiring soon'
  return 'Active'
}

export function countdownFor(date) {
  const d = daysUntil(date)
  if (d === 0) return 'Expires today'
  if (d === 1) return 'Expires tomorrow'
  if (d > 1) return `in ${d} days`
  const late = Math.abs(d)
  return late === 1 ? '1 day ago' : `${late} days ago`
}

export function formatMoney(n) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0)
}
