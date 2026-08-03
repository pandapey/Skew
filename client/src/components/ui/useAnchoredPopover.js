import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// =============================================================================
// Shared anchored-popover positioning primitive.
//
// Phase 6.23 (TASK 1). The Dropdown menu (components/ui/Dropdown.jsx) was
// fixed in Phase 6.21 by portalling it into <body> and positioning it from the
// trigger's measured viewport rect. The shared <Select> / <MultiSelect>
// listboxes (components/ui/Input.jsx, components/ui/MultiSelect.jsx) were NOT
// migrated and were still rendered as `absolute z-50` children of the trigger
// wrapper, so they kept hitting the exact same two defects:
//
//   1. OVERFLOW CLIPPING - any ancestor with a non-visible overflow
//      (`main.overflow-y-auto` in ClientLayout / DashboardLayout, the
//      `overflow-x-auto` tab strips, ...) clips an absolutely positioned
//      descendant.
//   2. STACKING-CONTEXT TRAPPING - `.card` / `.glass*` set `backdrop-filter`,
//      which per CSS Filter Effects creates a NEW STACKING CONTEXT. A `z-50`
//      popup inside a card is only ranked against that card's own children,
//      so it can never paint above content that comes later in the document -
//      e.g. ClientLayout's `backdrop-blur-sm` footer. Raising the z-index does
//      nothing, because the popup is trapped one stacking context too deep.
//
// Rather than duplicating the Dropdown's portal logic in three components,
// that logic now lives here once and every popup surface consumes it.
//
// The placement is strictly viewport-bounded: the popover flips above the
// trigger when it does not fit below, is clamped horizontally so it can never
// leave the left/right edge, and its height is capped to the space that is
// actually available (never past the bottom of the viewport, where the footer
// sits). Internal scrolling is a last resort for a popover taller than the
// whole viewport.
// =============================================================================

export const POPOVER_GAP = 8 // space between trigger and popover
export const POPOVER_EDGE = 8 // minimum breathing room from any viewport edge
// Phase 6.23a: a popover shorter than this is unusable - it reads as "the menu
// flashed and vanished". When neither side of the trigger has this much room,
// the surface is allowed to overlap the trigger and is clamped into the
// viewport instead of being squeezed into a sliver.
export const POPOVER_MIN_HEIGHT = 140

function samePos(a, b) {
  if (!a || !b) return false
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.maxHeight === b.maxHeight &&
    a.minWidth === b.minWidth &&
    a.placement === b.placement
  )
}

/**
 * @param {object}   opts
 * @param {boolean}  opts.open              whether the popover is mounted
 * @param {'left'|'right'} opts.align       which trigger edge to align to
 * @param {boolean}  opts.matchTriggerWidth min-width = trigger width (listboxes)
 * @param {Function} opts.onDismiss         called with 'outside' | 'escape'
 * @param {*}        opts.watch             re-measure when this value changes
 */
export function useAnchoredPopover({
  open,
  align = 'left',
  matchTriggerWidth = false,
  onDismiss,
  watch,
} = {}) {
  const anchorRef = useRef(null) // the trigger: what we measure against
  const rootRef = useRef(null) // trigger wrapper: never counts as "outside"
  const popoverRef = useRef(null) // the portalled surface
  const naturalRef = useRef(0) // last good natural height (see place())
  const [pos, setPos] = useState(null)

  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  const place = useCallback(() => {
    const anchor = anchorRef.current || rootRef.current
    const pop = popoverRef.current
    if (!anchor || !pop) return
    const r = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // scrollHeight is the natural content height even while a maxHeight from a
    // previous measurement is still applied, so measuring never compounds.
    // Phase 6.23a: a measurement of 0 means the surface has not been laid out
    // yet (portalled node, webfont still swapping, images resolving). Applying
    // it would clamp the menu to nothing, so the last good height is reused and
    // a re-measure is scheduled by the caller.
    const measured = pop.scrollHeight
    if (measured > 0) naturalRef.current = measured
    const natural = naturalRef.current || measured
    if (!natural) return

    const viewport = Math.max(0, vh - POPOVER_EDGE * 2)
    const desired = Math.min(natural, viewport)

    const below = vh - r.bottom - POPOVER_GAP - POPOVER_EDGE
    const above = r.top - POPOVER_GAP - POPOVER_EDGE
    // Flip only when it genuinely does not fit below AND there is more room
    // above, so ordinary popovers keep their familiar downward placement.
    const flip = desired > below && above > below
    const space = Math.max(0, flip ? above : below)

    // Phase 6.23a ROOT CAUSE of "the menu appears and then disappears": the
    // height used to be capped at `space` with no lower bound, so a trigger
    // sitting close to the bottom of the scroll area (exactly the Client
    // Portal > Documents case, where the footer eats the last ~60px) produced
    // maxHeight values of 20-30px. The menu was still open and still on top of
    // the footer - it was simply collapsed to a sliver, which looks identical
    // to it fading out. A popover is now never squeezed below
    // POPOVER_MIN_HEIGHT (or its own natural height, or the viewport, whichever
    // is smallest); when the chosen side cannot provide that, the surface is
    // allowed to overlap its trigger and the `top` clamp below keeps every
    // pixel of it inside the viewport.
    const floor = Math.min(desired, viewport, POPOVER_MIN_HEIGHT)
    const maxHeight = Math.max(0, Math.max(Math.min(desired, space), floor))

    const width = pop.offsetWidth
    let left = align === 'right' ? r.right - width : r.left
    left = Math.min(left, vw - width - POPOVER_EDGE)
    left = Math.max(POPOVER_EDGE, left)

    let top = flip ? r.top - POPOVER_GAP - maxHeight : r.bottom + POPOVER_GAP
    top = Math.min(top, vh - POPOVER_EDGE - maxHeight)
    top = Math.max(POPOVER_EDGE, top)

    const next = {
      top: Math.round(top),
      left: Math.round(left),
      maxHeight: Math.round(maxHeight),
      minWidth: matchTriggerWidth ? Math.round(r.width) : undefined,
      placement: flip ? 'top' : 'bottom',
    }
    setPos((prev) => (samePos(prev, next) ? prev : next))
  }, [align, matchTriggerWidth])

  // Measure after the surface exists in the DOM but before the browser paints,
  // so the first frame can never flash in the wrong place.
  useLayoutEffect(() => {
    if (!open) { naturalRef.current = 0; setPos(null); return }
    place()
    // Phase 6.23a: re-measure on the next two frames. The first layout pass can
    // land before the portalled surface has its final size (webfont swap, an
    // async icon, a scrollbar appearing), and without this the popover would
    // keep whatever height that first pass happened to see.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => { place(); raf2 = requestAnimationFrame(place) })
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2) }
  }, [open, place, watch])

  // Keep the surface pinned while the page moves underneath it. `true` also
  // captures scrolls on inner scroll containers, not just the window.
  useEffect(() => {
    if (!open) return
    // Phase 6.23a: scrolling the popover's OWN list must not re-run placement -
    // it is not the page moving underneath the trigger, and re-measuring on
    // every wheel tick made a long menu jitter.
    const onMove = (e) => {
      if (e && e.target && popoverRef.current && popoverRef.current.contains(e.target)) return
      place()
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    let ro
    if (typeof ResizeObserver !== 'undefined' && popoverRef.current) {
      ro = new ResizeObserver(onMove)
      ro.observe(popoverRef.current)
      if (anchorRef.current) ro.observe(anchorRef.current)
    }
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      if (ro) ro.disconnect()
    }
  }, [open, place])

  // Click-outside + Escape. The portalled surface is no longer a DOM
  // descendant of the trigger, so it has to be checked explicitly.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return
      if (anchorRef.current && anchorRef.current.contains(e.target)) return
      if (popoverRef.current && popoverRef.current.contains(e.target)) return
      dismissRef.current?.('outside')
    }
    const onKey = (e) => { if (e.key === 'Escape') dismissRef.current?.('escape') }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const style = {
    top: pos ? pos.top : 0,
    left: pos ? pos.left : 0,
    maxHeight: pos ? pos.maxHeight : undefined,
    minWidth: pos ? pos.minWidth : undefined,
    // Hidden for the single measuring frame only.
    visibility: pos ? 'visible' : 'hidden',
  }

  return { anchorRef, rootRef, popoverRef, pos, style, place, ready: Boolean(pos) }
}
