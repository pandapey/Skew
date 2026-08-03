import { cn, initials, colorFromString } from '@/utils'

// Resolve a DB-relative "/uploads/..." avatar path to an absolute backend URL.
// Static uploads are served from the API origin (not under /api), while the
// frontend runs on a different origin, so a raw "/uploads/x" would 404. Keeping
// this here lets user.avatar be stored as the relative path everywhere (Navbar,
// Dashboard, Profile) and still render after a refresh (#2). Absolute/data/blob
// URLs (e.g. an unsaved local preview) pass through untouched.
function resolveSrc(src) {
  if (!src || typeof src !== 'string') return src
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  if (src.startsWith('/uploads')) {
    const base = (import.meta.env.VITE_API_BASE_URL || 'https://skew-server-tkkj.onrender.com/api').replace(/\/api$/, '')
    return `${base}${src}`
  }
  return src
}

// Avatar with image fallback to colored initials + glass ring.
export function Avatar({ name = '', src, size = 40, className, ring = true }) {
  const dimension = { width: size, height: size }
  const ringCls = ring ? 'ring-2 ring-white/40 dark:ring-white/10' : ''
  const resolved = resolveSrc(src)
  if (resolved) {
    return (
      <img
        src={resolved}
        alt={name}
        style={dimension}
        className={cn('rounded-full object-cover shadow-floating-sm', ringCls, className)}
      />
    )
  }
  return (
    <div
      style={{ ...dimension, backgroundColor: colorFromString(name) }}
      className={cn('flex items-center justify-center rounded-full font-semibold text-white shadow-inner-light', ringCls, className)}
    >
      <span style={{ fontSize: size * 0.4 }}>{initials(name)}</span>
    </div>
  )
}
