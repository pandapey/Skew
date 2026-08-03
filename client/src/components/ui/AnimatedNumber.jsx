import { useEffect, useRef, useState } from 'react'
import { animate, useInView } from 'framer-motion'
import { cn } from '@/utils'

// Smoothly counts up to `value` when scrolled into view. Renders raw content
// when `value` is not numeric (e.g. "—").
export function AnimatedNumber({ value, format, className, duration = 1.1 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const [display, setDisplay] = useState(0)

  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, ''))
  const isNum = !Number.isNaN(num)

  useEffect(() => {
    if (!inView || !isNum) return
    const controls = animate(0, num, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    return () => controls.stop()
  }, [inView, num, isNum, duration])

  // Always render through the same ref'd span so useInView can observe the
  // element from mount. When the value is still non-numeric (e.g. "—" while the
  // count is loading), show it as-is; once the real number arrives the effect
  // above runs and animates the count up.
  const text = isNum
    ? format
      ? format(Math.round(display))
      : Math.round(display).toLocaleString('en-IN')
    : value

  return (
    <span ref={ref} className={cn(className)}>
      {text}
    </span>
  )
}
