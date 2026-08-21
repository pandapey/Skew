import { FiChevronLeft, FiChevronRight } from 'react-icons/fi'
import { cn } from '@/utils'

export function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1
  )

  return (
    <div className="mt-4 flex items-center justify-end">
      <div className="glass-soft flex items-center gap-1 rounded-card p-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-black/5 hover:text-current disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10"
        >
          <FiChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) => {
          const gap = i > 0 && p - pages[i - 1] > 1
          return (
            <span key={p} className="flex items-center">
              {gap && <span className="px-1 text-muted">…</span>}
              <button
                onClick={() => onChange(p)}
                aria-current={p === page}
                className={cn(
                  'flex h-9 min-w-9 items-center justify-center rounded-xl px-3 text-sm font-semibold transition',
                  p === page
                    ? 'bg-primary text-white shadow-glow-primary'
                    : 'text-muted hover:bg-black/5 hover:text-current dark:hover:bg-white/10'
                )}
              >
                {p}
              </button>
            </span>
          )
        })}
        <button
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-black/5 hover:text-current disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10"
        >
          <FiChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
