import { useEffect, useState, createContext, useContext } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSocket, resetSocket } from '@/api/socket'
import { useAuth } from '@/hooks/useAuth'

const RealtimeContext = createContext({ connected: false })

export function useRealtime() {
  return useContext(RealtimeContext)
}

const RESOURCE_QUERY_KEYS = {
  employees: [['employees'], ['employee-stats'], ['employee'], ['projects', 'all'], ['calendar-birthdays'], ['hr-departments'], ['hr-designations'], ['hr-stats']],

  hr: [['hr'], ['my-salary'], ['payroll'], ['hr-reviews']],

  attendance: [['attendance'], ['attendance-today'], ['attendance-summary'], ['attendance-stats'], ['attendance-calendar'], ['attendance-holidays']],

  leave: [['leave'], ['leave-requests'], ['my-leaves'], ['leave-balances'], ['leave-stats'], ['hourly-balance'], ['pending-approvals'], ['calendar-leave-org'], ['calendar-leave-mine']],

  projects: [
    ['project'], ['projects'], ['projects-all'], ['project-stats'],
    ['project-detail'], ['project-comments'], ['project-activity'],
    ['tasks'], ['my-tasks'], ['task-review-queue'], ['task-history'],
    ['task-comments'], ['my-projects'],
  ],

  finance: [['finance'], ['finance-stats'], ['finance-categories'], ['fin-invoices'], ['fin-payments'], ['fin-transactions'], ['fin-cat-all'], ['fin-budgets'], ['fin-income'], ['fin-expenses'], ['finance-tax'], ['finance-period'], ['finance-period-month'], ['finance-period-year']],
  files: [['files'], ['storage']],
  notifications: [['notifications'], ['notification-count']],

  calendar: [['calendar'], ['calendar-events'], ['today-meetings'], ['calendar-meetings']],
  announcements: [['announcements']],
  clients: [['admin-clients'], ['admin-client-projects']],
  'admin-users': [['admin-users'], ['employees'], ['employee-stats']],
}

export function RealtimeProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      resetSocket()
      setConnected(false)
      return
    }
    const socket = getSocket()
    if (!socket) return

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    const bust = (queryKey) => qc.invalidateQueries({ queryKey, refetchType: 'active' })

    const onResourceChanged = ({ resource, id }) => {
      const keys = RESOURCE_QUERY_KEYS[resource]
      if (keys) {
        for (const key of keys) {
          bust(key)
          if (id) bust([...key, id])
        }
      }

      bust(['dashboard'])
      bust(['dashboard-stats'])
      bust(['notifications'])
    }

    const onClientProject = ({ action }) => {
      bust(['client-projects'])
      bust(['client-project'])
      bust(['client-tasks'])
      bust(['client-activity'])
      bust(['client-project-progress'])
      toast.success('Your project was updated')
    }
    const onClientInvoice = () => {
      bust(['client-payments'])
      bust(['client-projects'])
    }
    const onClientDocument = () => {
      bust(['client-documents'])
      bust(['client-project-documents'])
      bust(['client-projects'])
      bust(['client-activity'])
    }

    const onClientProjectComment = ({ projectId }) => {
      bust(['client-project-comments'])
      bust(['client-project-comments', projectId])
      bust(['client-activity'])
    }
    const onClientNotification = () => bust(['client-notifications'])


    const onChatNewMessage = ({ conversationId }) => {
      bust(['chat-conversations'])

      bust(['chat-unread-count'])
      if (conversationId) bust(['chat-messages', conversationId])
    }
    const onChatRead = ({ conversationId }) => {
      bust(['chat-conversations'])
      bust(['chat-unread-count'])
      if (conversationId) bust(['chat-messages', conversationId])
    }
    const onChatConversation = ({ conversationId }) => {
      bust(['chat-conversations'])
      bust(['chat-unread-count'])
      if (conversationId) bust(['chat-conversation', conversationId])
    }
    const onChatConversationUpdated = ({ conversationId }) => {
      bust(['chat-conversations'])
      bust(['chat-unread-count'])
      if (conversationId) bust(['chat-conversation', conversationId])
    }

    socket.on('chat:conversation-updated', onChatConversationUpdated)

    if (socket.connected) setConnected(true)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('resource:changed', onResourceChanged)
      socket.off('client:project', onClientProject)
      socket.off('client:invoice', onClientInvoice)
      socket.off('client:document', onClientDocument)
      socket.off('client:project-comment', onClientProjectComment)
      socket.off('client:notification', onClientNotification)
      socket.off('chat:new-message', onChatNewMessage)
      socket.off('chat:read', onChatRead)
      socket.off('chat:conversation', onChatConversation)
      socket.off('chat:conversation-updated', onChatConversationUpdated)
    }
  }, [isAuthenticated, qc, user?.name])

  return <RealtimeContext.Provider value={{ connected }}>{children}</RealtimeContext.Provider>
}
