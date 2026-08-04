// Event editor — create / edit / delete with type, all-day, attendees,
// description and recurrence. Recurrence is captured as a descriptor on the
// master record (expanded later by recurrence.js).
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { FiTrash2, FiRepeat, FiCheckCircle, FiXCircle } from 'react-icons/fi'
import { Modal, Button, Input, Select, Textarea, Badge } from '@/components/ui'
import { cn } from '@/utils'
import { TYPE_META, MEETING_STATUS_META, RECURRENCE_FREQ, WEEKDAY_LABELS } from './constants'

const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] // Mon..Sun in dayjs numbering

function toDateStr(d) {
  return dayjs(d).format('YYYY-MM-DD')
}
function toTimeStr(d) {
  return dayjs(d).format('HH:mm')
}

export default function EventModal({ open, onClose, event, defaultStart, onSave, onDelete, readOnly = false, canActOnMeeting = false, onUpdateStatus }) {
  const isEdit = Boolean(event)
  const [title, setTitle] = useState('')
  const [type, setType] = useState('event')
  const [allDay, setAllDay] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('10:00')
  const [location, setLocation] = useState('')
  const [attendees, setAttendees] = useState('')
  const [description, setDescription] = useState('')
  const [freq, setFreq] = useState('none')
  const [byWeekday, setByWeekday] = useState([])
  const [until, setUntil] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Hydrate form whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setError('')
    const base = event ? dayjs(event.start) : defaultStart || dayjs()
    const end = event ? dayjs(event.end) : base.add(1, 'hour')
    const ad = event ? Boolean(event.allDay) : false

    setTitle(event?.title || '')
    setType(event?.type || 'event')
    setAllDay(ad)
    setStartDate(toDateStr(base))
    setStartTime(ad ? '00:00' : toTimeStr(base))
    setEndDate(toDateStr(end))
    setEndTime(ad ? '00:00' : toTimeStr(end))
    setLocation(event?.location || '')
    setAttendees((event?.attendees || []).join(', '))
    setDescription(event?.description || '')
    setDone(Boolean(event?.done))
    const rec = event?.recurrence || { freq: 'none', interval: 1, byWeekday: [], until: null, count: null }
    setFreq(rec.freq || 'none')
    setByWeekday(rec.byWeekday?.map(Number) || [])
    setUntil(rec.until ? toDateStr(rec.until) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event])

  const toggleWeekday = (d) =>
    setByWeekday((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  const handleSave = () => {
    if (readOnly) return
    if (!title.trim()) {
      setError('Please enter a title.')
      return
    }
    let sd = startDate
    let ed = endDate || startDate
    let st = allDay ? '00:00' : startTime || '00:00'
    let et = allDay ? '00:00' : endTime || '00:00'

    const start = allDay ? dayjs(sd) : dayjs(`${sd}T${st}`)
    let end = allDay ? dayjs(ed) : dayjs(`${ed}T${et}`)
    if (end.isBefore(start)) end = allDay ? dayjs(ed) : start.add(1, 'hour')

    const recurrence = {
      freq,
      interval: 1,
      byWeekday: freq === 'weekly' ? byWeekday : [],
      until: until ? dayjs(until).toISOString() : null,
      count: null,
    }

    const payload = {
      title: title.trim(),
      type,
      allDay,
      start: start.toISOString(),
      end: end.toISOString(),
      location: location.trim(),
      description: description.trim(),
      attendees: attendees
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      recurrence,
    }
    if (type === 'task') payload.done = done

    const masterId = event?.masterId || event?.id || null
    onSave(masterId, payload)
  }

  const meta = TYPE_META[type] || TYPE_META.event

  // Phase 6.9 (Task 17): client meeting requests carry a Pending/Approved/
  // Cancelled/Rejected lifecycle - show it, and (when canActOnMeeting) let an
  // authorized staff member action it right from this modal.
  const isMeetingRequest = Boolean(event?.clientId && event?.meetingStatus)
  const meetingMeta = MEETING_STATUS_META[event?.meetingStatus] || MEETING_STATUS_META.Pending
  const meetingId = event?.masterId || event?.id

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={readOnly ? 'Event Details' : isEdit ? 'Edit Event' : 'New Event'}
      size="lg"
      footer={
        readOnly ? (
          <div className="flex w-full justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {isEdit ? (
                <Button
                  variant="ghost"
                  className="text-danger hover:bg-danger/10"
                  icon={FiTrash2}
                  onClick={() => onDelete?.(event?.masterId || event?.id)}
                >
                  Delete
                </Button>
              ) : (
                <span />
              )}
              {isMeetingRequest && canActOnMeeting && event?.meetingStatus === 'Pending' && (
                <>
                  <Button variant="success" icon={FiCheckCircle} onClick={() => onUpdateStatus?.(meetingId, 'Approved')}>Approve</Button>
                  <Button variant="danger" icon={FiXCircle} onClick={() => onUpdateStatus?.(meetingId, 'Rejected')}>Reject</Button>
                </>
              )}
              {isMeetingRequest && canActOnMeeting && event?.meetingStatus === 'Approved' && (
                <Button variant="danger" icon={FiXCircle} onClick={() => onUpdateStatus?.(meetingId, 'Cancelled')}>Cancel meeting</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </div>
          </div>
        )
      }
    >
      <fieldset disabled={readOnly} className={readOnly ? 'space-y-4 opacity-95' : 'space-y-4'}>
        {readOnly && (
          <p className="rounded-xl border border-app bg-black/[0.03] px-3 py-2 text-xs text-muted dark:bg-white/[0.04]">
            You have read-only access to the calendar. Contact HR or an admin to change events.
          </p>
        )}
        {isMeetingRequest && (
          <div className="flex items-center gap-2 rounded-xl border border-app bg-black/[0.02] px-3 py-2 text-xs dark:bg-white/[0.03]">
            <span className="text-muted">Client meeting request status</span>
            <Badge tone={meetingMeta.tone}>{meetingMeta.label}</Badge>
          </div>
        )}
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a title"
          error={error}
          autoFocus
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPE_META).map(([k, m]) => (
              <option key={k} value={k}>{m.singular}</option>
            ))}
          </Select>

          <div className="flex items-end">
            <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-app px-3 py-2 text-sm">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4" />
              All day
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {!allDay && (
            <Input label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="End" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          {!allDay && (
            <Input label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          )}
        </div>

        {type === 'task' && (
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-app px-3 py-2 text-sm">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="h-4 w-4" />
            Mark as completed
          </label>
        )}

        <Input
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Meeting Room B / Zoom"
        />

        <Input
          label="Attendees"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder="Comma separated, e.g. Priya, Rahul"
        />

        <div>
          <label className="label flex items-center gap-1">
            <FiRepeat className="h-3.5 w-3.5" /> Repeat
          </label>
          <Select value={freq} onChange={(e) => setFreq(e.target.value)} className="mb-2">
            {RECURRENCE_FREQ.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          {freq === 'weekly' && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_VALUES.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleWeekday(d)}
                  className={cn(
                    'h-8 w-8 rounded-lg border text-xs font-medium transition',
                    byWeekday.includes(d)
                      ? 'border-primary bg-primary text-white'
                      : 'border-app text-muted hover:border-primary/40',
                  )}
                >
                  {WEEKDAY_LABELS[d].charAt(0)}
                </button>
              ))}
            </div>
          )}
          {freq !== 'none' && freq !== 'weekly' && (
            <div className="mt-2">
              <Input label="End repeat (optional)" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          )}
        </div>

        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notes, agenda, links…"
        />

        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={cn('inline-flex h-3 w-3 rounded-full', meta.dot)} />
          Colour is set by the event type ({meta.label}).
        </div>
      </fieldset>
    </Modal>
  )
}
