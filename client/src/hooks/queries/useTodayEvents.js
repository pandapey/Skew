import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { calendarApi } from '@/api/services'

export function useTodayEvents() {
  const from = dayjs().tz('Asia/Kolkata').startOf('day').toISOString()
  const to = dayjs().tz('Asia/Kolkata').endOf('day').toISOString()
  return useQuery({
    queryKey: ['calendar', 'range', 'today'],
    queryFn: () => calendarApi.range(from, to),
    staleTime: 60_000,
  })
}
