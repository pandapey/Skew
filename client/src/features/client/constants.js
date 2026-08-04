// Shared helpers & display config for the Client Portal.
export { cn } from '@/utils'

// Phase 5.8 (Task 4): canonical project lifecycle stages shown by the
// timeline stepper. 'Project Created' is always resolved from the project's
// real startDate/creation activity (never fabricated); the remaining stages
// are matched by name against the project's REAL stored `timeline` entries -
// a stage with no matching entry is shown as pending with no invented date.
export const TIMELINE_STAGES = [
  'Project Created', 'Planning', 'Development', 'Testing', 'Review', 'Deployment', 'Completed',
]

// Map a project status string → a badge tone (reuses the Badge statusMap but
// adds client-specific statuses).
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

// Phase 6.9 (Task 17) ROOT CAUSE FIX: MEETING_STATUS_TONE was dead code tied
// to the old ClientMeeting time-based vocabulary ('upcoming'/'completed'),
// which no longer exists. Meetings now use MEETING_STATUS_META from
// '../calendar/constants' (Pending/Approved/Cancelled/Rejected) - the SAME
// badge vocabulary the internal Calendar uses, so there is one shared source
// of truth instead of two parallel, drifting status systems.

// Map a timeline stage status → stepper visual state.
export const stageState = (status) =>
  status === 'Completed' ? 'done' : status === 'In Progress' ? 'active' : 'todo'

// Format an ISO timestamp (or date) to a short, human label.
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

// Tone for per-stage badge.
export const stageTone = (status) =>
  status === 'Completed' ? 'success' : status === 'In Progress' ? 'warning' : 'default'

// Write a text Blob to disk as a download.
// Phase 6.3 (Task 8): renamed from `downloadDummyFile`. The name was inaccurate
// and actively misleading - every caller passes REAL invoice/receipt values read
// from the database, so nothing about the output is dummy data. The default
// argument (the only genuinely placeholder part) has been dropped so a caller
// cannot accidentally emit filler text.
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

// =============================================================================
// Phase 6.11 (TASK 3) — SINGLE billing summariser for the client portal.
//
// ROOT CAUSE this exists to kill: the portal had TWO different answers for the
// same question. ClientBilling.jsx derived Paid/Outstanding from the rows that
// GET /client/payments assembles (project payment rows + Finance Invoices +
// Income Transactions), while ClientDashboard.jsx derived its own "Amount Paid"
// and "Outstanding" cards from a completely separate expression over the
// ['client-projects'] payload:
//
//     totalPaid = Σ project.payments[].paid
//     balance   = Σ project.budget − totalPaid
//
// Those two never agreed, and the dashboard's version was wrong twice over:
//   * it ignored Finance Invoices and Income Transactions entirely, so a client
//     whose billing lives in the Finance module (the normal case since Phase
//     6.9) saw ₹0 Paid on the dashboard and the true figure on Billing;
//   * it treated BUDGET as if it were BILLED. A project budget is a commercial
//     estimate, not money invoiced, so "Outstanding" was really
//     "budget not yet collected" — it showed a balance owing for work that had
//     never been invoiced at all.
//
// Every figure below is computed ONCE here, from the stored rows only, and both
// pages import it. No calculation is duplicated and no value is synthesised.
// =============================================================================

// A receipt is not a bill. Income Transaction rows (source: 'transaction') are
// money ALREADY RECEIVED that the server surfaces so advance payments are
// visible; counting them in "Total Billed" would inflate it by the value of
// every advance. They still count towards Paid, which is what they are.
const isBillable = (r) => r.source !== 'transaction'

// Per-row unpaid portion, floored at zero. Flooring PER ROW (rather than on the
// total, as ClientBilling did before this phase) matters: an overpaid or
// credited invoice must not silently cancel out a genuinely unpaid one and hide
// a real debt behind a healthy-looking net total.
const rowDue = (r) => Math.max(0, (r.amount || 0) - (r.paid || 0))

export function summarizeBilling(billing) {
  const rows = billing?.rows || []

  // Stored commercial terms off the Client document (Phase 5.7 onboarding),
  // passed straight through — not derived, not defaulted to a placeholder.
  const advancePayment = billing?.advancePayment || 0
  const monthlyDue = billing?.monthlyDue || 0

  const billed = rows.filter(isBillable).reduce((s, r) => s + (r.amount || 0), 0)

  // Phase 6.23 (TASK 3): the account's Total Amount is the CONTRACTED value of
  // the client's projects (ClientProject.budget), which only the server can
  // total - a project that has not been invoiced yet produces no row here, so
  // no row-based sum could ever see it. buildBillingRows() now returns it as
  // `totalAmount`; it is consumed, never recomputed. The `?? billed` fallback
  // only covers an older cached response that predates the field, so the card
  // degrades to the invoice total instead of rendering blank.
  const totalAmount = Number.isFinite(billing?.totalAmount) ? billing.totalAmount : billed
  const paid = rows.reduce((s, r) => s + (r.paid || 0), 0)

  // Pending = the unpaid portion of invoices that are still open. Rows already
  // marked Paid are excluded so a rounding remainder on a settled invoice does
  // not read as an amount still due.
  const pending = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid')
    .reduce((s, r) => s + rowDue(r), 0)

  // Outstanding = what the ACCOUNT owes: everything billed, less everything
  // received (including unapplied advances, which is why this can be lower than
  // Pending). Floored at zero — a credit balance is not a debt.
  const balance = Math.max(0, billed - paid)

  // Next payment due. Finance invoices carry a real `dueDate`; project payment
  // rows only carry `date`. Phase 6.11 root cause: this sorted and displayed
  // `date`, i.e. the date the invoice was ISSUED, so the "Next Due" card showed
  // a date in the past for every unpaid invoice. Prefer the due date and fall
  // back to the issue date only when no due date is stored.
  const dueOn = (r) => r.dueDate || r.date || ''
  const next = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid' && dueOn(r))
    .sort((a, b) => new Date(dueOn(a)) - new Date(dueOn(b)))[0]

  const overdue = rows.some((r) => r.status === 'Overdue')

  return { rows, advancePayment, monthlyDue, totalAmount, billed, paid, pending, balance, next, nextDueDate: next ? dueOn(next) : '', overdue }
}
