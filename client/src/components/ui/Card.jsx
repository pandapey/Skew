import { cn } from '@/utils'

// Glass card container. Optional hover lift + glow.
export function Card({ className, children, hoverable, glow, as: Tag = 'div', ...props }) {
  return (
    <Tag
      className={cn(
        'card p-5',
        hoverable && 'transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-floating',
        glow && 'shadow-glow-primary',
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({ title, subtitle, action, icon: Icon, className }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div>
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
