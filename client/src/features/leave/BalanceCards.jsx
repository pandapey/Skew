import { motion } from 'framer-motion'
import { Card } from '@/components/ui'

export function BalanceCards({ balances = [] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {balances.map((b, i) => {
        const pct = b.allocated ? Math.round((b.used / b.allocated) * 100) : 0
        return (
          <motion.div key={b.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="truncate text-xs font-semibold" style={{ color: b.color }} title={b.type}>{b.type}</span>
                <span className="shrink-0 text-xs text-muted">{b.used}/{b.allocated}</span>
              </div>
              <p className="mt-1 text-2xl font-bold">{b.balance}</p>

              <p className="mt-0.5 text-[11px] text-muted">Available {b.balance} · Used {b.used}</p>

              <p className={`text-[11px] ${b.requested > 0 ? 'font-medium text-warning' : 'text-muted'}`}>
                Requested {b.requested || 0}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: b.color }} />
              </div>
            </Card>
          </motion.div>
        )
      })}
    </div>
  )
}
