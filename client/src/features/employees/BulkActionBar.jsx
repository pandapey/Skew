import { AnimatePresence, motion } from 'framer-motion'
import { FiTrash2, FiCheckCircle, FiXCircle, FiX } from 'react-icons/fi'
import { Select } from '@/components/ui'
import { EMPLOYEE_STATUS } from './constants'

// Floating bulk-action bar shown when rows are selected.
//
// Phase 6.0 (TASK 1): `onDelete` is now OPTIONAL. When the caller passes a
// falsy handler (i.e. the current role may not bulk-delete - server gate is
// `authorize('Admin')` on POST /api/employees/bulk-delete) the Delete button is
// not rendered at all, instead of rendering a button that always 403s.
// BACKWARD COMPATIBLE: every existing caller that passes a real function keeps
// the exact previous rendering, and `onSetStatus` is untouched.
export function BulkActionBar({ count, onClear, onDelete, onSetStatus }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed inset-x-0 bottom-6 z-30 mx-auto flex w-[min(92%,640px)] items-center gap-3 rounded-card border border-app surface p-3 shadow-card"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-white">{count}</span>
            selected
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              className="w-36"
              defaultValue=""
              onChange={(e) => e.target.value && onSetStatus(e.target.value)}
              options={[{ value: '', label: 'Set status…' }, ...EMPLOYEE_STATUS.map((s) => ({ value: s, label: s }))]}
            />
            {onDelete && (
              <button onClick={onDelete} className="btn-danger">
                <FiTrash2 className="h-4 w-4" /> Delete
              </button>
            )}
            <button onClick={onClear} className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Clear selection">
              <FiX />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
