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
// How long after opening a pointer event is still considered part of the
// opening gesture and must therefore never dismiss the popover.
export const OPEN_GRACE_MS = 250

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
    const natural = pop.scrollHeight
    const viewport = Math.max(0, vh - POPOVER_EDGE * 2)
    const desired = Math.min(natural, viewport)

    const below = vh - r.bottom - POPOVER_GAP - POPOVER_EDGE
    const above = r.top - POPOVER_GAP - POPOVER_EDGE
    // Flip only when it genuinely does not fit below AND there is more room
    // above, so ordinary popovers keep their familiar downward placement.
    const flip = desired > below && above > below
    const space = Math.max(0, flip ? above : below)
    // Never taller than the space that actually exists: this is what stops the
    // surface from running past the bottom of the viewport / behind the footer.
    const maxHeight = Math.max(0, Math.min(desired, space))

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
  //
  // BUGFIX - "it opens then the max-height visibly shrinks / doesn't stay".
  // On close this used to call `setPos(null)` synchronously, which wiped
  // `maxHeight`/`visibility` back to their zero-state WHILE the menu's exit
  // animation (AnimatePresence: opacity/scale/y) was still playing, so the
  // still-visible, still-animating box lost its computed height and visibly
  // collapsed a beat before it actually faded out. `pos` is now only ever SET
  // (on open) and never reset on close - the exit animation plays out using
  // the last real measurement, and the next open() call always recomputes
  // fresh geometry anyway, so nothing stale can leak into a future open.
  useLayoutEffect(() => {
    if (!open) return
    place()
  }, [open, place, watch])

  // Keep the surface pinned while the page moves underneath it. `true` also
  // captures scrolls on inner scroll containers, not just the window.
  //
  // BUGFIX: this used to also `ResizeObserver`-watch the popover surface
  // itself. The very first `place()` call applies a computed `maxHeight` to
  // that surface, which is itself a resize of the observed element, so the
  // observer immediately fired a SECOND `place()` pass right after open -
  // visible as the box measuring large-then-settling-smaller a frame later.
  // Re-measuring on the trigger moving/resizing and on viewport scroll/resize
  // is everything a correctly anchored popover needs; the surface no longer
  // watches its own size.
  //
  // BUGFIX - "scrolling the list itself makes it shrink". `scroll` is a
  // non-bubbling event, but a capture-phase listener on `window` still fires
  // for it no matter which descendant it was dispatched on - including the
  // popover's OWN scrollable list. So scrolling through the menu's items was
  // re-triggering `place()` on every scroll tick, and any tiny sub-pixel
  // difference in that recomputation (or a hair of scroll chaining reaching
  // the page underneath) read back as less room below the trigger, which
  // shrank the very box the user was scrolling inside of. Scrolling the
  // popover's own content never moves the trigger, so it can never need a
  // reposition - those events are now ignored here.
  useEffect(() => {
    if (!open) return
    const onMove = (e) => {
      const pop = popoverRef.current
      if (pop && e.target instanceof Node && pop.contains(e.target)) return
      place()
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    let ro
    if (typeof ResizeObserver !== 'undefined' && anchorRef.current) {
      ro = new ResizeObserver(onMove)
      ro.observe(anchorRef.current)
    }
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      if (ro) ro.disconnect()
    }
  }, [open, place])

  // Click-outside + Escape. The portalled surface is no longer a DOM
  // descendant of the trigger, so it has to be checked explicitly.
  //
  // BUGFIX - "the menu appears and then closes again by itself".
  // The dismiss listener was registered on `mousedown` from an effect that
  // commits WHILE the very gesture that opened the popover is still in flight,
  // and it decided "inside vs outside" with `contains(e.target)` only. Both
  // parts were unsafe:
  //   1. Any pointer event still belonging to the opening gesture (the browser
  //      re-dispatching after the React commit, a second mousedown from a
  //      double/fast click, a trigger whose icon is swapped during the press)
  //      landed in this handler and dismissed the popover instantly.
  //   2. `e.target` is useless once React has re-rendered the trigger during
  //      the press: the clicked node is already detached, `contains()` returns
  //      false, and a click ON the trigger was treated as a click OUTSIDE.
  // The fix is a grace window around the opening gesture plus containment
  // testing against `composedPath()` (the path is captured at dispatch time, so
  // it still identifies the trigger even if the node was replaced).
  //
  // BUGFIX ROUND 2 - a time-based grace window is still a RACE: it depends on
  // how many milliseconds happen to separate "openedAt" from the next pointer
  // event, which varies with device speed, React's scheduler, and how busy the
  // main thread is (a background React Query refetch, a socket event handler,
  // ...). The only way to make this NOT a race is to not be listening AT ALL
  // during the gesture that opens the popover. `document.addEventListener` is
  // deferred to the next macrotask (`setTimeout(..., 0)`), which always runs
  // strictly after the click/pointerdown/mouseup sequence that just set
  // `open = true` has fully finished dispatching. There is no longer any
  // window, however small, during which this listener can see its own
  // opening gesture.
  useEffect(() => {
    if (!open) return undefined
    const isInside = (e) => {
      const nodes = [rootRef.current, anchorRef.current, popoverRef.current].filter(Boolean)
      if (!nodes.length) return false
      const path = typeof e.composedPath === 'function' ? e.composedPath() : null
      if (path && path.length) return nodes.some((n) => path.includes(n))
      return nodes.some((n) => n.contains(e.target))
    }
    const onDown = (e) => {
      if (isInside(e)) return
      dismissRef.current?.('outside')
    }
    const onKey = (e) => { if (e.key === 'Escape') dismissRef.current?.('escape') }
    let registered = false
    // `pointerdown` in the capture phase is the earliest reliable signal and is
    // not affected by a consumer that stops propagation on its own rows/cards.
    const timer = setTimeout(() => {
      registered = true
      document.addEventListener('pointerdown', onDown, true)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(timer)
      if (registered) {
        document.removeEventListener('pointerdown', onDown, true)
        document.removeEventListener('keydown', onKey)
      }
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
