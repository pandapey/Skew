import { useEffect, useRef, useState } from 'react'
import { animate, useInView } from 'framer-motion'
import { cn } from '@/utils'

export function AnimatedNumber({ value, format, className, duration = 1.1 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const [display, setDisplay] = useState(0)

  // Only animate pure numbers. Composite strings like "1/1" or "50%"
  // must render as-is — stripping non-digits turned "1/1" into 11.
  const trimmed = typeof value === 'number' ? '' : String(value ?? '').trim()
  const isPureNumeric = typeof value === 'number' || /^-?\d*\.?\d+$/.test(trimmed)
  const num = typeof value === 'number' ? value : (isPureNumeric ? parseFloat(trimmed) : NaN)
  const isNum = isPureNumeric && !Number.isNaN(num)

  useEffect(() => {
    if (!inView || !isNum) return
    const controls = animate(0, num, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    return () => controls.stop()
  }, [inView, num, isNum, duration])

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
