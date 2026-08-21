// Chat API service — internal staff messaging (Admin / HR / Manager / Employee).
// The server guards every endpoint with `protect, blockClient` and enforces
// participant membership / group management rules server-side; this layer only
// describes the REST surface.
import apiClient from './client'

export const chatApi = {
  // Internal user directory for the "start a chat" picker.
  users: async (params = {}) => apiClient.get('/chat/users', { params }),

  // My conversations (with last message + unread count).
  conversations: async (params = {}) => apiClient.get('/chat/conversations', { params }),

  // PHASE: EMPLOYEE CHAT (REQUIREMENT 7) — total unread messages across all of
  // my conversations, for the sidebar badge.
  unreadCount: async () => apiClient.get('/chat/unread-count'),

  // Find-or-create a direct conversation with another staff user.
  createDirect: async (userId) => apiClient.post('/chat/conversations/direct', { userId }),

  // Create a group conversation.
  createGroup: async (payload) => apiClient.post('/chat/conversations/groups', payload),

  get: async (id) => apiClient.get(`/chat/conversations/${id}`),

  messages: async (id, params = {}) => apiClient.get(`/chat/conversations/${id}/messages`, { params }),

  // Send text, an attachment payload (from uploadAttachment), or both.
  sendMessage: async (id, { text, attachment } = {}) =>
    apiClient.post(`/chat/conversations/${id}/messages`, { text, attachment }),

  // Upload a chat file; returns attachment metadata to pass to sendMessage.
  // No manual Content-Type: the browser must generate the multipart boundary.
  uploadAttachment: async (id, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post(`/chat/conversations/${id}/attachments`, fd)
  },

  // Authenticated URL for an attachment (download + inline preview). The bytes
  // are served only through this participant-checked route.
  attachmentUrl: (id, fileId) => `/chat/conversations/${id}/attachments/${fileId}`,

  markRead: async (id) => apiClient.post(`/chat/conversations/${id}/read`, {}, { skipErrorToast: true }),

  addMember: async (id, userId) => apiClient.post(`/chat/conversations/${id}/members`, { userId }),

  removeMember: async (id, userId) => apiClient.delete(`/chat/conversations/${id}/members/${userId}`),

  leaveGroup: async (id) => apiClient.post(`/chat/conversations/${id}/leave`, {}),
}