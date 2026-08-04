import { cn } from '@/utils'
import { Card, CardHeader } from '../ui/Card'

// Glass container for a chart with a frosted header.
export function GlassChartContainer({ title, subtitle, action, icon, children, className, bodyClassName }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader title={title} subtitle={subtitle} action={action} icon={icon} />
      <div className={cn('flex-1', bodyClassName)}>{children}</div>
    </Card>
  )
}
