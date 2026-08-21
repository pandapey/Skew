import { Outlet, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'

export function AuthLayout() {
  const { isAuthenticated } = useAuth()
  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  return (
    <div className="relative min-h-screen w-full">
      {/* The Login page now handles its own full-screen layout,
          background, and animations. This layout just provides
          the route outlet without any constraining wrapper. */}
      <Outlet />
    </div>
  )
}