import { Outlet, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { GlassBackground } from '@/components/glass/GlassBackground'
import { ScrollMemory } from '@/components/ScrollMemory'
import { COMPANY_NAME } from '@/constants'

// Main authenticated shell: floating glass sidebar + navbar + routed content.
export function DashboardLayout() {
  const { pathname } = useLocation()

  // Phase 6.2 (Task 8): the page-visit tracking effect that used to live here
  // existed solely to feed the "Frequently Visited" and "Continue Where You
  // Left Off" dashboard cards. Both cards are removed, so the effect, its
  // trackVisit action, and the recentPages / pageVisitCounts state it wrote to
  // are all deleted rather than left running with no reader.

  return (
    <div className="relative flex h-screen overflow-hidden">
      <GlassBackground />
      {/* Phase 5.5 (Task 7): mounted here, OUTSIDE the routed Outlet, so it
          survives navigation and can observe every route change from one
          place instead of being duplicated across ~88 pages. */}
      <ScrollMemory />
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Navbar />
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
            &copy; {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
          </footer>
        </main>
      </div>
    </div>
  )
}
