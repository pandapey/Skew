import { cn } from '@/utils'
import { Card, CardHeader } from '../ui/Card'

// Glass card that frames a (solid) table. `header` renders an optional
// title/actions row; `children` is expected to be a DataTable or similar.
export function GlassTableContainer({ title, subtitle, action, icon, header, children, className, bodyClassName }) {
  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      {(header || title || action) && (
        <div className="border-b border-app p-5">
          {header || <CardHeader title={title} subtitle={subtitle} action={action} icon={icon} />}
        </div>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </Card>
  )
}
