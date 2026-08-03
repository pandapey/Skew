import { motion } from 'framer-motion'
import { FiArrowLeft } from 'react-icons/fi'
import { Breadcrumb } from './Breadcrumb'
import { useGoBack } from '@/hooks/useGoBack'

// Standard page header with title, breadcrumb, and optional actions.
//
// Phase 5.5 (Task 6): the global back button lives HERE rather than being
// added to ~88 individual pages. PageHeader is already the single component
// every page renders at the top, so this is the one place a back control can
// be added consistently, styled once, and kept in sync with the breadcrumb
// directly beneath it. No page needs to opt in.
//
// `showBack` defaults to true and exists only as an escape hatch for the rare
// screen where going back is meaningless. It is hidden automatically on the
// dashboard, so no caller has to pass it just to avoid a dead button.
export function PageHeader({ title, subtitle, actions, icon: Icon, showBack = true }) {
  const { goBack, isRoot } = useGoBack()
  const backVisible = showBack && !isRoot
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3">
        {backVisible && (
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            title="Go back"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-border text-muted transition hover:bg-black/5 hover:text-primary dark:hover:bg-white/10"
          >
            <FiArrowLeft className="h-4 w-4" />
          </button>
        )}
        {Icon && (
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner-light">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div>
          <Breadcrumb />
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.div>
  )
}
