import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// Phase 5.5 (Task 7): global scroll-position memory.
//
// CRITICAL DETAIL: this app does NOT scroll the window. Both layouts put the
// routed content inside <main class="flex-1 overflow-y-auto">, so window.scrollY
// is always 0 and any window-based scroll restoration would silently do
// nothing. We therefore read and write scrollTop on that container.
//
// Mounted ONCE per layout (outside the routed <Outlet />) so it survives
// navigation and can observe every route change from a single place, rather
// than being repeated in every page.

const CONTAINER_ID = 'main-content'
const storageKey = (pathname) => `skew:scroll:${pathname}`
// Give asynchronously loaded lists a moment to grow tall enough to scroll to
// the saved offset before giving up.
const RESTORE_WINDOW_MS = 1500

export function ScrollMemory() {
  const { pathname } = useLocation()
  const restoreFrame = useRef(0)

  useEffect(() => {
    const el = document.getElementById(CONTAINER_ID)
    if (!el) return undefined

    // --- Save (rAF-throttled so a fast scroll cannot flood sessionStorage) ---
    let saveFrame = 0
    const onScroll = () => {
      if (saveFrame) return
      saveFrame = requestAnimationFrame(() => {
        saveFrame = 0
        try { sessionStorage.setItem(storageKey(pathname), String(el.scrollTop)) } catch { /* quota / private mode */ }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    // --- Restore ---
    let saved = 0
    try { saved = Number(sessionStorage.getItem(storageKey(pathname))) || 0 } catch { saved = 0 }

    if (saved > 0) {
      // On first paint the page is usually still a skeleton and too short to
      // scroll, so a single scrollTop assignment would be clamped to 0 and the
      // position lost. Retry each frame until the content is tall enough.
      const startedAt = Date.now()
      const tick = () => {
        if (el.scrollHeight - el.clientHeight >= saved) {
          el.scrollTop = saved
          return
        }
        if (Date.now() - startedAt > RESTORE_WINDOW_MS) {
          el.scrollTop = Math.min(saved, Math.max(0, el.scrollHeight - el.clientHeight))
          return
        }
        restoreFrame.current = requestAnimationFrame(tick)
      }
      restoreFrame.current = requestAnimationFrame(tick)
    } else {
      // A route with no stored position is a fresh view: start at the top,
      // which is the behaviour users expect from a normal page navigation.
      el.scrollTop = 0
    }

    return () => {
      el.removeEventListener('scroll', onScroll)
      if (saveFrame) cancelAnimationFrame(saveFrame)
      if (restoreFrame.current) cancelAnimationFrame(restoreFrame.current)
    }
  }, [pathname])

  return null
}

export default ScrollMemory
