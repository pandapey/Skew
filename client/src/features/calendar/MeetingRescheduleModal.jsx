// Phase 6.17 (TASK 1 / TASK 7) DUPLICATE COMPONENT REMOVED:
// features/projects/MeetingRequestsPanel.jsx used to define its own
// `RescheduleModal` function inline. The Client Portal's new Reschedule
// action (TASK 3) needed the exact same "propose a new time, which returns
// the request to Pending" UI, so rather than write a second copy (which the
// NON-NEGOTIABLE RULES forbid - "Do NOT duplicate Components"), that modal is
// extracted here as the ONE shared component both the staff panel and the
// Client Portal import. Which endpoint it calls is injected via `submitFn`,
// so this file has no opinion on whether the caller is staff or the client -
// it only owns the shared form/validation/UI.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Modal, Button, Input } from '@/components/ui'
import { formatDate } from '@/utils'

// 'YYYY-MM-DDTHH:mm' for <input type="datetime-local">, in LOCAL time. Using
// toISOString() here would shift the value by the timezone offset and show
// the wrong time, which is the classic bug with this input type.
function toLocalInputValue(value) {
  const d = value ? new Date(value) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fmtDateTime = (v) => (v ? formatDate(v, 'DD MMM YYYY, hh:mm A') : '—')

/**
 * Shared "propose a new time" modal for a meeting.
 *
 * @param {object} meeting - the CalendarEvent being rescheduled.
 * @param {() => void} onClose
 * @param {() => void} onSaved - called after a successful reschedule (caller invalidates its own query keys).
 * @param {(id: string, start: string) => Promise<unknown>} submitFn - the caller's own reschedule call
 *   (calendarApi.reschedule for staff, clientService.rescheduleMeeting for the Client). Kept as an
 *   injected function rather than a hardcoded API call so this component never needs to know which
 *   side of the conversation is using it.
 * @param {string} [successMessage]
 */
export function MeetingRescheduleModal({ meeting, onClose, onSaved, submitFn, successMessage }) {
  const [start, setStart] = useState(toLocalInputValue(meeting?.start))

  const rescheduleMut = useMutation({
    mutationFn: () => submitFn(meeting.id || meeting._id, start),
    onSuccess: () => {
      toast.success(successMessage || 'Meeting rescheduled')
      onSaved()
      onClose()
    },
    onError: (err) => toast.error(err?.response?.data?.message || err?.message || 'Could not reschedule'),
  })

  const submit = (e) => {
    e.preventDefault()
    if (!start) { toast.error('Pick a new date and time'); return }
    rescheduleMut.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reschedule meeting"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={rescheduleMut.isPending}>Save new time</Button>
        </>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">
          Currently <span className="font-medium text-app">{fmtDateTime(meeting?.start)}</span>.
        </p>
        <Input label="New date & time" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        <p className="text-xs text-muted">
          Proposing a new time returns the request to Pending so the other side can confirm it.
        </p>
      </form>
    </Modal>
  )
}
