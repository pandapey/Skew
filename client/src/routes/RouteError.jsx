// =============================================================================
// Phase 6.10 (TASK 3, second half) — ROUTE-LEVEL ERROR ELEMENT
//
// ROOT CAUSE of "Unexpected Application Error":
//   components/ErrorBoundary.jsx exists, but App.jsx mounts it ABOVE
//   <RouterProvider>. React Router catches render errors thrown inside its own
//   route elements before they can propagate to an outer boundary, so that
//   class boundary could never see them. With no `errorElement` on any route,
//   the router fell back to its built-in development crash screen — which is
//   exactly what the billing TypeError produced.
//
// FIX: one shared errorElement, attached to the three top-level route objects
// (auth shell, staff shell, client portal shell) so it covers every route in
// the tree. It renders the EXISTING ErrorPage shell rather than a new design,
// and forwards a role-appropriate home path so a client is not sent to the
// staff /dashboard they cannot access.
// =============================================================================
import { useRouteError, isRouteErrorResponse, useLocation } from 'react-router-dom'
import { ErrorPage } from '@/pages/error/ErrorPage'

export function RouteError() {
  const error = useRouteError()
  const { pathname } = useLocation()

  // Keep the real error visible to developers; the user sees the friendly page.
  if (import.meta.env?.DEV) console.error('Route error:', error)

  // Clients live entirely in /client/*, so their "home" is the portal.
  const homePath = pathname.startsWith('/client') ? '/client' : '/dashboard'

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorPage
        code={error.status}
        title={error.status === 404 ? 'Page not found' : error.statusText || 'Something went wrong'}
        tone={error.status === 404 ? 'primary' : 'warning'}
        message={error.data?.message || error.data || 'The page could not be loaded.'}
        homePath={homePath}
      />
    )
  }

  return (
    <ErrorPage
      code="500"
      title="Something went wrong"
      tone="danger"
      message={error?.message || 'An unexpected error occurred. Please try again.'}
      homePath={homePath}
    />
  )
}
