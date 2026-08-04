import { QueryClient } from '@tanstack/react-query'

// Phase 6.2 (Task 3) ROOT CAUSE D - GLOBAL CACHE DEFAULTS SUPPRESSED REFRESHES.
// The previous defaults were `staleTime: 60_000` + `refetchOnWindowFocus: false`.
// Together they meant that for a full minute after any fetch, React Query would
// serve the cached value and refuse to go back to the network - and because
// focus refetching was disabled, switching tabs/windows never recovered either.
// So even where an invalidation DID fire correctly, a remount inside the stale
// window silently reused old data, which is exactly the "only updates after a
// manual browser refresh" symptom.
//
// staleTime is now 0: data is considered stale immediately, so an invalidation
// (or a remount) always refetches. Freshness is what this app needs - it is a
// live operational tool driven by Socket.IO events, not a read-mostly cache.
// refetchOnWindowFocus/refetchOnReconnect are enabled so a session that missed
// a socket event while backgrounded or offline self-heals on return.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
    },
    mutations: {
      retry: 0,
    },
  },
})
