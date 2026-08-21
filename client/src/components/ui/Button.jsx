import { useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/utils'

const variants = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
}

const sizes = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: '',
  lg: 'px-6 py-3 text-base',
}

// Reusable glass button with variants, ripple, loading state + tap feedback.
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  loading,
  disabled,
  icon: Icon,
  glow,
  onClick,
  ...props
}) {
  const [ripples, setRipples] = useState([])

  const handleClick = (e) => {
    if (!(variant === 'ghost' || disabled || loading)) {
      const rect = e.currentTarget.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height)
      const x = e.clientX - rect.left - size / 2
      const y = e.clientY - rect.top - size / 2
      const id = `${Date.now()}-${Math.random()}`
      setRipples((r) => [...r, { id, size, x, y }])
    }
    onClick?.(e)
  }

  return (
    <motion.button
      className={cn(variants[variant], sizes[size], glow && 'btn-glow', className)}
      disabled={disabled || loading}
      onClick={handleClick}
      whileTap={{ scale: 0.97 }}
      {...props}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          onAnimationEnd={() => setRipples((rs) => rs.filter((x) => x.id !== r.id))}
          className="pointer-events-none absolute rounded-full bg-white/40 animate-ripple"
          style={{ width: r.size, height: r.size, left: r.x, top: r.y }}
        />
      ))}
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : (
        Icon && <Icon className="h-4 w-4" />
      )}
      {children}
    </motion.button>
  )
}
