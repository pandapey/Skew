import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'

// All projects the current user is on (as lead or member). Shared by the
// Dashboard's "My Projects" widget and My Work's Assigned/Favorite Projects
// panels — one query, filtered client-side, instead of separate requests.
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
