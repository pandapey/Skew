import { FiCheck, FiX } from 'react-icons/fi'
import { cn } from '@/utils'
import { validatePassword, strength } from './password'

const META = {
  Weak: { pct: 25, tone: 'bg-danger', label: 'Weak', text: 'text-danger' },
  Medium: { pct: 50, tone: 'bg-warning', label: 'Medium', text: 'text-warning' },
  Strong: { pct: 75, tone: 'bg-primary', label: 'Strong', text: 'text-primary' },
  Excellent: { pct: 100, tone: 'bg-success', label: 'Excellent', text: 'text-success' },
}

// Live password-strength meter + policy checklist. Renders nothing when empty.
export function PasswordStrength({ value = '' }) {
  if (!value) return null
  const { errors } = validatePassword(value)
  const lvl = strength(value)
  const meta = META[lvl] || META.Weak

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <div className={cn('h-full rounded-full transition-all duration-300', meta.tone)} style={{ width: `${meta.pct}%` }} />
        </div>
        <span className={cn('text-xs font-semibold', meta.text)}>{meta.label}</span>
      </div>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {errors.map((e) => (
          <li key={e.id} className={cn('flex items-center gap-1.5 text-xs', e.passed ? 'text-success' : 'text-muted')}>
            {e.passed ? <FiCheck className="h-3.5 w-3.5" /> : <FiX className="h-3.5 w-3.5" />}
            {e.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
