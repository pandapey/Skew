import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import { FiMail } from 'react-icons/fi'
import { authService } from '@/api/services'
import { Button, Input, AuthHero } from '@/components/ui'

const schema = z.object({ email: z.string().email('Enter a valid email') })

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

export default function ForgotPassword() {
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema) })

  const onSubmit = async ({ email }) => {
    setLoading(true)
    try {
      await authService.forgotPassword({ email })
      setSent(true)
      toast.success('Reset link sent!')
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

      <AuthHero title="Forgot password?" subtitle="Enter your email and we'll send you a reset link." />

      {sent ? (
        <motion.div
          variants={item}
          className="relative z-10 rounded-xl border border-success/30 bg-success/10 p-4 text-center text-sm text-success"
        >
          Check your inbox — a password reset link is on its way.{' '}
          <Link className="underline" to="/reset-password">
            Go to reset page
          </Link>
          .
        </motion.div>
      ) : (
        <motion.form variants={item} onSubmit={handleSubmit(onSubmit)} className="relative z-10 space-y-4">
          <Input
            label="Email"
            icon={FiMail}
            placeholder="you@skew.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" loading={loading} className="w-full">
            Send reset link
          </Button>
        </motion.form>
      )}

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
