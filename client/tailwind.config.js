/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
          800: '#1E3A8A',
          900: '#172554',
        },
        accent: {
          DEFAULT: '#06B6D4',
          50: '#ECFEFF',
          100: '#CFFAFE',
          400: '#22D3EE',
          500: '#06B6D4',
          600: '#0891B2',
        },
        success: {
          DEFAULT: '#10B981',
          50: '#ECFDF5',
          100: '#D1FAE5',
          500: '#10B981',
          600: '#059669',
        },
        warning: {
          DEFAULT: '#F59E0B',
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#F59E0B',
          600: '#D97706',
        },
        danger: {
          DEFAULT: '#EF4444',
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          600: '#DC2626',
        },
        violet: {
          DEFAULT: '#8B5CF6',
          500: '#8B5CF6',
        },
        // Surfaces (theme-aware via CSS vars)
        secondary: '#0F172A',
        surface: 'var(--surface)',
        ink: '#020617',
        canvas: '#F8FAFC',
        glass: 'rgba(255,255,255,0.08)',
        glassborder: 'rgba(255,255,255,0.12)',
      },
      borderRadius: {
        xs: '12px',
        input: '16px',
        btn: '18px',
        lg2: '20px',
        card: '24px',
        sidebar: '24px',
        '2xl': '28px',
        '3xl': '32px',
      },
      boxShadow: {
        soft: '0 2px 8px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        card: '0 4px 24px rgba(15, 23, 42, 0.08)',
        // Premium floating shadows
        floating:
          '0 10px 40px -12px rgba(15, 23, 42, 0.25), 0 4px 12px -4px rgba(15, 23, 42, 0.12)',
        'floating-sm':
          '0 6px 20px -8px rgba(15, 23, 42, 0.22), 0 2px 6px -2px rgba(15, 23, 42, 0.10)',
        // Colored glows
        'glow-primary': '0 8px 30px -6px rgba(37, 99, 235, 0.45)',
        'glow-accent': '0 8px 30px -6px rgba(6, 182, 212, 0.45)',
        'glow-success': '0 8px 30px -6px rgba(16, 185, 129, 0.45)',
        'glow-danger': '0 8px 30px -6px rgba(239, 68, 68, 0.45)',
        'glow-warning': '0 8px 30px -6px rgba(245, 158, 11, 0.45)',
        'inner-light': 'inset 0 1px 0 0 rgba(255,255,255,0.18)',
        'ring-glass': '0 0 0 1px rgba(255,255,255,0.10), 0 10px 40px -12px rgba(2, 6, 23, 0.45)',
      },
      backdropBlur: {
        glass: '24px',
        xs: '4px',
        sm: '8px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(to right, rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.08) 1px, transparent 1px)',
      },
      keyframes: {
        aurora: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)', opacity: '0.55' },
          '33%': { transform: 'translate3d(4%, 6%, 0) scale(1.12)', opacity: '0.7' },
          '66%': { transform: 'translate3d(-3%, -4%, 0) scale(0.95)', opacity: '0.5' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translate3d(0,0,0)' },
          '50%': { transform: 'translate3d(0, -22px, 0)' },
        },
        drift: {
          '0%': { transform: 'translate3d(0,0,0) rotate(0deg)' },
          '50%': { transform: 'translate3d(40px, -30px, 0) rotate(8deg)' },
          '100%': { transform: 'translate3d(0,0,0) rotate(0deg)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.6', filter: 'blur(40px)' },
          '50%': { opacity: '1', filter: 'blur(55px)' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        ripple: {
          to: { transform: 'scale(4)', opacity: '0' },
        },
      },
      animation: {
        aurora: 'aurora 18s ease-in-out infinite',
        'float-slow': 'float-slow 9s ease-in-out infinite',
        drift: 'drift 22s ease-in-out infinite',
        shimmer: 'shimmer 1.8s infinite',
        'pulse-glow': 'pulse-glow 6s ease-in-out infinite',
        gradient: 'gradient 6s ease infinite',
        'fade-in': 'fade-in 0.4s ease both',
        'scale-in': 'scale-in 0.3s ease both',
        'slide-up': 'slide-up 0.45s cubic-bezier(0.22,1,0.36,1) both',
        'spin-slow': 'spin-slow 14s linear infinite',
        ripple: 'ripple 0.6s linear',
      },
    },
  },
  plugins: [],
}
