import { FiCheck, FiX } from 'react-icons/fi'
import { ADMIN_MODULES } from '@/features/admin/constants'
import { cn } from '@/utils'

// Readable permission list for a single role, derived from the permission
// matrix ({ role: { module: 'Full' | 'View' | 'Deny' } }).
// Renders each module with a ✓ (Full / View) or ✗ (Deny) marker.
export function PermissionsList({ matrix, role, className }) {
  if (!matrix || !role) {
    return <p className="text-sm text-muted">Permissions unavailable.</p>
  }
  const perms = matrix[role] || {}
  return (
    <ul className={cn('grid grid-cols-1 gap-1.5 sm:grid-cols-2', className)}>
      {ADMIN_MODULES.map((mod) => {
        const level = perms[mod] || 'Deny'
        const allowed = level !== 'Deny'
        return (
          <li
            key={mod}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm',
              allowed
                ? 'border-success/20 bg-success/[0.06] text-foreground'
                : 'border-app bg-black/[0.02] text-muted dark:bg-white/[0.02]'
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 flex-none items-center justify-center rounded-full',
                allowed ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
              )}
              aria-hidden="true"
            >
              {allowed ? <FiCheck className="h-3 w-3" /> : <FiX className="h-3 w-3" />}
            </span>
            <span className="flex-1 truncate">{mod}</span>
            {allowed && (
              <span className={cn('chip text-[10px]', level === 'Full' ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent')}>
                {level}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default PermissionsList
