import { useEffect } from 'react'
import { useSelector } from 'react-redux'

// Applies the current theme to <html> so Tailwind's `dark:` variants work.
export function useTheme() {
  const theme = useSelector((s) => s.ui.theme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }, [theme])
  return theme
}
