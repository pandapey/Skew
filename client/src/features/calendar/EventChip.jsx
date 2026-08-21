// Reusable event block used across the month grid, the all-day lane and the
// week/day time grids. Colour is driven by the event category (TYPE_META).
import dayjs from 'dayjs'
import { FiRepeat } from 'react-icons/fi'
import { cn } from '@/utils'
import { TYPE_META, VIEW, getEventMeta } from './constants'
import { isAllDay } from './recurrence'
import { timeLabel, hexToRgba } from './format'

// `occurrence` is an expanded event (see recurrence.js).
// `layout` is 'bar' (month cell / all-day lane) or 'block' (time grid).
export default function EventChip({
  occurrence: o,
  layout = 'bar',
  onClick,
  onToggleDone,
  style,
  className,
  draggable,
  onDragStart,
  onDragEnd,
}) {
  // Phase 6.9 (Task 17): client meetings show a status-driven colour/icon
  // (Pending/Approved/Cancelled/Rejected) instead of the plain 'meeting' one.
  const meta = getEventMeta(o)
  const allDay = isAllDay(o)
  const done = o.type === 'task' && o.done
  const isRec = o.recurrence?.freq && o.recurrence.freq !== 'none'

  const handleClick = (e) => {
    e.stopPropagation()
    onClick?.(o)
  }

  const checkbox = o.type === 'task' && (
    <input
      type="checkbox"
      checked={!!done}
      onClick={(e) => e.stopPropagation()}
      onChange={() => onToggleDone?.(o)}
      style={{ accentColor: meta.color }}
      className="h-3 w-3 shrink-0 cursor-pointer"
      aria-label={done ? 'Mark incomplete' : 'Mark complete'}
    />
  )

  if (layout === 'block') {
    return (
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={handleClick}
        style={{ ...style, backgroundColor: hexToRgba(meta.color, 0.16), borderLeft: `3px solid ${meta.color}` }}
        className={cn(
          'group absolute overflow-hidden rounded-md px-2 py-1 text-xs cursor-pointer hover:ring-2 hover:ring-primary/40 transition',
          className,
        )}
        title={o.title}
      >
        <div className="flex items-center gap-1 font-medium" style={{ color: meta.color }}>
          {checkbox}
          <span className={cn('truncate', done && 'line-through opacity-70')}>{o.title}</span>
          {isRec && <FiRepeat className="h-3 w-3 shrink-0 opacity-70" />}
        </div>
        {!allDay && (
          <div className="truncate text-[10px] opacity-80" style={{ color: meta.color }}>
            {timeLabel(o.start)}
          </div>
        )}
      </div>
    )
  }

  // bar layout
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      style={{ borderLeftColor: meta.color, backgroundColor: hexToRgba(meta.color, 0.1) }}
      className={cn(
        'group flex items-center gap-1 truncate rounded border-l-2 px-1.5 py-0.5 text-[11px] font-medium cursor-pointer transition hover:brightness-105',
        done && 'opacity-70',
        className,
      )}
      title={o.title}
    >
      {checkbox}
      <span className={cn('truncate', done && 'line-through')} style={{ color: meta.color }}>
        {o.title}
      </span>
      {!allDay && (
        <span className="ml-auto shrink-0 pl-1 text-[10px] opacity-70" style={{ color: meta.color }}>
          {dayjs(o.start).format('h:mm')}
        </span>
      )}
      {isRec && <FiRepeat className="h-2.5 w-2.5 shrink-0 opacity-70" />}
    </div>
  )
}
