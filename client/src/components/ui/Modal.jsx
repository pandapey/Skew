import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { FiX } from 'react-icons/fi'
import { cn } from '@/utils'

// Accessible glass modal with blurred backdrop + Framer Motion transitions.
//
// =============================================================================
// Phase 6.20 (TASK 1) ROOT CAUSE - "View History" dialog clipped, while the
// IDENTICAL <Modal/> used by My Projects -> Meeting -> Request Meeting renders
// perfectly.
//
// Both call sites already use THIS component with the same prop shape, so the
// modal was never the variable - its ANCESTRY was:
//
//   * ClientMeetings.jsx renders <RequestMeetingModal/> as a direct child of
//     the page <div>. No glass ancestor, so its `position: fixed` overlay
//     resolves against the VIEWPORT and centres correctly.
//
//   * ProjectTaskHistory.jsx renders its <Modal/> INSIDE <Card>, and `.card`
//     (styles/index.css) sets `backdrop-filter: blur(...) saturate(180%)`.
//     Per CSS Filter Effects, an element with a non-`none` filter /
//     backdrop-filter becomes the CONTAINING BLOCK for `position: fixed`
//     descendants. `fixed inset-0` therefore stopped meaning "the viewport"
//     and started meaning "this Card's padding box": the overlay was sized to
//     the Card, `items-center` centred the panel on the CARD, while the panel's
//     own `max-h-[calc(100dvh-2rem)]` still measured the real VIEWPORT. A panel
//     taller than its containing block, anchored to a box scrolled somewhere
//     down the page, is exactly the reported clipping.
//
// This was never Task-History-specific: every modal mounted inside a Card,
// DataTable wrapper or any other glass surface had the same latent bug. Moving
// the JSX out of the Card at one call site would have been a symptom patch that
// leaves every other call site broken.
//
// FIX (one place, zero duplication): the shared Modal renders through a React
// portal into `document.body`, which has no filtered ancestor. `fixed` resolves
// against the viewport again for EVERY caller, so size, responsive layout,
// scroll behaviour, animation, overlay and a11y are literally the same code
// path for Task History and Request Meeting. No second modal component, no
// per-call-site wrapper, and no markup change at any of the existing call
// sites.
// =============================================================================
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  // SSR / non-DOM renderer guard: with no document there is nothing to portal
  // into, and rendering nothing is already correct for a closed dialog.
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
          <motion.div
            // Phase 6.14 (TASK 6) ROOT CAUSE - DIALOG CLIPPING:
            // The panel had NO height bound of its own. Its height was
            // header (~65px) + gradient bar (4px) + body (max-h-[72vh]) +
            // footer (~69px), i.e. up to 72vh + ~138px. On any viewport shorter
            // than roughly 900px that total exceeds 100vh. Because the backdrop
            // wrapper centres with `items-center` and did not scroll, the
            // overflow was split evenly above AND below the viewport - so the
            // title row was pushed off the top and the footer (Cancel / Send
            // request) off the bottom, with no way to reach them. `overflow-
            // hidden` on this element then clipped whatever hung outside.
            //
            // The fix is to make the PANEL the height budget instead of the
            // body: cap it at the viewport, lay it out as a flex column, and
            // let only the body flex and scroll (see below). Raising the body's
            // max-height would have made the clipping worse, not better.
            className={cn('glass-strong relative z-10 flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-card shadow-floating', sizes[size])}
            initial={{ scale: 0.95, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 12, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.18 }}
          >
            <div className="h-1 w-full flex-none bg-gradient-to-r from-primary via-accent to-violet" />
            <div className="flex flex-none items-center justify-between border-b border-app px-5 py-4">
              <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-xl p-1.5 text-muted transition hover:bg-black/5 hover:text-current dark:hover:bg-white/10"
              >
                <FiX className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
            {footer && (
              <div className="flex flex-none justify-end gap-2 border-t border-app bg-black/[0.02] px-5 py-4 dark:bg-white/[0.03]">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
