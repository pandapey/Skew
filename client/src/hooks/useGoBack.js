import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

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
