import { useState } from 'react'
import { FiLock, FiEye, FiEyeOff } from 'react-icons/fi'
import { Input } from '@/components/ui'

// Password input with a show/hide toggle. Forwards all other props (incl.
// react-hook-form `register` spread) straight to the underlying Input.
export function PasswordField({ label = 'Password', error, ...props }) {
  const [show, setShow] = useState(false)
  const trailing = (
    <button
      type="button"
      onClick={() => setShow((s) => !s)}
      className="flex h-full items-center rounded-lg px-1.5 text-muted transition hover:text-primary"
      aria-label={show ? 'Hide password' : 'Show password'}
      tabIndex={-1}
    >
      {show ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
    </button>
  )
  return (
    <Input
      label={label}
      type={show ? 'text' : 'password'}
      icon={FiLock}
      trailing={trailing}
      error={error}
      autoComplete="new-password"
      {...props}
    />
  )
}
