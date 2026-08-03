import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { NAV_ITEMS } from '@/constants/navigation'
import { APP_NAME } from '@/constants'
import { useAuth } from '@/hooks/useAuth'
import { toggleCollapse, setSidebarOpen } from '@/redux/slices/uiSlice'
import { cn } from '@/utils'

export function Sidebar({ items: propItems }) {
  const dispatch = useDispatch()
  const { hasRole } = useAuth()
  const { sidebarOpen, sidebarCollapsed } = useSelector((s) => s.ui)

  // When a layout passes its own items (e.g. the isolated Client Portal), use
  // them directly. Otherwise derive from NAV_ITEMS filtered by the user's role.
  const items = propItems || NAV_ITEMS.filter((item) => hasRole(item.roles))

  // ---------------------------------------------------------------------------
  // Phase 6.10 (TASK 7) ROOT CAUSE: <NavLink> resolves `isActive` with PREFIX
  // matching unless `end` is passed. Every entry here was rendered without
  // `end`, so an item whose path is a prefix of the current URL stayed lit at
  // the same time as the deeper item the user actually opened:
  //   /client/projects        -> '/client' (Dashboard) AND '/client/projects'
  //   /projects/board         -> '/projects' AND '/projects/board'
  //   /client/projects/:id    -> '/client' AND '/client/projects'
  // Adding `end` to every item would fix the double highlight but BREAK the
  // correct behaviour of keeping a parent lit on its own nested detail pages
  // (e.g. '/client/projects/:id' must keep "My Projects" highlighted).
  //
  // FIX: derive the active item from the pathname itself - a nav item matches
  // when the pathname equals its path or continues past a '/' boundary, and the
  // LONGEST matching path wins. This is computed from the items array, so no
  // route name is hardcoded and every other highlight is preserved, including
  // nested detail routes.
  // ---------------------------------------------------------------------------
  const { pathname } = useLocation()
  const matchLength = (path) => {
    if (!path) return -1
    if (pathname === path) return path.length
    return pathname.startsWith(path.endsWith('/') ? path : `${path}/`) ? path.length : -1
  }
  // Phase 6.19 (TASK 3) ROOT CAUSE FIX: matchLength only ever checked an
  // item's own `path`, so a route with no NAV_ITEMS entry of its own (like
  // /leave, intentionally merged into Attendance \u2014 see
  // constants/navigation.js) matched NO item at all, so nothing highlighted.
  // `itemMatchLength` additionally checks each item's optional `matchPaths`
  // alias list through the SAME longest-match algorithm above \u2014 no second
  // matching rule, and items without `matchPaths` (i.e. every item except
  // Attendance) behave exactly as before.
  const itemMatchLength = (item) =>
    [item.path, ...(item.matchPaths || [])].reduce((best, p) => Math.max(best, matchLength(p)), -1)
  const bestMatch = items.reduce((best, item) => Math.max(best, itemMatchLength(item)), -1)

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => dispatch(setSidebarOpen(false))}
        />
      )}

      <motion.aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-app glass-strong lg:static lg:m-3 lg:h-[calc(100vh-1.5rem)] lg:w-64 lg:rounded-sidebar lg:border lg:shadow-floating',
          sidebarCollapsed && 'lg:w-20',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        transition={{ type: 'spring', duration: 0.4, bounce: 0.12 }}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-2 px-4">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent font-bold text-white shadow-glow-primary">
            S
          </div>
          {!sidebarCollapsed && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold leading-tight">{APP_NAME}</p>
              <p className="truncate text-[11px] text-muted">Skew Infotech Pvt. Ltd.</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((item) => {
            // Computed once per item, then handed to NavLink's render prop below
            // in place of its own prefix-based isActive.
            const active = bestMatch > -1 && itemMatchLength(item) === bestMatch
            return (
            <NavLink
              key={item.key}
              to={item.path}
              onClick={() => dispatch(setSidebarOpen(false))}
              title={sidebarCollapsed ? item.label : undefined}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                sidebarCollapsed && 'justify-center'
              )}
            >
              {() => {
                const isActive = active
                return (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary to-accent shadow-glow-primary"
                      transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
                    />
                  )}
                  <item.icon
                    className={cn(
                      'relative z-10 h-5 w-5 flex-none transition-colors',
                      isActive ? 'text-white' : 'text-muted group-hover:text-current'
                    )}
                  />
                  {!sidebarCollapsed && (
                    <span className={cn('relative z-10', isActive && 'text-white')}>{item.label}</span>
                  )}
                </>
                )
              }}
            </NavLink>
            )
          })}
        </nav>

        {/* Collapse toggle (desktop) */}
        <button
          onClick={() => dispatch(toggleCollapse())}
          className="hidden items-center justify-center gap-2 border-t border-app py-3 text-sm text-muted transition hover:text-primary lg:flex"
        >
          {sidebarCollapsed ? (
            <FiChevronRight />
          ) : (
            <>
              <FiChevronLeft className="transition" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </motion.aside>
    </>
  )
}
