import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { FiMail, FiLock, FiEye, FiEyeOff, FiShield, FiLock as FiLockIcon, FiArrowRight } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { Button, Input, AuthHero } from '@/components/ui'
import { ROLES } from '@/constants'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(4, 'Password is too short'),
  remember: z.boolean().optional(),
})

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 24, filter: 'blur(12px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
}

function detectClientContext() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const lower = ua.toLowerCase()
  const os =
    /windows/.test(lower) ? 'Windows'
      : /android/.test(lower) ? 'Android'
        : /iphone|ipad|ipod/.test(lower) ? 'iOS'
          : /mac os x|macintosh/.test(lower) ? 'macOS'
            : /linux/.test(lower) ? 'Linux'
              : 'Unknown'
  const browser =
    /edg\//.test(lower) ? 'Edge'
      : /opr\/|opera/.test(lower) ? 'Opera'
        : /chrome\//.test(lower) ? 'Chrome'
          : /firefox\//.test(lower) ? 'Firefox'
            : /safari\//.test(lower) ? 'Safari'
              : 'Unknown'
  const device =
    /ipad|tablet/.test(lower) ? 'Tablet'
      : /ipod|iphone|android.*mobile|mobile/.test(lower) ? 'Mobile'
        : 'Desktop'
  return { device, browser, os }
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: 0.5, y: 0.5 })

  useEffect(() => setMounted(true), [])

  const handleMouseMove = (e) => {
    setMousePosition({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight })
  }

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: true },
  })

  const onSubmit = async (values) => {
    setLoading(true)
    try {
      const { user } = await login({ ...values, ...detectClientContext() })
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`)
      const isClient = user?.role === ROLES.CLIENT
      const roleHome = isClient ? '/client' : '/dashboard'
      const fromPath = location.state?.from?.pathname
      const fromMatchesRole = fromPath && (isClient ? fromPath.startsWith('/client') : !fromPath.startsWith('/client'))
      const target = fromMatchesRole ? fromPath : roleHome
      navigate(target, { replace: true, flushSync: true })
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="relative min-h-screen w-full"
      onMouseMove={handleMouseMove}
      style={{ '--mx': `${mousePosition.x * 100}%`, '--my': `${mousePosition.y * 100}%` }}
    >
      {/* ============ ADVANCED BACKGROUND LAYER ============ */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true" style={{ willChange: 'transform' }}>
        {/* Deep base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/50 to-indigo-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/30" />

        {/* Dynamic mesh gradients */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 80% 60% at var(--mx, 50%) var(--my, 50%), rgba(37, 99, 235, 0.15) 0%, transparent 50%),
              radial-gradient(ellipse 60% 80% at calc(100% - var(--mx, 50%)) calc(100% - var(--my, 50%)), rgba(6, 182, 212, 0.12) 0%, transparent 50%),
              radial-gradient(ellipse 50% 50% at 50% 50%, rgba(139, 92, 246, 0.08) 0%, transparent 60%)
            `
          }}
        />

        {/* Animated aurora blobs */}
        <motion.div
          className="absolute top-1/6 left-1/6 w-[500px] h-[500px] rounded-full"
          style={{
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.18), rgba(6, 182, 212, 0.12), rgba(139, 92, 246, 0.1))',
            filter: 'blur(120px)',
            opacity: 0.7
          }}
          animate={{
            transform: [
              'translate3d(0,0,0) scale(1)',
              'translate3d(80px, -60px, 0) scale(1.15)',
              'translate3d(-40px, 80px, 0) scale(0.95)',
              'translate3d(0,0,0) scale(1)'
            ],
            opacity: [0.5, 0.75, 0.6, 0.5]
          }}
          transition={{ duration: 28, ease: 'easeInOut', repeat: Infinity }}
        />
        <motion.div
          className="absolute bottom-1/6 right-1/6 w-[450px] h-[450px] rounded-full"
          style={{
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(16, 185, 129, 0.1), rgba(37, 99, 235, 0.08))',
            filter: 'blur(120px)',
            opacity: 0.65
          }}
          animate={{
            transform: [
              'translate3d(0,0,0) scale(1)',
              'translate3d(-70px, 70px, 0) scale(1.1)',
              'translate3d(50px, -50px, 0) scale(0.9)',
              'translate3d(0,0,0) scale(1)'
            ],
            opacity: [0.45, 0.7, 0.5, 0.45]
          }}
          transition={{ duration: 24, ease: 'easeInOut', repeat: Infinity, delay: 4 }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 w-[400px] h-[400px] rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{
            background: 'radial-gradient(circle at 30% 30%, rgba(37, 99, 235, 0.12), transparent 50%), radial-gradient(circle at 70% 70%, rgba(6, 182, 212, 0.1), transparent 50%)',
            filter: 'blur(100px)',
            opacity: 0.55
          }}
          animate={{
            scale: [1, 1.12, 1],
            opacity: [0.3, 0.55, 0.3],
            borderRadius: ['50%', '60% 40% 50% 50%', '50%']
          }}
          transition={{ duration: 20, ease: 'easeInOut', repeat: Infinity }}
        />

        {/* Subtle grid pattern with perspective */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'linear-gradient(rgba(148, 163, 184, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.4) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse 100% 80% at 50% 0%, #000 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 100% 80% at 50% 0%, #000 30%, transparent 100%)',
        }} />

        {/* Noise texture */}
        <div className="absolute inset-0 pointer-events-none" style={{
          opacity: 'var(--noise-opacity, 0.04)',
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '200px 200px',
        }} />

        {/* Floating light orbs */}
        {[1, 2, 3, 4, 5].map((i) => (
          <motion.div
            key={i}
            className="absolute rounded-full mix-blend-screen"
            style={{
              width: `${40 + i * 15}px`,
              height: `${40 + i * 15}px`,
              left: `${10 + i * 18}%`,
              top: `${15 + i * 12}%`,
              background: `radial-gradient(circle, ${i % 2 === 0 ? 'rgba(37, 99, 235, 0.25)' : 'rgba(6, 182, 212, 0.2)'} 0%, transparent 70%)`,
              filter: 'blur(40px)',
            }}
            animate={{
              transform: [
                'translate3d(0,0,0) scale(1)',
                `translate3d(${20 * (i % 2 === 0 ? 1 : -1)}px, ${-15 * (i % 3)}px, 0) scale(1.2)`,
                'translate3d(0,0,0) scale(1)'
              ],
              opacity: [0.15, 0.35, 0.15]
            }}
            transition={{ duration: 15 + i * 2, ease: 'easeInOut', repeat: Infinity, delay: i * 0.8 }}
          />
        ))}

        {/* Interactive mouse glow */}
        <motion.div
          className="absolute rounded-full pointer-events-none mix-blend-screen"
          style={{
            width: '400px',
            height: '400px',
            left: 'calc(var(--mx, 50%) - 200px)',
            top: 'calc(var(--my, 50%) - 200px)',
            background: 'radial-gradient(circle, rgba(37, 99, 235, 0.18) 0%, rgba(6, 182, 212, 0.1) 40%, transparent 80%)',
            filter: 'blur(80px)',
            opacity: 0.4,
            transition: 'transform 0.3s ease-out',
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-screen">
        {/* ============ LEFT BRAND SECTION - CLEAN & SIMPLE ============ */}
        <aside className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 lg:p-20 relative overflow-hidden">
          <div className="relative z-10 w-full max-w-2xl text-center">
            {/* Simple Logo - Clean & Static */}
            <div className="mb-10">
              <img
                src="/favo.png"
                alt="Skew Infotech"
                className="mx-auto h-24 w-auto drop-shadow-[0_8px_32px_rgba(37,99,235,0.25)]"
                draggable={false}
              />
            </div>

            <h1 className="text-4xl lg:text-6xl xl:text-7xl font-extrabold leading-[1.05] tracking-tight bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-100 dark:via-slate-200 dark:to-slate-100 bg-clip-text text-transparent">
              Skew Infotech
            </h1>
            <p className="mt-4 text-lg lg:text-xl text-muted max-w-md mx-auto font-medium">
              Enterprise Management System
            </p>

            {/* Hero Tagline */}
            <motion.div
              className="mt-16"
              initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              <p className="text-2xl lg:text-4xl xl:text-5xl font-medium text-slate-900 dark:text-slate-100 leading-relaxed max-w-xl mx-auto">
                Manage your workforce
                <br />
                <span className="bg-gradient-to-r from-primary via-accent to-violet bg-clip-text text-transparent">
                  smarter, faster, better
                </span>
              </p>
            </motion.div>
          </div>

          {/* Subtle ambient glows only */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
            <div className="absolute top-20 right-10 w-80 h-80 rounded-full bg-gradient-to-br from-primary/5 via-transparent to-accent/5 blur-3xl" />
            <div className="absolute bottom-20 left-10 w-96 h-96 rounded-full bg-gradient-to-tr from-violet/5 via-transparent to-accent/5 blur-3xl" />
            <div className="absolute top-1/2 right-1/4 w-64 h-64 rounded-full bg-gradient-to-bl from-accent/5 via-transparent to-violet/5 blur-3xl" />
          </div>
        </aside>

        {/* ============ RIGHT LOGIN SECTION ============ */}
        <main className="relative flex-1 flex min-h-screen items-center justify-center p-6 lg:p-12">
          <div className="relative z-10 w-full max-w-md">
            {/* AuthHero */}
            <AuthHero title="Welcome back" subtitle="Sign in to access your workspace" />

            {/* ============ CLEAN GLASS LOGIN CARD ============ */}
            <motion.div
              variants={item}
              className="relative"
            >
              {/* Clean glass card - no corner accents, no border glow */}
              <div className="relative rounded-3xl bg-white/10 dark:bg-slate-950/10 backdrop-blur-3xl border border-white/20 dark:border-white/10 shadow-[0_25px_80px_-20px_rgba(2,6,23,0.4),0_8px_32px_-8px_rgba(2,6,23,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]">
                {/* Inner highlight */}
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-b from-white/20 via-transparent to-transparent dark:from-white/10 dark:via-transparent pointer-events-none" />

                {/* Top gradient line - subtle */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-full" />

                <form onSubmit={handleSubmit(onSubmit)} className="relative z-10 p-8 lg:p-10 space-y-6" noValidate>
                  <AnimatePresence mode="wait">
                    {mounted && (
                      <motion.div variants={item}>
                        <Input
                          label="Email Address"
                          icon={FiMail}
                          error={errors.email?.message}
                          placeholder="you@company.com"
                          autoComplete="email"
                                                    {...register('email')}
                        />
                      </motion.div>
                    )}

                    <motion.div variants={item}>
                      <Input
                        label="Password"
                        type={showPassword ? 'text' : 'password'}
                        icon={FiLock}
                        error={errors.password?.message}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        trailing={
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            tabIndex={-1}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            aria-pressed={showPassword}
                            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-all duration-200 hover:text-primary hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            <motion.div
                              animate={{ rotate: showPassword ? 180 : 0 }}
                              transition={{ duration: 0.2, ease: 'easeInOut' }}
                            >
                              {showPassword ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
                            </motion.div>
                            <span className="sr-only">{showPassword ? 'Hide password' : 'Show password'}</span>
                          </button>
                        }
                        {...register('password')}
                      />
                    </motion.div>

                    <motion.div variants={item} className="flex items-center justify-between">
                      <label className="relative flex items-center gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4.5 w-4.5 rounded-lg border-slate-300 text-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 transition-all duration-200 appearance-none checked:bg-primary checked:border-primary checked:bg-no-repeat checked:bg-center"
                          {...register('remember')}
                        />
                        <span className="text-sm text-muted hover:text-slate-700 dark:hover:text-slate-300 transition-colors">Remember me</span>
                      </label>
                    </motion.div>

                    <motion.div variants={item}>
                      <Button
                        type="submit"
                        loading={loading}
                        glow
                        className="relative w-full py-4 text-base overflow-hidden group"
                      >
                        <span className="relative flex items-center justify-center gap-2">
                          Sign in
                          <motion.div
                            animate={{ x: loading ? 0 : [-4, 0] }}
                            transition={{ duration: 0.4, delay: 0.1 }}
                          >
                            <FiArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                          </motion.div>
                        </span>
                        {/* Button shine effect */}
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full"
                          animate={{ x: ['-100%', '200%'] }}
                          transition={{ duration: 2.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 3 }}
                        />
                      </Button>
                    </motion.div>
                  </AnimatePresence>

                  {/* Error State */}
                  {errors.form && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.98 }}
                      className="relative flex items-center gap-3 p-4 rounded-2xl bg-danger/10 border border-danger/20 text-danger text-sm backdrop-blur-sm"
                      role="alert"
                    >
                      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-danger/20">
                        <FiShield className="h-4 w-4" />
                      </div>
                      <span className="font-medium">{errors.form.message}</span>
                    </motion.div>
                  )}

                  {/* Security Assurance */}
                  <motion.div
                    variants={item}
                    className="relative flex items-center justify-center gap-2.5 text-xs text-muted"
                  >
                    <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-success/10">
                      <motion.div
                        className="absolute inset-0 rounded-full bg-success animate-pulse opacity-50"
                      />
                      <FiLockIcon className="relative h-3.5 w-3.5 text-success" />
                    </div>
                    <span className="font-medium text-slate-600 dark:text-slate-400">Secured company account</span>
                    <div className="relative h-4 w-px bg-gradient-to-b from-transparent via-slate-300/50 to-transparent" />
                    <span className="text-muted/60">End-to-end encrypted</span>
                  </motion.div>

                  {/* Version Footer */}
                  <motion.div
                    variants={item}
                    className="mt-10 text-center text-xs text-muted/50"
                  >
                    Skew EMS v1.0.0 &mdash; &copy; {new Date().getFullYear()} Skew Infotech Pvt. Ltd.
                  </motion.div>
                </form>
              </div>

              {/* Card reflection/shadow */}
              <motion.div
                className="absolute bottom-[-20px] left-1/2 -translate-x-1/2 w-3/4 h-20 rounded-full bg-gradient-to-r from-transparent via-slate-900/5 to-transparent blur-2xl"
                initial={{ opacity: 0, scaleY: 0.5 }}
                animate={{ opacity: 0.3, scaleY: 1 }}
                transition={{ duration: 0.8, delay: 0.6 }}
              />
            </motion.div>
          </div>
        </main>
      </div>
    </motion.div>
  )
}