import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { calendarApi } from '@/api/services'

// Today's calendar events (meetings, reminders, etc.) — shared by the
// Dashboard's "Today's Meetings" widget and My Work's daily agenda so both
// read the same cache entry.
export function useTodayEvents() {
  const from = dayjs().startOf('day').toISOString()
  const to = dayjs().endOf('day').toISOString()
  return useQuery({
    queryKey: ['calendar', 'range', 'today'],
    queryFn: () => calendarApi.range(from, to),
    staleTime: 60_000,
  })
}
