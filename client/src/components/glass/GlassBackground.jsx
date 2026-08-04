// Animated aurora + noise background. Fixed, decorative, non-interactive.
// Respects prefers-reduced-motion (see styles/index.css).
export function GlassBackground() {
  return (
    <>
      <div className="aurora-canvas" aria-hidden="true">
        <div
          className="aurora-blob animate-aurora"
          style={{ width: 'min(48vw, 560px)', height: 'min(48vw, 560px)', top: '-12%', left: '-8%', background: 'var(--aurora-1)' }}
        />
        <div
          className="aurora-blob animate-drift"
          style={{ width: 'min(42vw, 500px)', height: 'min(42vw, 500px)', top: '6%', right: '-10%', background: 'var(--aurora-2)', animationDuration: '26s' }}
        />
        <div
          className="aurora-blob animate-float-slow"
          style={{ width: 'min(40vw, 480px)', height: 'min(40vw, 480px)', bottom: '-14%', left: '16%', background: 'var(--aurora-3)', animationDuration: '21s' }}
        />
        <div
          className="aurora-blob animate-aurora"
          style={{ width: 'min(34vw, 420px)', height: 'min(34vw, 420px)', bottom: '-10%', right: '8%', background: 'var(--aurora-4)', animationDuration: '30s' }}
        />
      </div>
      <div className="dot-grid" aria-hidden="true" />
      <div className="noise-overlay" aria-hidden="true" />
    </>
  )
}
