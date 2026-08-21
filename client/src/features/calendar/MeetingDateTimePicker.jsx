// =============================================================================
// Phase 6.21 (TASK 2) - SHARED MEETING DATE/TIME FIELD WITH AN EXPLICIT "OK"
//
// WHY THIS IS NOT A SECOND DATE PICKER:
//   The month grid is NOT reimplemented here. This composes the EXISTING
//   shared <GlassCalendar/> (components/glass/GlassCalendar.jsx) - the same
//   calendar the dashboard widget renders - with a time input and the app's
//   existing <Modal/> / <Button/> primitives. All this file owns is the
//   deferred-commit behaviour the brief asks for: a draft selection written
//   back to the form ONLY when the user presses OK, and discarded on
//   Cancel/close so the previous value is never silently overwritten.
//
//   The Sunday / Company-Holiday rules are NOT restated here either. They
//   arrive as the same data the rest of the app already uses (the Holiday
//   collection, read through the existing GET /leave/holidays endpoint) and are
//   expressed through GlassCalendar's `isDateDisabled` hook, so the picker
//   cannot drift from the SERVER rule in services/meetingRules.js - which
//   remains the actual guarantee.
// =============================================================================
import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { FiCalendar } from 'react-icons/fi'
import { Modal, Button } from '@/components/ui'
import { GlassCalendar } from '@/components/glass'
import { cn } from '@/utils'

// 'YYYY-MM-DDTHH:mm' - the LOCAL wire format the meeting APIs already receive
// from every other request surface. Deliberately not toISOString(), which would
// shift the day across midnight for anyone east/west of UTC.
export const toLocalDateTimeValue = (date, time) => `${dayjs(date).format('YYYY-MM-DD')}T${time}`

const DEFAULT_TIME = '10:00'

const splitValue = (value) => {
  const d = value ? dayjs(value) : null
  if (!d || !d.isValid()) return { date: null, time: DEFAULT_TIME }
  return { date: d, time: d.format('HH:mm') }
}

/**
 * Read-only field that opens a calendar + time picker and commits only on OK.
 *
 * @param value    current 'YYYY-MM-DDTHH:mm' value ('' when unset)
 * @param onChange called ONLY when OK is pressed
 * @param holidays existing Holiday rows ({ date: 'YYYY-MM-DD', name })
 */
export function MeetingDateTimePicker({
  label = 'Date & time',
  value,
  onChange,
  holidays = [],
  blockSundays = true,
  blockPast = true,
  className,
}) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState(null)
  const [draftTime, setDraftTime] = useState(DEFAULT_TIME)

  // Every time the picker opens, the draft restarts from the COMMITTED value.
  // This is what makes Cancel non-destructive: nothing outside this component
  // is touched until OK runs.
  useEffect(() => {
    if (!open) return
    const { date, time } = splitValue(value)
    setDraftDate(date)
    setDraftTime(time)
  }, [open, value])

  // 'YYYY-MM-DD' keys, matching how Holiday.date is stored server-side.
  const holidayByKey = useMemo(() => {
    const map = {}
    for (const h of holidays || []) {
      const key = String(h?.date || '').slice(0, 10)
      if (key) map[key] = h?.name || 'Company holiday'
    }
    return map
  }, [holidays])

  const isDateDisabled = (d) => {
    if (blockSundays && d.day() === 0) return true
    if (blockPast && d.isBefore(dayjs().startOf('day'))) return true
    return Boolean(holidayByKey[d.format('YYYY-MM-DD')])
  }

  const draftKey = draftDate ? dayjs(draftDate).format('YYYY-MM-DD') : ''
  const blockedReason = !draftDate
    ? 'Pick a date to continue.'
    : blockSundays && dayjs(draftDate).day() === 0
      ? 'Meetings cannot be scheduled on a Sunday.'
      : holidayByKey[draftKey]
        ? `Meetings cannot be scheduled on a company holiday (${holidayByKey[draftKey]}).`
        : ''

  const commit = () => {
    if (blockedReason || !draftDate || !draftTime) return
    onChange?.(toLocalDateTimeValue(draftDate, draftTime))
    setOpen(false)
  }

  const display = value && dayjs(value).isValid() ? dayjs(value).format('DD MMM YYYY, hh:mm A') : ''

  return (
    <div className={cn('relative', className)}>
      {/* Reuses the shared `.input` chrome so the field is visually identical
          to the other fields in the form. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="input flex w-full items-center justify-between gap-2 pb-2 pt-6 text-left"
      >
        <span className={cn('truncate', !display && 'text-muted')}>
          {display || 'Select date & time'}
        </span>
        <FiCalendar className="h-4 w-4 flex-none text-muted" />
      </button>
      <label className="pointer-events-none absolute left-3 top-2 text-xs font-medium text-primary">
        {label}
      </label>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Select date & time"
        size="sm"
        footer={(
          <>
            {/* Cancel closes WITHOUT calling onChange - the previously
                committed value stays exactly as it was. */}
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={commit} disabled={Boolean(blockedReason)}>OK</Button>
          </>
        )}
      >
        <div className="space-y-4">
          <GlassCalendar
            value={draftDate ? dayjs(draftDate).toDate() : null}
            onSelect={(d) => setDraftDate(d)}
            isDateDisabled={isDateDisabled}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted" htmlFor="meeting-time">Time</label>
            <input
              id="meeting-time"
              type="time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              className="input w-full py-2.5"
            />
          </div>
          <p className="text-xs text-muted">
            {blockedReason
              ? blockedReason
              : `Selected: ${dayjs(toLocalDateTimeValue(draftDate, draftTime)).format('DD MMM YYYY, hh:mm A')}. Press OK to apply.`}
          </p>
          <p className="text-xs text-muted">Sundays and company holidays are unavailable for meetings.</p>
        </div>
      </Modal>
    </div>
  )
}
