// Recurrence expansion engine.
//
// A recurring event is stored as a single "master" record carrying a
// `recurrence` descriptor. At render time we expand it into the concrete
// occurrences that fall inside the visible window so the grid can paint each
// one. Occurrences are immutable copies that retain a `masterId` link so edits
// and drag-and-drop always mutate the master record.
import dayjs from 'dayjs'

// Advance the cursor by one recurrence step.
function step(cursor, rec) {
  const interval = Math.max(1, Number(rec.interval) || 1)
  switch (rec.freq) {
    case 'daily':
      return cursor.add(interval, 'day')
    case 'weekly':
      return cursor.add(1, 'day') // step day-by-day, filter by weekday below
    case 'monthly':
      return cursor.add(interval, 'month')
    case 'yearly':
      return cursor.add(interval, 'year')
    default:
      return cursor.add(interval, 'day')
  }
}

// Expand a single event into every occurrence overlapping [rangeStart, rangeEnd].
export function generateOccurrences(event, rangeStart, rangeEnd) {
  const rec = event.recurrence
  const isRecurring = rec && rec.freq && rec.freq !== 'none'
  if (!isRecurring) return [{ ...event, masterId: event.id, isOccurrence: false }]

  const base = dayjs(event.start)
  const durationMs = Math.max(0, dayjs(event.end).valueOf() - base.valueOf())
  const until = rec.until ? dayjs(rec.until).endOf('day') : null
  const count = rec.count ? Number(rec.count) : null
  const byWeekday = Array.isArray(rec.byWeekday)
    ? rec.byWeekday.map(Number).filter((d) => d >= 0 && d <= 6)
    : []

  // Daily/weekly series can begin at the window start without missing occurrences.
  let cursor = base.clone()
  if ((rec.freq === 'daily' || rec.freq === 'weekly') && cursor.isBefore(rangeStart)) {
    cursor = rangeStart.clone()
  }

  const result = []
  let made = 0
  let guard = 0
  while (guard < 2000) {
    guard++
    const occStart = cursor.clone()
    let match = true
    // Weekday restriction applies to both weekly and daily series.
    if ((rec.freq === 'weekly' || rec.freq === 'daily') && byWeekday.length) {
      match = byWeekday.includes(occStart.day())
    }

    if (match) {
      const occEnd = occStart.add(durationMs)
      const overlaps = occEnd.isAfter(rangeStart) && occStart.isBefore(rangeEnd)
      if (overlaps) {
        result.push({
          ...event,
          id: `${event.id}__occ${made}`,
          masterId: event.id,
          isOccurrence: true,
          occurrenceIndex: made,
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
        })
      }
      made++
      if (count && made >= count) break
      if (until && occStart.isAfter(until)) break
    }

    cursor = step(cursor, rec)
    if (cursor.isAfter(rangeEnd)) break
  }
  return result
}

// Expand a whole collection of events for the visible window.
export function expandEvents(events, rangeStart, rangeEnd) {
  const out = []
  for (const ev of events) out.push(...generateOccurrences(ev, rangeStart, rangeEnd))
  return out
}

// Convenience accessors.
export const occStart = (o) => dayjs(o.start)
export const occEnd = (o) => dayjs(o.end)
export const isAllDay = (o) => Boolean(o.allDay)
export const isMultiDay = (o) => occStart(o).startOf('day').isBefore(occEnd(o).startOf('day'))

// Shift an occurrence (or master) to a new start, preserving its duration.
// Returns a patch suitable for the service `update` call on the master id.
export function shiftEvent(event, newStartDayjs) {
  const start = dayjs(event.start)
  const end = dayjs(event.end)
  const duration = end.valueOf() - start.valueOf()
  const ns = newStartDayjs.clone()
  const ne = ns.clone().add(duration)
  return { start: ns.toISOString(), end: ne.toISOString() }
}
