import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ADMIN_SECTIONS } from '@/features/admin/constants'
import { cn } from '@/utils'

export default function AdminLayout() {
  const { pathname } = useLocation()
  return (
    <div>
      {/* Horizontal section tabs - Reports-style */}
      <nav className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {ADMIN_SECTIONS.map((s) => {
          const active = s.match === 'exact'
            ? pathname === s.path
            : pathname === s.path || pathname.startsWith(s.path + '/')
          return (
            <NavLink
              key={s.key}
              to={s.path}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition',
                active
                  ? 'bg-primary text-white shadow-soft'
                  : 'bg-black/5 text-muted hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10'
              )}
            >
              <s.icon className="h-4 w-4" /> {s.label}
            </NavLink>
          )
        })}
      </nav>

      {/* Routed sub-page */}
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}