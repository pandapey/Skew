import { useEffect, useState } from 'react'
import { FiClock } from 'react-icons/fi'

// Live date & time, ticking every second.
export function DateTimeWidget() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' })
  const date = now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-primary via-primary to-accent p-6 text-white shadow-glow-primary">
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/20 blur-2xl" />
      <div className="relative flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <p className="flex items-center justify-center gap-1.5 text-sm text-white/80 sm:justify-start">
            <FiClock className="h-4 w-4" /> {weekday}
          </p>
          <p className="mt-1 text-lg font-semibold">{date}</p>
          {tz && <p className="text-xs text-white/70">{tz}</p>}
        </div>
        <p className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
          {time}
        </p>
      </div>
    </div>
  )
}
