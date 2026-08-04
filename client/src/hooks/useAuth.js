import { useSelector, useDispatch } from 'react-redux'
import { useCallback } from 'react'
import { setCredentials, logout as logoutAction, updateUser } from '@/redux/slices/authSlice'
import { authService } from '@/api/services'

// Auth helper hook: exposes user, role checks, and login/logout actions.
export function useAuth() {
  const dispatch = useDispatch()
  const { user, isAuthenticated } = useSelector((s) => s.auth)

  const login = useCallback(
    async (credentials) => {
      const data = await authService.login(credentials)
      dispatch(setCredentials(data))
      return data
    },
    [dispatch]
  )

  const logout = useCallback(() => dispatch(logoutAction()), [dispatch])
  const patchUser = useCallback((partial) => dispatch(updateUser(partial)), [dispatch])

  const hasRole = useCallback(
    (roles) => {
      if (!roles) return true
      if (!user) return false
      return Array.isArray(roles) ? roles.includes(user.role) : user.role === roles
    },
    [user]
  )

  return { user, isAuthenticated, login, logout, patchUser, hasRole }
}
