import { useQuery } from '@tanstack/react-query'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'

// Single source of truth for "my" project tasks — shared by the Dashboard's
// Today's Tasks widget and the My Work page's task buckets so both read from
// the same TanStack Query cache entry instead of firing duplicate requests.
// Bucketing (today/overdue/upcoming/etc.) is done by consumers via
// `features/mywork/taskBuckets.js`, kept separate from data-fetching.
export function useMyTasks() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'mine', user?._id],
    queryFn: () => projectApi.tasks({ assignee: user.name }),
    enabled: !!user?.name,
    // Phase 6.2 (Task 3): the local `staleTime: 30_000` OVERRODE the global
    // default, so this specific list kept serving a cached result for 30s after
    // a submit even once the correct key was invalidated. Removed so the hook
    // inherits the app-wide freshness policy in api/queryClient.js.
  })
}
