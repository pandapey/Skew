import { motion } from 'framer-motion'
import { cn } from '@/utils'

// Glass progress bar with gradient fill + shimmer sweep.
const auto = (v) =>
  v >= 100
    ? ['#10B981', '#059669']
    : v >= 60
      ? ['#2563EB', '#1D4ED8']
      : v >= 30
        ? ['#F59E0B', '#D97706']
        : ['#EF4444', '#DC2626']

export function ProgressBar({ value = 0, color, className, showLabel = false, height = 'h-2', animated = true }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  const [c1, c2] = color ? [color, color] : auto(v)
  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-xs text-muted">
          <span>Progress</span>
          <span className="font-semibold text-current">{v}%</span>
        </div>
      )}
      <div className={cn('relative overflow-hidden rounded-full bg-black/10 dark:bg-white/10', height)}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${c1}, ${c2})` }}
          initial={animated ? { width: 0 } : false}
          animate={{ width: `${v}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
        <div className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      </div>
    </div>
  )
}
