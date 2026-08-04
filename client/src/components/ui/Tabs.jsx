import { useState, useId } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/utils'

// Glass segmented-control tabs. items = [{ key, label }]. Controlled or uncontrolled.
export function Tabs({ items, value, onChange, className }) {
  const [internal, setInternal] = useState(items[0]?.key)
  const active = value ?? internal
  const pid = useId()
  const setActive = (k) => {
    setInternal(k)
    onChange?.(k)
  }
  return (
    <div
      className={cn(
        'inline-flex gap-1 rounded-card border border-app bg-black/[0.03] p-1 dark:bg-white/[0.04]',
        className
      )}
      role="tablist"
    >
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={active === item.key}
          onClick={() => setActive(item.key)}
          className={cn(
            'relative rounded-xl px-4 py-2 text-sm font-medium transition',
            active === item.key ? 'text-primary' : 'text-muted hover:text-current'
          )}
        >
          {active === item.key && (
            <motion.span
              layoutId={pid}
              className="absolute inset-0 rounded-xl bg-surface shadow-soft"
              transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
            />
          )}
          <span className="relative z-10">{item.label}</span>
        </button>
      ))}
    </div>
  )
}
