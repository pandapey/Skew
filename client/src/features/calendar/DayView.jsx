// Day view: a single-day time grid.
import TimeGrid from './TimeGrid'

export default function DayView({ current, occurrences, today, now, ...handlers }) {
  return (
    <TimeGrid
      days={[current]}
      occurrences={occurrences}
      today={today}
      now={now}
      minWidth={640}
      {...handlers}
    />
  )
}
