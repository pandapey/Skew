import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
dayjs.extend(utc); dayjs.extend(timezone)
// Merge tailwind classes safely.
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const formatDate = (d, f = 'DD MMM YYYY') => (d ? dayjs(d).format(f) : '—')
export const formatDateTime = (d) => (d ? dayjs(d).format('DD MMM YYYY, hh:mm A') : '—')
export const fromNow = (d) => (d ? dayjs(d).fromNow?.() ?? dayjs(d).format('DD MMM') : '—')

export const formatCurrency = (n, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0)

export const formatNumber = (n) => new Intl.NumberFormat('en-IN').format(n || 0)

export const initials = (name = '') =>
  name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

export const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// Deterministic pseudo-color from a string (for avatars/tags).
export const colorFromString = (str = '') => {
  const colors = ['#2563EB', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export const paginate = (arr, page, perPage) =>
  arr.slice((page - 1) * perPage, page * perPage)

export const pctChange = (current, previous) => {
  if (current == null || previous == null || previous === 0) return undefined
  const pct = ((current - previous) / Math.abs(previous)) * 100
  if (!Number.isFinite(pct)) return undefined
  return Math.round(pct * 10) / 10
}

export const monthlyTrend = (records = [], dateField = 'date', ref = new Date()) => {
  if (!Array.isArray(records) || !records.length) return undefined
  const y = ref.getFullYear()
  const m = ref.getMonth()
  const prev = new Date(y, m - 1, 1)
  const inMonth = (d, yy, mm) => {
    const dt = new Date(d)
    return !isNaN(dt) && dt.getFullYear() === yy && dt.getMonth() === mm
  }
  const curr = records.filter((r) => inMonth(r?.[dateField], y, m)).length
  const last = records.filter((r) => inMonth(r?.[dateField], prev.getFullYear(), prev.getMonth())).length
  return pctChange(curr, last)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
