import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { FiSettings, FiChevronRight } from 'react-icons/fi'
import { ADMIN_SECTIONS } from '@/features/admin/constants'
import { cn } from '@/utils'

// Admin shell: a responsive glass section rail (vertical on desktop,
// horizontal scroll on mobile) plus the routed sub-page via <Outlet/>.
export default function AdminLayout() {
  const { pathname } = useLocation()

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Section rail */}
      <aside className="lg:sticky lg:top-4 lg:w-60 lg:shrink-0">
        <div className="glass flex items-center gap-2 rounded-card p-3 lg:hidden">
          <FiSettings className="text-primary" />
          <span className="text-sm font-semibold">Admin Console</span>
        </div>

        <nav className="glass mt-0 flex gap-2 overflow-x-auto p-2 lg:mt-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:rounded-card lg:p-2 lg:shadow-soft">
          {ADMIN_SECTIONS.map((s) => {
            const active = pathname === s.path || pathname.startsWith(s.path + '/')
            return (
              <NavLink
                key={s.key}
                to={s.path}
                className={cn(
                  'group relative flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition lg:w-full',
                  active ? 'text-primary' : 'text-muted hover:bg-black/5 hover:text-current dark:hover:bg-white/5'
                )}
              >
                {active && (
                  <span className="absolute inset-0 rounded-xl bg-primary/10 lg:block" />
                )}
                <s.icon
                  className={cn('relative z-10 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted group-hover:text-primary')}
                />
                <span className="relative z-10 whitespace-nowrap">{s.label}</span>
                <FiChevronRight
                  className={cn(
                    'relative z-10 ml-auto hidden h-3.5 w-3.5 lg:block',
                    active ? 'text-primary/70' : 'text-transparent'
                  )}
                />
              </NavLink>
            )
          })}
        </nav>
      </aside>

      {/* Routed sub-page */}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
