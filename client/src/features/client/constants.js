export { cn } from '@/utils'

export const TIMELINE_STAGES = [
  'Project Created', 'Planning', 'Development', 'Testing', 'Review', 'Deployment', 'Completed',
]

export const PROJECT_STATUS_TONE = {
  Planning: 'default',
  'UI/UX': 'accent',
  Development: 'primary',
  Testing: 'warning',
  'Client Review': 'accent',
  Deployment: 'primary',
  Completed: 'success',
  'On Hold': 'danger',
}

export const PAYMENT_STATUS_TONE = {
  Paid: 'success',
  Pending: 'warning',
  Overdue: 'danger',
  'Partial Payment': 'primary',
}

export const stageState = (status) =>
  status === 'Completed' ? 'done' : status === 'In Progress' ? 'active' : 'todo'

export const fmtDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
export const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export const fmtTimeAgo = (iso) => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  return fmtDate(iso)
}

export const stageTone = (status) =>
  status === 'Completed' ? 'success' : status === 'In Progress' ? 'warning' : 'default'

export function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const isBillable = (r) => r.source !== 'transaction'

const rowDue = (r) => Math.max(0, (r.amount || 0) - (r.paid || 0))

export function summarizeBilling(billing) {
  const rows = billing?.rows || []

  const advancePayment = billing?.advancePayment || 0
  const monthlyDue = billing?.monthlyDue || 0

  const billed = rows.filter(isBillable).reduce((s, r) => s + (r.amount || 0), 0)

  const totalAmount = Number(billing?.totalAmount) > 0 ? Number(billing.totalAmount) : billed
  const paid = rows.reduce((s, r) => s + (r.paid || 0), 0)

  const pending = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid')
    .reduce((s, r) => s + rowDue(r), 0)

  const balance = Math.max(0, Math.max(totalAmount, billed) - paid)

  const dueOn = (r) => r.dueDate || r.date || ''
  const next = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid' && dueOn(r))
    .sort((a, b) => new Date(dueOn(a)) - new Date(dueOn(b)))[0]

  const overdue = rows.some((r) => r.status === 'Overdue')

  return { rows, advancePayment, monthlyDue, totalAmount, billed, paid, pending, balance, next, nextDueDate: next ? dueOn(next) : '', overdue }
}
