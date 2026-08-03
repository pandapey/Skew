import { forwardRef, useId, useState, useRef, useEffect, useMemo, useCallback, useImperativeHandle, Children, isValidElement } from 'react'
import { createPortal } from 'react-dom'
import { FiChevronDown, FiX, FiSearch, FiCheck } from 'react-icons/fi'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/utils'
import { useAnchoredPopover } from './useAnchoredPopover'

// Glass form field with floating label + animated focus. Works with
// react-hook-form refs. Pass `icon` to render a leading icon (shown in a
// tinted chip) and `trailing` for a control on the right (e.g. show/hide).
export const Input = forwardRef(function Input({ label, error, icon: Icon, trailing, className, id, placeholder, ...props }, ref) {
  const inputId = useId()
  const hasPlaceholder = Boolean(placeholder)
  return (
    <div className={cn('group relative', className)}>
      {Icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/5 text-primary/70 transition-colors group-focus-within:bg-primary/10 group-focus-within:text-primary">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        placeholder={placeholder ?? ' '}
        className={cn(
          'input peer pt-6 pb-2',
          Icon && 'pl-12',
          trailing && 'pr-12',
          error && 'border-danger focus:ring-danger/30'
        )}
        {...props}
      />
      {trailing && (
        <div className="absolute right-3 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center">
          {trailing}
        </div>
      )}
      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted transition-all duration-200 ease-out',
            Icon && 'left-12',
            !hasPlaceholder &&
              'peer-focus:top-2 peer-focus:text-xs peer-focus:font-medium peer-focus:text-primary peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:font-medium peer-[:not(:placeholder-shown)]:text-primary',
            hasPlaceholder && 'top-2 text-xs font-medium text-primary'
          )}
        >
          {label}
        </label>
      )}
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
})

// Set a controlled/RHF <select>'s value the way React expects, then dispatch a
// real bubbling change event so both react-hook-form (ref-based) and controlled
// `onChange(e => e.target.value)` consumers fire correctly.
function setNativeSelectValue(el, value) {
  if (!el) return
  const desc = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')
  if (desc && desc.set) desc.set.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// Premium enterprise dropdown. Drop-in replacement for the old native <select>:
// same props (label, error, options|children, value/defaultValue, onChange, ref,
// name, disabled, className). A visually-hidden native <select> remains the
// source of truth (RHF ref, form submission, value, a11y), while a custom
// listbox provides search, keyboard nav, clear, loading + dark/light theming.
// Because every screen imports this shared Select, all dropdowns upgrade at once.
export const Select = forwardRef(function Select(
  { label, error, options = [], className, children, id, value, defaultValue, onChange, disabled, loading, placeholder = 'Select…', searchable, clearable = false, emptyText = 'No results', ...props },
  ref
) {
  const selectId = useId()
  const hiddenRef = useRef(null)
  const searchRef = useRef(null)
  useImperativeHandle(ref, () => hiddenRef.current, [])

  // Normalize option list from the `options` prop or <option> children.
  const list = useMemo(() => {
    if (Array.isArray(options) && options.length) {
      return options.map((o) => (o && typeof o === 'object'
        ? { value: o.value ?? '', label: o.label ?? String(o.value ?? '') }
        : { value: o, label: String(o) }))
    }
    const out = []
    Children.forEach(children, (c) => {
      if (isValidElement(c) && c.type === 'option') {
        const cv = c.props.value ?? ''
        const cl = (typeof c.props.children === 'string' || typeof c.props.children === 'number') ? String(c.props.children) : String(cv)
        out.push({ value: cv, label: cl })
      }
    })
    return out
  }, [options, children])

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [current, setCurrent] = useState(value ?? defaultValue ?? '')

  // Keep the visible trigger in sync with controlled `value`...
  useEffect(() => { if (value !== undefined) setCurrent(value) }, [value])
  // ...and with programmatic (RHF reset/setValue) changes when uncontrolled.
  useEffect(() => {
    if (value === undefined && hiddenRef.current && hiddenRef.current.value !== current) {
      setCurrent(hiddenRef.current.value)
    }
  })

  const canSearch = searchable ?? list.length > 8
  const filtered = q ? list.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : list
  const selected = list.find((o) => String(o.value) === String(current))
  const displayLabel = selected ? selected.label : ''

  // Phase 6.23 (TASK 1): the listbox is portalled into <body> and positioned
  // from the trigger's measured rect by the SHARED popover primitive the
  // Dropdown already uses (useAnchoredPopover.js), so it can no longer be
  // clipped by an overflow ancestor nor trapped inside a `.card`
  // backdrop-filter stacking context - which is what put the Client Portal
  // Documents category picker behind the footer. The hook also owns
  // click-outside + Escape, since the surface is no longer a DOM descendant.
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

  const handleNativeChange = (e) => { setCurrent(e.target.value); onChange?.(e) }
  const choose = (val) => { setNativeSelectValue(hiddenRef.current, val); setOpen(false) }
  const clearSel = (e) => { e.stopPropagation(); setNativeSelectValue(hiddenRef.current, '') }

  const onKeyDown = (e) => {
    if (disabled || loading) return
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true); return }
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const opt = filtered[active]; if (opt) choose(opt.value) }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* Hidden native <select> = source of truth (RHF ref / value / a11y). */}
      <select
        ref={hiddenRef}
        id={selectId}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={handleNativeChange}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        {...props}
      >
        {children || list.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>

      {/* Premium trigger */}
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        // BUGFIX: the Select is often rendered inside a clickable row, card or
        // tile. Letting the opening click bubble also fired that ancestor
        // handler (navigate / open a modal / re-render), which tore the listbox
        // down again right after it appeared.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); if (!disabled && !loading) setOpen((o) => !o) }}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'input flex w-full items-center justify-between gap-2 pr-9 text-left transition',
          label ? 'pt-5 pb-1' : 'py-2.5',
          error && 'border-danger focus:ring-danger/30',
          disabled && 'cursor-not-allowed opacity-60',
          open && 'ring-2 ring-primary/30'
        )}
      >
        <span className={cn('truncate', !displayLabel && 'text-muted')}>{displayLabel || placeholder}</span>
      </button>

      {label && (
        <label htmlFor={selectId} className="pointer-events-none absolute left-3 top-2 text-xs font-medium text-primary">
          {label}
        </label>
      )}

      {/* Right controls: clear + loading + chevron */}
      <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />}
        {clearable && !loading && displayLabel && current !== '' && (
          <button type="button" onClick={clearSel} className="pointer-events-auto rounded p-0.5 text-muted transition hover:text-danger" aria-label="Clear">
            <FiX className="h-3.5 w-3.5" />
          </button>
        )}
        {!loading && <FiChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />}
      </div>

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
            // The listbox is portalled into <body>, but React still bubbles its
            // synthetic events to this component's React ancestors. Keep them in.
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            // Phase 6.20 (TASK 2): the listbox was `w-full`, i.e. exactly the
            // width of its trigger. Wherever the shared Select is rendered with
            // a shrink-to-fit trigger - `className="w-auto"` on the client
            // Documents category picker, for one - the popup inherited that
            // narrow width and, with `overflow-hidden` on the same element,
            // longer option labels ('Requirement', 'Quotation') were cut off.
            // `min-w-full w-max` keeps the popup at least as wide as the
            // trigger while letting it grow to its widest option, capped at the
            // viewport so it can never overflow horizontally on mobile.
            className="glass-strong fixed z-[60] flex w-max max-w-[min(20rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-card p-1.5 shadow-floating"
          >
            {canSearch && (
              <div className="relative mb-1.5">
                <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setActive(0) }}
                  onKeyDown={onKeyDown}
                  placeholder="Search…"
                  className="w-full rounded-lg border border-app bg-transparent py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted">{emptyText}</p>}
              {filtered.map((o, i) => {
                const isSel = String(o.value) === String(current)
                return (
                  <button
                    type="button"
                    key={String(o.value) + i}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition',
                      i === active ? 'bg-primary/10 text-primary' : 'hover:bg-black/5 dark:hover:bg-white/10',
                      isSel && 'font-medium text-primary'
                    )}
                  >
                    <span className="truncate">{o.label || '—'}</span>
                    {isSel && <FiCheck className="h-4 w-4 flex-none" />}
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

export const Textarea = forwardRef(function Textarea({ label, error, className, id, placeholder, ...props }, ref) {
  const taId = useId()
  const hasPlaceholder = Boolean(placeholder)
  return (
    <div className={cn('relative', className)}>
      <textarea
        ref={ref}
        id={taId}
        rows={4}
        placeholder={placeholder ?? ' '}
        className={cn('input peer resize-none pt-6 pb-2', error && 'border-danger')}
        {...props}
      />
      {label && (
        <label
          htmlFor={taId}
          className={cn(
            'pointer-events-none absolute left-3 top-3 text-sm text-muted transition-all duration-200',
            !hasPlaceholder &&
              'peer-focus:top-2 peer-focus:text-xs peer-focus:font-medium peer-focus:text-primary peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-xs',
            hasPlaceholder && 'top-2 text-xs font-medium text-primary'
          )}
        >
          {label}
        </label>
      )}
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
})
