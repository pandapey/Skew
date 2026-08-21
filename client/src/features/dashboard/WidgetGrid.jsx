import { Suspense, memo } from 'react'
import { CardSkeleton } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { WIDGET_REGISTRY } from './widgetRegistry'

const SPAN = {
  sm: 'lg:col-span-1',
  md: 'lg:col-span-1',
  lg: 'lg:col-span-2',
  full: 'lg:col-span-3',
}

function WidgetGridImpl({ layout }) {
  const { hasRole } = useAuth()

  const visible = WIDGET_REGISTRY.filter(
    (w) => !layout.hidden.includes(w.id) && (w.minRoles ? hasRole(w.minRoles) : true)
  )
  const byId = Object.fromEntries(visible.map((w) => [w.id, w]))

  // Pinned widgets first (in their saved relative order), then the rest.
  const orderedIds = layout.order.filter((id) => byId[id])
  const pinned = orderedIds.filter((id) => layout.pinned.includes(id))
  const rest = orderedIds.filter((id) => !layout.pinned.includes(id))
  const ordered = [...pinned, ...rest]

  if (!ordered.length) return null

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {ordered.map((id) => {
        const widget = byId[id]
        const Widget = widget.component
        return (
          <div key={id} className={SPAN[widget.size] || SPAN.md}>
            <Suspense fallback={<CardSkeleton />}>
              <Widget />
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}

export const WidgetGrid = memo(WidgetGridImpl)
