import { motion } from 'framer-motion'
import { Card } from '@/components/ui'

// Leave balance cards with a radial-style usage bar per type.
//
// Phase 6.9 (TASK 4): each card now also shows "Requested", the number of days
// currently sitting in PENDING requests for that leave type. The figure is
// supplied by leaveService.balances() (derived from the real LeaveRequest
// documents) and arrives on the SAME ['leave-balances'] query the cards already
// consume, so no extra request and no new endpoint were introduced. It is kept
// visually distinct from Used because pending days are not yet deducted from
// the available balance.
export function BalanceCards({ balances = [] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {balances.map((b, i) => {
        const pct = b.allocated ? Math.round((b.used / b.allocated) * 100) : 0
        return (
          <motion.div key={b.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                {/* Phase 6.12 (TASK 4): the card heading now carries the FULL
                    leave-type name ("Casual Leave") instead of the abbreviated
                    code ("CL"). `b.type` and `b.code` both already arrive on the
                    SAME ['leave-balances'] payload from leaveService.balances(),
                    so this is purely a change of which existing field is
                    rendered - no new request, no new field and no mapping table
                    of abbreviations to expand. */}
                <span className="truncate text-xs font-semibold" style={{ color: b.color }} title={b.type}>{b.type}</span>
                <span className="shrink-0 text-xs text-muted">{b.used}/{b.allocated}</span>
              </div>
              <p className="mt-1 text-2xl font-bold">{b.balance}</p>
              {/* Phase 6.12 (TASK 4): the duplicated full-form line that used to
                  sit under the count was REMOVED - the heading above is now the
                  full name, so repeating it here showed the same text twice. */}
              <p className="mt-0.5 text-[11px] text-muted">Available {b.balance} · Used {b.used}</p>
              {/* Falls back to 0 for any cached response served before the
                  `requested` field existed (backward compatible). */}
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
