import { Link, useLocation } from 'react-router-dom'
import { FiChevronRight, FiHome } from 'react-icons/fi'

// Auto-generated breadcrumb from the current path.
export function Breadcrumb() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean)

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-medium text-muted">
      <Link to="/dashboard" className="rounded-md p-0.5 transition hover:text-primary" aria-label="Home">
        <FiHome className="h-3.5 w-3.5" />
      </Link>
      {parts.map((part, i) => {
        const to = '/' + parts.slice(0, i + 1).join('/')
        const label = part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ')
        const last = i === parts.length - 1
        return (
          <span key={to} className="flex items-center gap-1.5">
            <FiChevronRight className="h-3 w-3 opacity-60" />
            {last ? (
              <span className="font-semibold text-current">{label}</span>
            ) : (
              <Link to={to} className="rounded-md px-1 py-0.5 transition hover:bg-black/5 hover:text-primary dark:hover:bg-white/10">
                {label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
