import { motion } from 'framer-motion'
import { FiArrowLeft } from 'react-icons/fi'
import { Breadcrumb } from './Breadcrumb'
import { useGoBack } from '@/hooks/useGoBack'

export function PageHeader({ title, subtitle, actions, icon: Icon, showBack = true, breadcrumb, backTo }) {
  const { goBack, isRoot } = useGoBack(backTo)
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
          <Breadcrumb items={breadcrumb} />
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.div>
  )
}
