import { motion } from 'framer-motion'

const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

// Shared animated hero for auth screens: a rotating glow ring, a floating
// brand badge, a gradient title and a shimmering accent line. Participates
// in a parent framer-motion stagger via `variants={item}`.
export function AuthHero({ title, subtitle }) {
  return (
    <motion.div variants={item} className="relative z-10 mb-8 flex flex-col items-center text-center">
      <div className="relative mb-5 flex h-[88px] w-[88px] items-center justify-center">
        {/* Rotating glowing halo */}
        <div className="absolute inset-0 rounded-3xl bg-[conic-gradient(from_0deg,#2563EB,#06B6D4,#8B5CF6,#22D3EE,#2563EB)] opacity-90 blur-[4px] animate-spin-slow" />
        {/* Crisp rotating ring */}
        <div className="absolute inset-[5px] rounded-[26px] bg-[conic-gradient(from_0deg,#2563EB,#06B6D4,#8B5CF6,#2563EB)] animate-spin-slow" />
        {/* Floating brand badge */}
        <div className="relative flex h-[68px] w-[68px] animate-float-slow items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-3xl font-bold text-white shadow-glow-primary">
          S
        </div>
      </div>

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
