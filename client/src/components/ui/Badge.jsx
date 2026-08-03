import { Children, isValidElement } from 'react'
import { cn } from '@/utils'

// Status/label badge. Pass a semantic tone or explicit color.
const tones = {
  default: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
  accent: 'bg-accent/12 text-accent',
}

const dotTone = {
  default: 'bg-slate-400',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  accent: 'bg-accent',
}

// Map common status strings to tones.
const statusMap = {
  Active: 'success', Present: 'success', Approved: 'success', 'In Stock': 'success', Won: 'success', Done: 'success', Completed: 'success',
  Pending: 'warning', 'On Hold': 'warning', Late: 'warning', Review: 'warning', 'On Leave': 'warning', 'Low Stock': 'warning',
  Rejected: 'danger', Absent: 'danger', Lost: 'danger', Urgent: 'danger', High: 'danger',
  'In Progress': 'primary', Contacted: 'primary', Qualified: 'accent', Medium: 'accent', New: 'primary',
}

export function Badge({ children, tone, className }) {
  const resolved = tone || statusMap[String(children)] || 'default'
  const hasIcon = Children.toArray(children).some((c) => isValidElement(c))
  return (
    <span className={cn('chip', tones[resolved], className)}>
      {!hasIcon && <span className={cn('h-1.5 w-1.5 rounded-full', dotTone[resolved])} />}
      {children}
    </span>
  )
}
