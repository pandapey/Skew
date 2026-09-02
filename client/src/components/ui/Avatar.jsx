import { cn, initials, colorFromString } from '@/utils'

function resolveSrc(src) {
  if (!src || typeof src !== 'string') return src
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  if (src.startsWith('/uploads') || src.startsWith('/chat-uploads') || src.startsWith('/profile-uploads')) {
    const base = (import.meta.env.VITE_API_BASE_URL || 'https://skew-server-317n.onrender.com/api').replace(/\/api$/, '')
    return `${base}${src}`
  }
  // Drive fileId (no slash, long alphanumeric) -> proxy via server (works without public share)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(src) && !src.includes('.')) {
    const base = (import.meta.env.VITE_API_BASE_URL || 'https://skew-server-317n.onrender.com/api').replace(/\/api$/, '')
    return `${base}/api/auth/avatar/${src}`
  }
  return src
}

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
