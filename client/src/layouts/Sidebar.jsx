import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import { useQuery } from '@tanstack/react-query'
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { NAV_ITEMS } from '@/constants/navigation'
import { BrandLogo } from '@/components/branding/BrandLogo'
import { useAuth } from '@/hooks/useAuth'
import { projectApi, announcementApi } from '@/api/services'
import { chatApi } from '@/api/chatService'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { ROLES } from '@/constants'
import { toggleCollapse, setSidebarOpen } from '@/redux/slices/uiSlice'
import { cn } from '@/utils'

function useSidebarBadges(hasRole, user) {
  const { unreadCount: notifUnread } = useNotifications()
  const myTasks = useQuery({
    queryKey: ['tasks', 'mine-count'],
    queryFn: projectApi.myTasksCount,
    enabled: Boolean(user) && hasRole(ROLES.EMPLOYEE),
    select: (res) => res?.count ?? 0,
  })
  const chat = useQuery({
    queryKey: ['chat-unread-count'],
    queryFn: chatApi.unreadCount,
    enabled: Boolean(user),
    select: (res) => res?.count ?? 0,
  })
  // PHASE: EMPLOYEE ANNOUNCEMENT READ STATE — server-computed count of posts
  // this user hasn't opened yet. Enabled for every internal role (the feed is
  // part of the employee workspace); Client has no /announcements route.
  const announcements = useQuery({
    queryKey: ['announcements', 'unread-count'],
    queryFn: announcementApi.unreadCount,
    enabled: Boolean(user),
    select: (res) => res?.count ?? 0,
  })
  return {
    'my-tasks': myTasks.data || 0,
    chat: chat.data || 0,
    announcements: announcements.data || 0,
    notifications: notifUnread || 0,
  }
}

export function Sidebar({ items: propItems }) {
  const dispatch = useDispatch()
  const { hasRole, user } = useAuth()
  const { sidebarOpen, sidebarCollapsed } = useSelector((s) => s.ui)
  const badges = useSidebarBadges(hasRole, user)

  const items = propItems || NAV_ITEMS.filter((item) => hasRole(item.roles))

  const { pathname } = useLocation()
  const matchLength = (path) => {
    if (!path) return -1
    if (pathname === path) return path.length
    return pathname.startsWith(path.endsWith('/') ? path : `${path}/`) ? path.length : -1
  }

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
        <div className={cn('flex h-16 items-center px-4', sidebarCollapsed && 'justify-center px-0')}>
          {sidebarCollapsed ? (
            <BrandLogo variant="favicon" className="h-8 w-8 flex-none" alt="Company favicon" />
          ) : (
            <BrandLogo className="h-8 w-auto flex-none" alt="Company logo" />
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((item) => {
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
                  {!sidebarCollapsed && item.badge && badges[item.badge] > 0 && (
                    <span
                      className={cn(
                        'relative z-10 ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white',
                        isActive ? 'bg-white/25' : 'bg-danger',
                      )}
                    >
                      {badges[item.badge] > 99 ? '99+' : badges[item.badge]}
                    </span>
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
