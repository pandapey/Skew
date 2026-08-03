import { motion } from 'framer-motion'
import { FiArrowUpRight, FiArrowDownRight } from 'react-icons/fi'
import { cn } from '@/utils'
import { AnimatedNumber } from './AnimatedNumber'

// KPI stat card used across dashboards and module headers.
// Phase 6.9 (Task 20): `onClick` is a new, fully OPTIONAL prop. Every existing
// call site across the app (40+ usages) omits it and renders byte-for-byte
// identical to before. Only dashboard KPI cards that pass `onClick` become
// keyboard- and click-navigable, which is how "clicking every card must
// navigate to the correct page" is satisfied without touching any of the
// other call sites or duplicating this component.
// Phase 6.11 (TASK 3): `className` is a new, fully OPTIONAL pass-through prop,
// added for the same reason `onClick` was in Phase 6.9 - every one of the 40+
// existing call sites omits it and renders byte-for-byte identically, because
// cn() simply appends nothing when it is undefined. It exists so a KPI grid can
// tell one card to span the leftover columns instead of leaving a blank cell,
// which is strictly a layout concern of the CALLER. The alternative (a second
// StatCard variant, or a wrapper div around the card) would have duplicated a
// shared component or broken the grid's direct parent-child relationship.
export function StatCard({ label, value, icon: Icon, trend, tone = 'primary', delay = 0, format, onClick, className }) {
  const tones = {
    primary: 'bg-primary/12 text-primary',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/12 text-warning',
    danger: 'bg-danger/12 text-danger',
    accent: 'bg-accent/12 text-accent',
  }
  const toneGlow = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    accent: 'bg-accent',
  }
  // Only show the trend chip when a real, finite number was computed and
  // passed in. Never fabricate a "vs last month" delta.
  const hasTrend = typeof trend === 'number' && Number.isFinite(trend)
  const up = trend >= 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn('card group relative overflow-hidden p-5', onClick && 'cursor-pointer transition hover:-translate-y-0.5 hover:border-primary/40', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div
        className={cn(
          'pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-60',
          toneGlow[tone]
        )}
      />
      <div className="relative flex items-start justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            <AnimatedNumber value={value} format={format} />
          </p>
        </div>
        {Icon && (
          <div className={cn('flex h-12 w-12 flex-none items-center justify-center rounded-2xl shadow-inner-light', tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {hasTrend && (
        <p className={cn('relative mt-3 flex items-center gap-1 text-xs font-semibold', up ? 'text-success' : 'text-danger')}>
          {up ? <FiArrowUpRight className="h-3.5 w-3.5" /> : <FiArrowDownRight className="h-3.5 w-3.5" />}
          {Math.abs(trend)}% <span className="font-normal text-muted">vs last month</span>
        </p>
      )}
    </motion.div>
  )
}
