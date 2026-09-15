import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { router } from '@/routes'
import { queryClient } from '@/api/queryClient'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/features/notifications/NotificationContext'
import { RealtimeProvider } from '@/features/realtime/useRealtimeSync'
import { useTheme } from '@/hooks/useTheme'
import { authService } from '@/api/services'
import { logout as logoutAction, updateUser } from '@/redux/slices/authSlice'

function useSessionRestore() {
  const dispatch = useDispatch()
  const { token, isAuthenticated } = useSelector((s) => s.auth)

  useEffect(() => {
    if (!isAuthenticated || !token) return
    let cancelled = false
    authService.me()
      .then((me) => {
        if (!cancelled && me && me._id) dispatch(updateUser(me))
      })
      .catch(() => {
        if (!cancelled) dispatch(logoutAction())
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export default function App() {
  useTheme()
  useSessionRestore()

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>
          <NotificationProvider>
            <RouterProvider router={router} future={{ v7_startTransition: true }} />
            <Toaster
              position="top-right"
              gutter={12}
              toastOptions={{
                duration: 4000,
                style: {
                  background: 'var(--glass-bg-strong)',
                  color: 'var(--text)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '20px',
                  backdropFilter: 'blur(22px)',
                  WebkitBackdropFilter: 'blur(22px)',
                  boxShadow: '0 12px 40px -12px rgba(2, 6, 23, 0.45)',
                  fontSize: '14px',
                  padding: '12px 14px',
                },
                success: { iconTheme: { primary: '#10B981', secondary: '#fff' } },
                error: { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
              }}
            />
          </NotificationProvider>
        </RealtimeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
