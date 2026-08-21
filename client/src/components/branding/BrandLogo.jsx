// Centralized branding component — the ONLY place the company logo images are
// referenced in the UI. Theme pairing is verified from the artwork itself:
//   /d-logo.png  = dark artwork  -> light mode (visible on light surfaces)
//   /logo.png    = white artwork -> dark mode  (visible on dark surfaces)
//   /favo.png    = blue+white icon -> theme-neutral favicon/compact mark
// The theme comes from the same persisted Redux store every other surface
// (Navbar toggle, useTheme) already uses.
//
// Every branded surface (Sidebar, Navbar mobile, AuthHero) composes this
// component instead of duplicating <img> tags, so the light/dark pairing can
// never drift apart across screens.
import { useSelector } from 'react-redux'

const LOGOS = {
  light: '/d-logo.png',
  dark: '/logo.png',
}
const FAVICON = '/favo.png'

export function BrandLogo({ variant = 'full', className, alt = 'Company logo' }) {
  const theme = useSelector((s) => s.ui?.theme || 'light')
  const src = variant === 'favicon' ? FAVICON : LOGOS[theme] || LOGOS.light
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
    />
  )
}