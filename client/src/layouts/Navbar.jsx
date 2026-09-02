import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { FiMenu, FiMoon, FiSun, FiSearch, FiLogOut, FiUser, FiSettings } from 'react-icons/fi'
import { toggleSidebar, toggleTheme } from '@/redux/slices/uiSlice'
import { ROLES } from '@/constants'
import { useAuth } from '@/hooks/useAuth'
import { Avatar, Dropdown, DropdownItem } from '@/components/ui'
import { BrandLogo } from '@/components/branding/BrandLogo'
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
  const isClient = user?.role === ROLES.CLIENT
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

        {/* Brand mark — mobile only, where the sidebar (and its logo) is hidden */}
        <BrandLogo className="h-7 w-auto lg:hidden" alt="Company logo" />

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

          {/* Direct Logout button — always visible as last item on right for all roles */}
          <div className="ml-1 hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" aria-hidden />
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-xl bg-danger px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-danger/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30"
            aria-label="Logout"
            title="Logout"
          >
            <FiLogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  )
}
