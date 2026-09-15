import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function useGoBack(overrideParent) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const parts = pathname.split('/').filter(Boolean)

  const defaultParent = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/dashboard'
  const parentPath = overrideParent || defaultParent

  const isRoot = parts.length === 0 || (parts.length === 1 && parts[0] === 'dashboard')

  const goBack = useCallback(() => {
    const idx = window.history.state?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(parentPath)
  }, [navigate, parentPath])

  return { goBack, parentPath, isRoot }
}

export default useGoBack
