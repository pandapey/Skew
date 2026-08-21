import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'

export function useMyProjects() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectApi.all(),
    staleTime: 30_000,
  })

  const mine = useMemo(() => {
    const rows = Array.isArray(query.data) ? query.data : query.data?.data || []
    if (!user?.name) return []
    return rows.filter(
      (p) => p.lead === user.name || (p.members || []).some((m) => m.name === user.name)
    )
  }, [query.data, user?.name])

  return { ...query, projects: mine }
}
