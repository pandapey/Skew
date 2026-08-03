import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/utils'
import { useAnchoredPopover } from './useAnchoredPopover'

// Click-outside dropdown. `trigger` is the button content; `children` the menu.
//
// =============================================================================
// Phase 6.21 (TASK 1) moved this menu into a <body> portal because an
// absolutely positioned menu is clipped by overflow ancestors and trapped in
// the `.card` backdrop-filter stacking context. Phase 6.23 (TASK 1) keeps that
// mechanism but extracts it into the shared `useAnchoredPopover` hook, so the
// shared <Select> / <MultiSelect> listboxes - which still suffered from the
// original defect on Client Portal > Project > Documents - reuse exactly this
// implementation instead of a second, parallel one.
//
// The hook also hardened the geometry: the previous `Math.max(120, space)`
// height floor allowed the menu to run past the bottom of the viewport (i.e.
// behind ClientLayout's footer) whenever the space below the trigger was
// smaller than 120px and flipping was not triggered. Height is now capped to
// the space that actually exists and `top` is clamped to the viewport.
// =============================================================================

export function Dropdown({ trigger, children, align = 'right', className }) {
  const [open, setOpen] = useState(false)
  const onDismiss = useCallback(() => setOpen(false), [])
  const { rootRef, anchorRef, popoverRef, style } = useAnchoredPopover({
    open,
    align,
    onDismiss,
    watch: children,
  })

  const menu = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          role="menu"
          style={style}
          // BUGFIX - the menu lives in a <body> portal, but a portal is still a
          // CHILD OF THIS COMPONENT IN THE REACT TREE, so React replays its
          // synthetic events up the React parents: the DataTable row
          // (`onRowClick`), clickable cards, dropzone wrappers, ... Those
          // handlers navigate / open a modal / reset page state, which unmounts
          // or re-renders the Dropdown - the menu "closed by itself" the moment
          // it was touched. The menu is a self-contained surface, so its pointer
          // events must never reach those ancestors.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          // `overflow-y-auto` is the last-resort escape hatch for a menu taller
          // than the whole viewport; with the flip + height cap in the hook,
          // ordinary menus never reach it and are shown in full.
          className={cn(
            'glass-strong fixed z-[60] w-max min-w-48 max-w-[min(20rem,calc(100vw-1rem))]',
            'overflow-y-auto overscroll-contain rounded-card p-1.5 shadow-floating'
          )}
          onClick={(e) => {
            e.stopPropagation()
            // Close only when an actual menu item was chosen. Clicking a header,
            // a separator or the padding used to close the menu too.
            const el = e.target instanceof Element ? e.target : null
            if (!el || el.closest('[role="menuitem"]')) setOpen(false)
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={anchorRef}
        type="button"
        // Same reason as the menu above: the trigger is very often rendered
        // inside a clickable row / card / tile. Without this the opening click
        // ALSO fired the ancestor handler (navigate to the row, open a preview,
        // toggle a folder...), which re-rendered or unmounted this Dropdown and
        // made the just-opened menu disappear immediately.
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </div>
  )
}

export function DropdownItem({ children, onClick, icon: Icon, danger, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={cn(
        // Phase 6.20 (TASK 2): `whitespace-nowrap` keeps a long label on one
        // line so the parent's `w-max` can measure it and grow to fit, instead
        // of the label wrapping inside a too-narrow box.
        'flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm transition',
        danger
          ? 'text-danger hover:bg-danger/10'
          : active
            ? 'bg-primary/10 font-medium text-primary'
            : 'hover:bg-black/5 hover:text-current dark:hover:bg-white/10'
      )}
    >
      {Icon && <Icon className="h-4 w-4 flex-none" />}
      {children}
    </button>
  )
}
