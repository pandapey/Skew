import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { FiMenu, FiMoon, FiSun, FiSearch, FiLogOut, FiUser, FiSettings } from 'react-icons/fi'
import { toggleSidebar, toggleTheme } from '@/redux/slices/uiSlice'
import { ROLES } from '@/constants'
import { useAuth } from '@/hooks/useAuth'
import { Avatar, Dropdown, DropdownItem } from '@/components/ui'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { ClientNotificationBell } from '@/features/client/ClientNotificationBell'

export function Navbar() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const theme = useSelector((s) => s.ui.theme)
  const searchRef = useRef(null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const goSearch = (q) => navigate('/search?q=' + encodeURIComponent(q))
  // The global search aggregates internal data, so it is staff-only. Clients
  // get a spacer instead (they have their own scoped views).
  const isClient = user?.role === ROLES.CLIENT
  // PHASE 622 CLEANUP: the former `isEmployee` flag was deleted. Its ONLY
  // consumer was the old exclusion-based Settings condition, which is now the
  // `canSeeSettings` allow-list below, so the variable became dead code.
  // ROOT CAUSE (originally PHASE NEXT TASK 3, completed here in PHASE 622):
  // the "Settings" item navigates to '/admin', and routes/index.jsx gates
  // route('/admin', ...) to [ROLES.ADMIN]. The menu was originally gated by
  // exclusion (`!isClient && !isEmployee`), so every staff role that is not an
  // Admin saw a Settings entry that could only ever land them on /403. That is
  // DEAD NAVIGATION, not a missing permission - the menu condition and the
  // route guard had drifted apart.
  //
  // PHASE 622 (TASK 1): HR is now removed from this allow-list for exactly the
  // same reason Manager was: '/admin' is Admin-only, so the entry was already
  // non-functional for HR. This is the LAST role to be reconciled, so the menu
  // and the route guard are now identical: Settings === Admin.
  //
  // This is real role-based menu configuration, not a CSS hide: the
  // <DropdownItem> is never rendered for HR. The '/admin' route guard itself is
  // deliberately NOT touched, and no other role's menu changes.
  const canSeeSettings = user?.role === ROLES.ADMIN

  return (
    <header className="sticky top-0 z-30 mx-3 mt-3">
      <div className="glass flex h-16 items-center gap-3 rounded-card px-3 shadow-floating-sm sm:px-4">
        <button
          className="rounded-xl p-2 text-muted transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10 lg:hidden"
          onClick={() => dispatch(toggleSidebar())}
          aria-label="Toggle menu"
        >
          <FiMenu />
        </button>

        {/* Global search (staff only) */}
        {isClient ? (
          <div className="flex-1" />
        ) : (
          <div className="relative hidden max-w-md flex-1 md:block">
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              className="input pl-9 pr-4"
              placeholder="Search employees, projects, clients…"
              onKeyDown={(e) => e.key === 'Enter' && goSearch(e.target.value)}
              aria-label="Global search"
            />
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Theme toggle */}
          <button
            onClick={() => dispatch(toggleTheme())}
            className="rounded-xl p-2 text-muted transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <FiSun /> : <FiMoon />}
          </button>

          {/* Notifications (client-scoped for clients, staff otherwise) */}
          {isClient ? <ClientNotificationBell /> : <NotificationBell />}

          {/* User menu */}
          <Dropdown
            trigger={
              <div className="flex items-center gap-2 rounded-xl p-1 pr-2 transition hover:bg-black/5 dark:hover:bg-white/10">
                <Avatar name={user?.name} src={user?.avatar} size={34} />
                <div className="hidden text-left sm:block">
                  <p className="text-sm font-semibold leading-tight">{user?.name}</p>
                  <p className="text-[11px] text-muted">{user?.role}</p>
                </div>
              </div>
            }
          >
            <div className="border-b border-app px-3 py-2">
              <p className="text-sm font-semibold">{user?.name}</p>
              <p className="text-xs text-muted">{user?.email}</p>
            </div>
            <DropdownItem icon={FiUser} onClick={() => navigate(isClient ? '/client/profile' : '/profile')}>
              My Profile
            </DropdownItem>
            {canSeeSettings && (
              <DropdownItem icon={FiSettings} onClick={() => navigate('/admin')}>
                Settings
              </DropdownItem>
            )}
            <DropdownItem icon={FiLogOut} danger onClick={handleLogout}>
              Logout
            </DropdownItem>
          </Dropdown>
        </div>
      </div>
    </header>
  )
}
