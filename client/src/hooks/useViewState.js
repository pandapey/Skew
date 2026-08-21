import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

const keyFor = (pathname, name) => `skew:view:${pathname}:${name}`

function read(storageKey, initial) {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return initial
    const parsed = JSON.parse(raw)
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

  const patch = useCallback((next) => {
    setState((s) => ({ ...s, ...(typeof next === 'function' ? next(s) : next) }))
  }, [])

  const reset = useCallback(() => {
    try { sessionStorage.removeItem(storageKey) } catch { /* ignore */ }
    setState(initial)
  }, [storageKey])

  return [state, patch, reset, setState]
}

export default useViewState
