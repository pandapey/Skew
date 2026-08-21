import { useState } from 'react'
import { motion } from 'framer-motion'
import { Badge, Avatar } from '@/components/ui'
import { TASK_STATUSES, COLUMN_BORDER, PRIORITY_TONE, TYPE_TONE } from './constants'
import { formatDate } from '@/utils'

export function KanbanBoard({ tasks = [], onMove, onCardClick }) {
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)

  const handleDrop = (col) => {
    if (dragId) {
      const task = tasks.find((t) => t.id === dragId)
      if (task && task.status !== col) onMove(dragId, col)
    }
    setDragId(null)
    setOverCol(null)
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((col) => {
        const items = tasks.filter((t) => t.status === col)
        return (
          <div
            key={col}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col) }}
            onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
            onDrop={() => handleDrop(col)}
            className={`rounded-card border border-app border-t-4 surface p-3 transition-colors ${COLUMN_BORDER[col]} ${overCol === col ? 'bg-primary/5 ring-2 ring-primary/30' : ''}`}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <h4 className="text-sm font-semibold">{col}</h4>
              <Badge tone="default">{items.length}</Badge>
            </div>
            <div className="min-h-[60px] space-y-2">
              {items.map((t) => (
                <motion.div
                  key={t.id}
                  layout
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => { setDragId(null); setOverCol(null) }}
                  onClick={() => onCardClick?.(t)}
                  className={`cursor-grab rounded-xl border border-app bg-[var(--bg)] p-3 active:cursor-grabbing ${dragId === t.id ? 'opacity-50' : ''}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge tone={TYPE_TONE[t.type] || 'default'}>{t.type}</Badge>
                    <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                  </div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Avatar name={t.assignee} size={22} />
                      <span className="text-xs text-muted">{t.storyPoints ? `${t.storyPoints} pts` : ''}</span>
                    </div>
                    <span className="text-xs text-muted">{formatDate(t.dueDate, 'DD MMM')}</span>
                  </div>
                </motion.div>
              ))}
              {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-muted">Drop here</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
