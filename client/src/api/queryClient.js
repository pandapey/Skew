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
// ---------------------------------------------------------------------------
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 3 — global console audit)
// ---------------------------------------------------------------------------
// `retry: 1` retried EVERY failure, including ones the server has already
// answered definitively. A 401/403/404/422 is not a transient fault: repeating
// it cannot succeed, it just doubles the failed request in the Network panel and
// the console. That is a second, independent reason the notification 401s
// appeared "multiple times" (each poll produced 2 requests per endpoint, i.e.
// 4 failed requests every 15 seconds).
//
// 5xx and network-level failures (no `error.response` at all) ARE worth one
// retry and keep exactly the previous behaviour. Nothing is hidden: the query
// still ends in an error state, the error still reaches the component, and
// api/client.js still toasts non-401 failures. This only stops a hopeless
// request being sent twice.
const retryOnlyTransient = (failureCount, error) => {
  const status = error?.response?.status
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return failureCount < 1
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: retryOnlyTransient,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
    },
    mutations: {
      retry: 0,
    },
  },
})
