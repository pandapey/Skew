import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { FiCalendar } from 'react-icons/fi'
import { Modal, Button } from '@/components/ui'
import { GlassCalendar } from '@/components/glass'
import { cn } from '@/utils'

export const toLocalDateTimeValue = (date, time) => `${dayjs(date).format('YYYY-MM-DD')}T${time}`

const DEFAULT_TIME = '10:00'

const splitValue = (value) => {
  const d = value ? dayjs(value) : null
  if (!d || !d.isValid()) return { date: null, time: DEFAULT_TIME }
  return { date: d, time: d.format('HH:mm') }
}

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

  useEffect(() => {
    if (!open) return
    const { date, time } = splitValue(value)
    setDraftDate(date)
    setDraftTime(time)
  }, [open, value])

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
