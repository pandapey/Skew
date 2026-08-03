// Notifications service. Hits the layered Express backend at /api/notifications.
// Every method returns the payload directly: the shared apiClient response
// interceptor already unwraps `response.data`, so callers receive the array /
// document itself (NOT a `{ data }` wrapper).
import apiClient from '@/api/client'

const normalize = (n) => ({
  id: n.id || n._id || `ntf-${Date.now()}`,
  type: n.type || 'announcement',
  title: n.title || 'Notification',
  body: n.body || '',
  sender: n.sender || 'System',
  createdAt: n.createdAt || new Date().toISOString(),
  read: !!n.read,
  link: n.link || null,
  priority: n.priority || 'normal',
})

export const notificationService = {
  list: async (params = {}) => {
    const items = await apiClient.get('/notifications', { params })
    return Array.isArray(items) ? items.map(normalize) : items
  },

  markRead: async (id) => {
    return apiClient.patch(`/notifications/${id}/read`)
  },

  markAllRead: async () => {
    return apiClient.post('/notifications/read-all')
  },

  getSettings: async () => {
    return apiClient.get('/notifications/settings')
  },

  updateSettings: async (patch) => {
    return apiClient.put('/notifications/settings', patch)
  },

  // Used by other modules to push a note to the backend.
  create: async (notif) => {
    const normalized = normalize(notif)
    return apiClient.post('/notifications', normalized)
  },
}
