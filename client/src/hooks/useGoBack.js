import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

// Phase 5.5 (Task 6): shared "go back" behaviour for the global back button.
//
// Naive navigate(-1) is WRONG as a global solution: if the user landed on a
// deep page directly (bookmark, refresh, emailed link, or a redirect after
// login) there is no in-app history entry, and navigate(-1) would either do
// nothing or throw them out of the application entirely.
//
// React Router v6 stamps an incrementing `idx` onto window.history.state for
// every entry IT created. idx > 0 therefore means "this app pushed at least one
// entry, so going back stays inside the app". When it is 0 or absent we fall
// back to the previous LOGICAL page, derived from the URL the same way the
// Breadcrumb derives its parent links, so the two can never disagree.
export function useGoBack() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const parts = pathname.split('/').filter(Boolean)
  // '/projects/123/detail' -> '/projects/123'; '/leave' -> '/dashboard'.
  const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/dashboard'

  // Nothing sensible to go back TO from the dashboard or the root.
  const isRoot = parts.length === 0 || (parts.length === 1 && parts[0] === 'dashboard')

  const goBack = useCallback(() => {
    const idx = window.history.state?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(parentPath)
  }, [navigate, parentPath])

  return { goBack, parentPath, isRoot }
}

export default useGoBack
