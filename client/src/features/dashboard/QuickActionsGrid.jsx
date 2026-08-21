import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FiLogIn, FiLogOut, FiUserCheck, FiCalendar, FiCheckSquare,
} from 'react-icons/fi'
import { CardHeader } from '@/components/ui'
import { GlassWidget } from '@/components/glass'
import { attendanceApi } from '@/api/services'
import { cn } from '@/utils'

export function QuickActionsGrid() {
  const navigate = useNavigate()
  const { data: today } = useQuery({
    queryKey: ['attendance', 'today', 'quick-actions'],
    queryFn: attendanceApi.today,
    staleTime: 30_000,
  })

  const checkedIn = !!today?.checkIn && !today?.checkOut

  const actions = [
    {
      label: checkedIn ? 'Check Out' : 'Check In',
      icon: checkedIn ? FiLogOut : FiLogIn,
      onSelect: () => navigate('/attendance'),
    },
    { label: 'Apply Leave', icon: FiUserCheck, onSelect: () => navigate('/attendance/leave') },
    { label: 'Open Calendar', icon: FiCalendar, onSelect: () => navigate('/calendar') },
    { label: 'My Tasks', icon: FiCheckSquare, onSelect: () => navigate('/my-tasks') },
  ]

  return (
    <GlassWidget>
      <CardHeader title="Quick Actions" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={a.disabled}
            title={a.hint}
            aria-label={a.disabled ? `${a.label} — ${a.hint}` : a.label}
            onClick={a.onSelect}
            className={cn(
              'group flex flex-col items-center gap-2 rounded-2xl border border-app bg-black/[0.02] p-4 text-center text-sm font-medium transition dark:bg-white/[0.03]',
              a.disabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:-translate-y-0.5 hover:border-primary hover:bg-primary/5 focus-visible:-translate-y-0.5 focus-visible:border-primary'
            )}
          >
            <span
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition',
                !a.disabled && 'group-hover:bg-primary group-hover:text-white'
              )}
            >
              <a.icon className="h-5 w-5" />
            </span>
            {a.label}
          </button>
        ))}
      </div>
    </GlassWidget>
  )
}
