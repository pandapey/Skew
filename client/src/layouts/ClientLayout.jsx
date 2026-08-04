import { Outlet, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { GlassBackground } from '@/components/glass/GlassBackground'
import { ScrollMemory } from '@/components/ScrollMemory'
import { CLIENT_NAV } from '@/constants/navigation'
import { COMPANY_NAME } from '@/constants'

// Isolated shell for the Client Portal. Reuses the exact same glass chrome as
// the staff DashboardLayout (background, navbar, animated outlet, footer) but
// renders the Client-specific sidebar and is gated to the Client role, so
// clients never see internal staff modules.
export function ClientLayout() {
  const { pathname } = useLocation()
  return (
    <div className="relative flex h-screen overflow-hidden">
      <GlassBackground />
      {/* Phase 5.5 (Task 7): same scroll memory as the staff shell. */}
      <ScrollMemory />
      <Sidebar items={CLIENT_NAV} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Navbar />
        {/* id must match DashboardLayout so ScrollMemory has a single,
            shared selector for the real scroll container. */}
        <main id="main-content" className="flex-1 overflow-y-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6"
          >
            <Outlet />
          </motion.div>
          <footer className="border-t border-app px-6 py-4 text-center text-xs text-muted backdrop-blur-sm">
            © {new Date().getFullYear()} {COMPANY_NAME}. Client Portal.
          </footer>
        </main>
      </div>
    </div>
  )
}
