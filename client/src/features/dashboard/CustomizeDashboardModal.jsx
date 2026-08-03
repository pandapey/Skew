import { FiArrowUp, FiArrowDown, FiStar, FiEye, FiEyeOff, FiRotateCcw } from 'react-icons/fi'
import { Modal, Button, Badge } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useWorkspace } from '@/services/workspace/workspaceService'
import { WIDGET_REGISTRY } from './widgetRegistry'
import { cn } from '@/utils'

// Reorder (↑/↓) + hide/show + pin controls for dashboard widgets. Deliberately
// not drag-and-drop: no DnD library exists in the project today, and plain
// buttons deliver the same reorder/hide/pin capability with full keyboard
// support and no new dependency.
export function CustomizeDashboardModal({ open, onClose }) {
  const { hasRole } = useAuth()
  const { layout, actions } = useWorkspace()

  const available = WIDGET_REGISTRY.filter((w) => (w.minRoles ? hasRole(w.minRoles) : true))
  const orderedIds = layout.order.filter((id) => available.some((w) => w.id === id))

  return (
    <Modal open={open} onClose={onClose} title="Customize Dashboard" size="lg" footer={
      <Button variant="ghost" icon={FiRotateCcw} onClick={actions.resetLayout}>
        Reset to default
      </Button>
    }>
      <ul className="space-y-2">
        {orderedIds.map((id, i) => {
          const widget = available.find((w) => w.id === id)
          const hidden = layout.hidden.includes(id)
          const pinned = layout.pinned.includes(id)
          return (
            <li
              key={id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-2xl border border-app p-3',
                hidden && 'opacity-50'
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{widget.title}</span>
                {pinned && <Badge tone="primary">Pinned</Badge>}
              </div>
              <div className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${widget.title} up`}
                  disabled={i === 0}
                  onClick={() => actions.reorderWidget(id, 'up')}
                  className="rounded-lg p-2 text-muted transition hover:bg-black/5 hover:text-current disabled:opacity-30 dark:hover:bg-white/10"
                >
                  <FiArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${widget.title} down`}
                  disabled={i === orderedIds.length - 1}
                  onClick={() => actions.reorderWidget(id, 'down')}
                  className="rounded-lg p-2 text-muted transition hover:bg-black/5 hover:text-current disabled:opacity-30 dark:hover:bg-white/10"
                >
                  <FiArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={pinned ? `Unpin ${widget.title}` : `Pin ${widget.title} to top`}
                  aria-pressed={pinned}
                  onClick={() => actions.pinWidget(id)}
                  className={cn(
                    'rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10',
                    pinned ? 'text-primary' : 'text-muted hover:text-current'
                  )}
                >
                  <FiStar className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={hidden ? `Show ${widget.title}` : `Hide ${widget.title}`}
                  aria-pressed={hidden}
                  onClick={() => actions.setWidgetHidden(id, !hidden)}
                  className="rounded-lg p-2 text-muted transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
                >
                  {hidden ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
