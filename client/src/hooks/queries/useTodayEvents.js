import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { calendarApi } from '@/api/services'

export function useTodayEvents() {
  const from = dayjs().startOf('day').toISOString()
  const to = dayjs().endOf('day').toISOString()
  return useQuery({
    queryKey: ['calendar', 'range', 'today'],
    queryFn: () => calendarApi.range(from, to),
    staleTime: 60_000,
  })
}
