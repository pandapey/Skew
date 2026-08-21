import { APP_NAME } from '@/constants'
import { BrandLogo } from '@/components/branding/BrandLogo'

// Full-screen and inline loaders.
export function Loader({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-muted">
      <span
        className="h-6 w-6 animate-spin rounded-full border-2 border-primary/25"
        style={{ borderTopColor: '#2563EB', borderRightColor: '#06B6D4' }}
      />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function FullPageLoader() {
  return (
    <div className="relative flex h-screen w-full items-center justify-center app-bg overflow-hidden">
      <div className="aurora-canvas" aria-hidden="true">
        <div
          className="aurora-blob animate-aurora"
          style={{ width: 360, height: 360, top: '18%', left: '28%', background: 'var(--aurora-1)' }}
        />
        <div
          className="aurora-blob animate-drift"
          style={{ width: 320, height: 320, bottom: '12%', right: '24%', background: 'var(--aurora-2)' }}
        />
      </div>
      <div className="glass-strong relative z-10 flex flex-col items-center gap-5 rounded-card px-12 py-12 shadow-floating">
        <div className="relative h-14 w-14">
          <span
            className="absolute inset-0 animate-spin rounded-full border-4 border-primary/20"
            style={{ borderTopColor: '#2563EB', borderRightColor: '#06B6D4' }}
          />
          <span className="absolute inset-2 rounded-full bg-gradient-to-br from-primary to-accent opacity-25 blur-md" />
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-white">
            <BrandLogo variant="favicon" className="h-6 w-6" alt="Company favicon" />
          </span>
          <p className="text-sm font-semibold">Loading {APP_NAME}…</p>
        </div>
      </div>
    </div>
  )
}
