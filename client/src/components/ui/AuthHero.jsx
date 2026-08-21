import { motion } from 'framer-motion'

const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

// Shared animated hero for auth screens: gradient title, subtitle and a
// shimmering accent line. Participates in a parent framer-motion stagger via
// `variants={item}`.
export function AuthHero({ title, subtitle }) {
  return (
    <motion.div variants={item} className="relative z-10 mb-8 flex flex-col items-center text-center">
      <h2 className="text-2xl font-bold gradient-text">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{subtitle}</p>

      {/* Shimmering accent line */}
      <div className="relative mt-4 h-px w-28 overflow-hidden rounded-full divider">
        <motion.div
          aria-hidden="true"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity, repeatDelay: 1.2 }}
          className="h-full w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent"
        />
      </div>
    </motion.div>
  )
}