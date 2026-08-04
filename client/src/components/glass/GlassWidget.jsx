import { motion } from 'framer-motion'
import { cn } from '@/utils'
import { CardHeader } from '../ui/Card'

// Motion glass widget used across dashboards. Subtle hover lift + entrance.
export function GlassWidget({ className, children, hoverable = true, delay = 0, as: Tag = 'section', ...props }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'card p-5',
        hoverable && 'transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-floating',
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export { CardHeader as GlassWidgetHeader }
