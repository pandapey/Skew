import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import { FiMail, FiLock, FiEye, FiEyeOff, FiShield } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { Button, Input, AuthHero } from '@/components/ui'
import { APP_NAME, COMPANY_NAME, ROLES } from '@/constants'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(4, 'Password is too short'),
  remember: z.boolean().optional(),
})

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: true },
  })

  const onSubmit = async (values) => {
    setLoading(true)
    try {
      const { user } = await login(values)
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`)
      const target =
        location.state?.from?.pathname ||
        (user?.role === ROLES.CLIENT ? '/client' : '/dashboard')
      navigate(target, { replace: true })
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="relative">
      {/* One-time sheen sweep across the card */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-3xl" aria-hidden="true">
        <motion.div
          initial={{ x: '-150%', opacity: 0 }}
          animate={{ x: '150%', opacity: [0, 0.5, 0] }}
          transition={{ duration: 1.3, ease: 'easeInOut', delay: 0.7 }}
          className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />
      </div>

      {/* Brand header */}
      <AuthHero title="Welcome back" subtitle={`Sign in to your ${APP_NAME} workspace`} />

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="relative z-10 space-y-4">
        <motion.div variants={item}>
          <Input label="Email" icon={FiMail} error={errors.email?.message} {...register('email')} />
        </motion.div>

        <motion.div variants={item}>
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            icon={FiLock}
            error={errors.password?.message}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="text-muted transition-colors hover:text-primary"
              >
                {showPassword ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
              </button>
            }
            {...register('password')}
          />
        </motion.div>

        <motion.div variants={item} className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 rounded" {...register('remember')} />
            Remember me
          </label>
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </motion.div>

        <motion.div variants={item}>
          <Button type="submit" loading={loading} glow className="w-full">
            Sign in
          </Button>
        </motion.div>
      </form>

      {/* Security footer */}
      <motion.div
        variants={item}
        className="relative z-10 mt-6 flex items-center justify-center gap-2 text-xs text-muted"
      >
        <FiShield className="h-3.5 w-3.5 text-success animate-pulse" />
        Secured company account · managed by {COMPANY_NAME}
      </motion.div>
    </motion.div>
  )
}
