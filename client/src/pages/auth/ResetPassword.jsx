import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import { FiLock, FiEye, FiEyeOff } from 'react-icons/fi'
import { authService } from '@/api/services'
import { Button, Input, AuthHero } from '@/components/ui'

const schema = z
  .object({
    password: z.string().min(6, 'At least 6 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [show, setShow] = useState({ password: false, confirm: false })
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) })

  const onSubmit = async (values) => {
    setLoading(true)
    try {
      await authService.resetPassword(values)
      toast.success('Password reset! Please sign in.')
      navigate('/login')
    } finally {
      setLoading(false)
    }
  }

  const eye = (field) => (
    <button
      type="button"
      onClick={() => setShow((s) => ({ ...s, [field]: !s[field] }))}
      tabIndex={-1}
      aria-label={show[field] ? 'Hide password' : 'Show password'}
      className="text-muted transition-colors hover:text-primary"
    >
      {show[field] ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
    </button>
  )

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

      <AuthHero title="Reset password" subtitle="Choose a new password for your account." />

      <motion.form variants={item} onSubmit={handleSubmit(onSubmit)} className="relative z-10 space-y-4">
        <Input
          label="New password"
          type={show.password ? 'text' : 'password'}
          icon={FiLock}
          placeholder="••••••••"
          error={errors.password?.message}
          trailing={eye('password')}
          {...register('password')}
        />
        <Input
          label="Confirm password"
          type={show.confirm ? 'text' : 'password'}
          icon={FiLock}
          placeholder="••••••••"
          error={errors.confirm?.message}
          trailing={eye('confirm')}
          {...register('confirm')}
        />
        <Button type="submit" loading={loading} className="w-full">
          Reset password
        </Button>
      </motion.form>

      <motion.div variants={item} className="relative z-10">
        <Link
          to="/login"
          className="mt-6 block text-center text-sm font-medium text-primary hover:underline"
        >
          ← Back to sign in
        </Link>
      </motion.div>
    </motion.div>
  )
}
