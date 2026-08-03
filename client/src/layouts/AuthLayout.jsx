import { Outlet, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { APP_NAME, COMPANY_NAME } from '@/constants'

// Full-bleed gradient hero with a floating glass auth card on top.
export function AuthLayout() {
  const { isAuthenticated } = useAuth()
  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-gradient-to-br from-primary via-[#1e3a8a] to-accent">
      {/* Decorative aurora blobs */}
      <div
        className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/20 blur-3xl animate-aurora"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-20 top-1/4 h-80 w-80 rounded-full bg-black/20 blur-3xl animate-drift"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-24 left-1/3 h-96 w-96 rounded-full bg-violet/30 blur-3xl animate-float-slow"
        aria-hidden="true"
      />
      <div className="dot-grid opacity-40" aria-hidden="true" />
      <div className="noise-overlay" aria-hidden="true" />

      {/* Top brand bar */}
      <header className="relative z-20 flex items-center justify-between px-6 py-5 text-white sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-lg font-bold backdrop-blur">
            S
          </div>
          <span className="text-base font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <span className="hidden text-sm text-white/70 sm:block">{COMPANY_NAME}</span>
      </header>

      {/* Centered floating form card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="glass-strong w-full max-w-md rounded-3xl p-7 shadow-floating sm:p-9"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}
