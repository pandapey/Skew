import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

// Phase 5.5 (Task 7): remember a page's VIEW STATE across navigation.
//
// Scroll position alone is not enough: restoring the scroll of a list that has
// reset to page 1 with cleared filters just shows the user a different list at
// the same offset. This hook persists the things that DEFINE what is on screen
// (filters, search, sorting, pagination, active tab, expanded sections) so the
// restored scroll position actually refers to the same content.
//
// sessionStorage (not localStorage) is deliberate: filters should survive
// navigating away and back within a working session, but a brand-new session
// should start clean rather than resurrecting a filter set from days ago that
// makes a page look mysteriously empty.
//
// Keyed by pathname so two different list pages never collide.

const keyFor = (pathname, name) => `skew:view:${pathname}:${name}`

function read(storageKey, initial) {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return initial
    const parsed = JSON.parse(raw)
    // Merge over the defaults so a newly added field is not left undefined for
    // users who still have an older shape persisted from a previous release.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...initial, ...parsed }
    }
    return parsed
  } catch {
    return initial
  }
}

export function useViewState(name, initial) {
  const { pathname } = useLocation()
  const storageKey = useMemo(() => keyFor(pathname, name), [pathname, name])

  const [state, setState] = useState(() => read(storageKey, initial))

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(state)) } catch { /* quota / private mode */ }
  }, [storageKey, state])

  // Partial update helper, so callers do not have to spread by hand everywhere.
  const patch = useCallback((next) => {
    setState((s) => ({ ...s, ...(typeof next === 'function' ? next(s) : next) }))
  }, [])

  const reset = useCallback(() => {
    try { sessionStorage.removeItem(storageKey) } catch { /* ignore */ }
    setState(initial)
    // `initial` is intentionally not a dependency: callers normally pass an
    // object literal, which would change identity on every render and make
    // `reset` unstable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  return [state, patch, reset, setState]
}

export default useViewState
