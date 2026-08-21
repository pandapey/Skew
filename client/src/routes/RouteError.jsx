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
