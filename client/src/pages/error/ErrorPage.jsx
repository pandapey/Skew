import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui'

export function ErrorPage({ code, title, message, tone = 'primary', homePath = '/dashboard' }) {
  const tones = { primary: 'text-primary', danger: 'text-danger', warning: 'text-warning' }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center app-bg p-6 text-center">
      <motion.h1
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`text-8xl font-extrabold ${tones[tone]}`}
      >
        {code}
      </motion.h1>
      <h2 className="mt-4 text-2xl font-bold">{title}</h2>
      <p className="mt-2 max-w-md text-muted">{message}</p>
      <div className="mt-6 flex gap-3">
        <Link to={homePath}><Button>Back to Dashboard</Button></Link>
        <Link to="/login"><Button variant="ghost">Sign in</Button></Link>
      </div>
    </div>
  )
}

export const NotFound = () => (
  <ErrorPage code="404" title="Page not found" message="The page you're looking for doesn't exist or has been moved." />
)
export const Forbidden = () => (
  <ErrorPage code="403" title="Access denied" tone="warning" message="You don't have permission to view this page. Contact your administrator." />
)
export const ServerError = () => (
  <ErrorPage code="500" title="Something went wrong" tone="danger" message="An unexpected error occurred. Please try again later." />
)
