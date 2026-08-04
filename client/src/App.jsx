import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { router } from '@/routes'
import { queryClient } from '@/api/queryClient'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/features/notifications/NotificationContext'
import { RealtimeProvider } from '@/features/realtime/useRealtimeSync'
import { useTheme } from '@/hooks/useTheme'

export default function App() {
  // Applies light/dark class to <html> based on persisted UI state.
  useTheme()

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>
          <NotificationProvider>
            <RouterProvider router={router} />
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
