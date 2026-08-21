import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

// Guards routes: requires auth, optionally a role. Redirects to /login or /403.
export function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, hasRole } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  if (roles && !hasRole(roles)) {
    return <Navigate to="/403" replace />
  }
  return children
}
