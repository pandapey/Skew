// Phase 5.5 (Task 4) — apply for an hourly permission.
//
// Deliberately a SEPARATE modal from ApplyLeaveModal rather than a mode inside
// it: the two forms share almost no fields (no leave type, no date range, no
// half-day session; instead a single date plus an hours selector), so folding
// them together would have produced a form full of mutually exclusive
// branches. The business rules they DO share — the attendance rule and the
// monthly allowance — live on the server and are enforced there once.
//
// The allowance shown here is fetched live from /leave/hourly-balance so the
// figure is always the server's derived value, never a client guess.
import { useEffect, useState } from 'react'
import { FiInfo, FiAlertCircle } from 'react-icons/fi'
import { Modal, Button, Input, Textarea, Select } from '@/components/ui'
import {
  HOURLY_PERMISSION_MONTHLY_HOURS, HOURLY_PERMISSION_STEP_HOURS, formatHours, isSunday,
} from './constants'

// Selectable durations: every half-hour step up to the monthly allowance.
const HOUR_OPTIONS = Array.from(
  { length: Math.round(HOURLY_PERMISSION_MONTHLY_HOURS / HOURLY_PERMISSION_STEP_HOURS) },
  (_, i) => {
    const value = (i + 1) * HOURLY_PERMISSION_STEP_HOURS
    return { value: String(value), label: formatHours(value) }
  },
)

const EMPTY = { date: '', hours: '', reason: '' }

export function ApplyHourlyPermissionModal({ open, onClose, onSubmit, balance, loading }) {
  const [form, setForm] = useState(EMPTY)
  const [touched, setTouched] = useState(false)

  useEffect(() => { if (open) { setForm(EMPTY); setTouched(false) } }, [open])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const allowance = balance?.allowance ?? HOURLY_PERMISSION_MONTHLY_HOURS
  const used = balance?.used ?? 0
  const remaining = balance?.remaining ?? allowance

  const hours = Number(form.hours) || 0
  const exceedsRemaining = hours > remaining
  // Sundays are company holidays across the whole leave module; a permission to
  // step out of a non-working day is meaningless.
  const sundayPicked = Boolean(form.date) && isSunday(form.date)
  const missing = !form.date || !hours || !String(form.reason).trim()
  const canSubmit = !missing && !exceedsRemaining && !sundayPicked

  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit || loading) return
    onSubmit({ date: form.date, hours, reason: form.reason.trim() })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply for Hourly Permission"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={loading} disabled={!canSubmit} onClick={submit}>Submit Request</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {/* Balance summary — Allowance / Used / Remaining, exactly as briefed. */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Monthly Allowance', value: formatHours(allowance), tone: '' },
            { label: 'Already Used', value: formatHours(used), tone: 'text-warning' },
            { label: 'Remaining', value: formatHours(remaining), tone: remaining > 0 ? 'text-success' : 'text-danger' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-app p-3 text-center">
              <p className="text-xs text-muted">{s.label}</p>
              <p className={`text-lg font-semibold ${s.tone}`}>{s.value}</p>
            </div>
          ))}
        </div>
        {balance?.month && (
          <p className="text-center text-xs text-muted">Allowance shown for {balance.month}</p>
        )}

        <Input
          label="Date"
          type="date"
          value={form.date}
          onChange={set('date')}
          error={sundayPicked ? 'Sunday is a company holiday — pick another date' : undefined}
        />

        <Select
          label="Hours Requested"
          value={form.hours}
          onChange={set('hours')}
          options={HOUR_OPTIONS}
          error={exceedsRemaining ? `Only ${formatHours(remaining)} remaining this month` : undefined}
        />

        <Textarea
          label="Reason"
          placeholder="Briefly describe why you need this permission…"
          value={form.reason}
          onChange={set('reason')}
          error={touched && !String(form.reason).trim() ? 'Please provide a reason' : undefined}
        />

        <div className="flex items-start gap-2 text-xs text-muted">
          <FiInfo className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            You get {formatHours(allowance)} of permission per calendar month. The allowance resets on the 1st and does
            not carry forward. Requests go to your Manager or HR for approval, and pending requests already count
            against your remaining balance.
          </p>
        </div>

        {exceedsRemaining && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger" aria-live="polite">
            <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              You requested {formatHours(hours)} but only {formatHours(remaining)} of your {formatHours(allowance)}{' '}
              monthly allowance remains.
            </p>
          </div>
        )}
      </form>
    </Modal>
  )
}

export default ApplyHourlyPermissionModal
