import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FiChevronDown, FiX, FiSearch, FiCheck } from 'react-icons/fi'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/utils'
import { useAnchoredPopover } from './useAnchoredPopover'

// Premium multi-select. Same glass look & feel as the shared <Select>, but
// returns an array of values via onChange. Each option may carry a `meta` line
// (e.g. "EMP-1004 \u00b7 Engineering \u00b7 Software Developer") shown under the
// label. Fully searchable, keyboard-navigable and theme-aware (light/dark).
// Reused across the app so every multi-select stays visually consistent.
export const MultiSelect = forwardRef(function MultiSelect(
  { label, error, options = [], value, onChange, className, placeholder = 'Select\u2026', disabled, loading, emptyText = 'No results', searchable, singleSelect = false, ...props },
  ref // eslint-disable-line no-unused-vars
) {
  const searchRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  const list = useMemo(
    () =>
      (Array.isArray(options) ? options : []).map((o) =>
        o && typeof o === 'object'
          ? { value: o.value ?? '', label: o.label ?? String(o.value ?? ''), meta: o.meta || '' }
          : { value: o, label: String(o), meta: '' }
      ),
    [options]
  )

  const selected = Array.isArray(value) ? value : []
  const isSel = (v) => selected.some((s) => String(s) === String(v))
  const canSearch = searchable ?? list.length > 6
  const filtered = q
    ? list.filter((o) => (o.label + ' ' + o.meta).toLowerCase().includes(q.toLowerCase()))
    : list
  const selectedOpts = selected
    .map((v) => list.find((o) => String(o.value) === String(v)) || { value: v, label: String(v), meta: '' })

  const toggle = (v) => {
    if (singleSelect) {
      // Single-select mode: replace selection and close dropdown
      const next = isSel(v) ? [] : [v]
      onChange?.(next)
      setOpen(false)
      return
    }
    if (isSel(v)) onChange?.(selected.filter((s) => String(s) !== String(v)))
    else onChange?.([...selected, v])
  }
  const remove = (v, e) => {
    e?.stopPropagation()
    onChange?.(selected.filter((s) => String(s) !== String(v)))
  }

  // Phase 6.23 (TASK 1): same shared portal/positioning primitive as the
  // Dropdown and the single-value Select - see useAnchoredPopover.js.
  const closeMenu = useCallback(() => setOpen(false), [])
  const { rootRef, anchorRef, popoverRef, style: menuStyle } = useAnchoredPopover({
    open: open && !disabled,
    align: 'left',
    matchTriggerWidth: true,
    onDismiss: closeMenu,
    watch: filtered.length,
  })
  useEffect(() => { if (open && canSearch) setTimeout(() => searchRef.current?.focus(), 20) }, [open, canSearch])
  useEffect(() => { if (!open) { setQ(''); setActive(0) } }, [open])

  const onKeyDown = (e) => {
    if (disabled || loading) return
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true); return }
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = filtered[active]; if (opt) toggle(opt.value) }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)} {...props}>
      {label && <label className="label">{label}</label>}

      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && !loading && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'input flex w-full items-center justify-between gap-2 pr-9 text-left',
          error && 'border-danger',
          disabled && 'cursor-not-allowed opacity-60',
          open && 'ring-2 ring-primary/30'
        )}
      >
        <span className={cn('truncate', selected.length === 0 && 'text-muted')}>
          {selected.length === 0
            ? placeholder
            : singleSelect
              ? (selectedOpts[0]?.label || placeholder)
              : selected.length + ' selected'}
        </span>
      </button>

      <div className="pointer-events-none absolute right-3 top-[1.35rem] flex -translate-y-1/2 items-center gap-1">
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />}
        {!loading && <FiChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />}
      </div>

      {selectedOpts.length > 0 && !singleSelect && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedOpts.map((o) => (
            <span key={String(o.value)} className="flex items-center gap-1 rounded-full border border-app bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs font-medium">
              {o.label}
              <button type="button" onClick={(e) => remove(o.value, e)} className="rounded p-0.5 text-muted transition hover:text-danger" aria-label={'Remove ' + o.label}>
                <FiX className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
        {open && !disabled && (
          <motion.div
            ref={popoverRef}
            style={menuStyle}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            role="listbox"
            aria-multiselectable="true"
            className="glass-strong fixed z-[60] flex w-max max-w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-card p-1.5 shadow-floating"
          >
            {canSearch && (
              <div className="relative mb-1.5">
                <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setActive(0) }}
                  onKeyDown={onKeyDown}
                  placeholder="Search\u2026"
                  className="w-full rounded-lg border border-app bg-transparent py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted">{emptyText}</p>}
              {filtered.map((o, i) => {
                const sel = isSel(o.value)
                return (
                  <button
                    type="button"
                    key={String(o.value) + i}
                    role="option"
                    aria-selected={sel}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition',
                      i === active ? 'bg-primary/10' : 'hover:bg-black/5 dark:hover:bg-white/10',
                      sel && 'text-primary'
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn('block truncate', sel && 'font-medium')}>{o.label || '\u2014'}</span>
                      {o.meta && <span className="block truncate text-xs text-muted">{o.meta}</span>}
                    </span>
                    <span className={cn('flex h-4 w-4 flex-none items-center justify-center rounded border', sel ? 'border-primary bg-primary text-white' : 'border-app')}>
                      {sel && <FiCheck className="h-3 w-3" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}

      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
})
