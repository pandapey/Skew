import { FiInbox } from 'react-icons/fi'

export function EmptyState({ title = 'Nothing here yet', description, icon: Icon = FiInbox, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner-light">
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
