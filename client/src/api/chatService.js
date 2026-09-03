import apiClient from './client'

export const chatApi = {

  users: async (params = {}) => apiClient.get('/chat/users', { params }),

  conversations: async (params = {}) => apiClient.get('/chat/conversations', { params }),

  unreadCount: async () => apiClient.get('/chat/unread-count'),

  presence: async (ids) => apiClient.get('/chat/presence', { params: { ids: ids.join(',') }, skipErrorToast: true }),

  blocked: async () => apiClient.get('/chat/blocked'),
  block: async (userId) => apiClient.post('/chat/block', { userId }),
  unblock: async (userId) => apiClient.delete(`/chat/block/${userId}`),

  createDirect: async (userId) => apiClient.post('/chat/conversations/direct', { userId }),

  createGroup: async (payload) => apiClient.post('/chat/conversations/groups', payload),

  get: async (id) => apiClient.get(`/chat/conversations/${id}`),
  updateGroup: async (id, payload) => apiClient.patch(`/chat/conversations/${id}`, payload),
  setAdmin: async (id, userId, makeAdmin = true) => apiClient.post(`/chat/conversations/${id}/admin`, { userId, makeAdmin }),
  setSettings: async (id, payload) => apiClient.post(`/chat/conversations/${id}/settings`, payload),
  invite: async (id) => apiClient.post(`/chat/conversations/${id}/invite`),
  join: async (code) => apiClient.get(`/chat/join/${code}`),
  pref: async (id, payload) => apiClient.post(`/chat/conversations/${id}/pref`, payload),
  clear: async (id) => apiClient.post(`/chat/conversations/${id}/clear`),
  deleteConversation: async (id) => apiClient.delete(`/chat/conversations/${id}`),

  messages: async (id, params = {}) => apiClient.get(`/chat/conversations/${id}/messages`, { params }),

  searchMessages: async (id, q) => apiClient.get(`/chat/conversations/${id}/messages/search`, { params: { q } }),
  starred: async (id) => apiClient.get(`/chat/conversations/${id}/starred`),
  media: async (id, kind) => apiClient.get(`/chat/conversations/${id}/media`, { params: { kind } }),

  sendMessage: async (id, { text, attachment, replyTo, forwarded, messageType, location, contactCard, poll, viewOnce } = {}) =>
    apiClient.post(`/chat/conversations/${id}/messages`, { text, attachment, replyTo, forwarded, messageType, location, contactCard, poll, viewOnce }),

  forward: async (targetId, messageId) => apiClient.post(`/chat/conversations/${targetId}/forward`, { messageId }),

  editMessage: async (id, messageId, text) => apiClient.patch(`/chat/conversations/${id}/messages/${messageId}`, { text }),
  deleteMessage: async (id, messageId, forEveryone = false) => apiClient.delete(`/chat/conversations/${id}/messages/${messageId}`, { params: { forEveryone } }),
  star: async (id, messageId) => apiClient.post(`/chat/conversations/${id}/messages/${messageId}/star`),
  react: async (id, messageId, emoji) => apiClient.post(`/chat/conversations/${id}/messages/${messageId}/react`, { emoji }),
  pollVote: async (id, messageId, optionIndex) => apiClient.post(`/chat/conversations/${id}/messages/${messageId}/poll`, { optionIndex }),
  info: async (id, messageId) => apiClient.get(`/chat/conversations/${id}/messages/${messageId}/info`),

  uploadAttachment: async (id, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return apiClient.post(`/chat/conversations/${id}/attachments`, fd)
  },

  attachmentUrl: (id, fileId) => `/chat/conversations/${id}/attachments/${fileId}`,

  markRead: async (id) => apiClient.post(`/chat/conversations/${id}/read`, {}, { skipErrorToast: true }),
  markDelivered: async (id, messageIds) => apiClient.post(`/chat/conversations/${id}/delivered`, { messageIds }),

  addMember: async (id, userId) => apiClient.post(`/chat/conversations/${id}/members`, { userId }),

  removeMember: async (id, userId) => apiClient.delete(`/chat/conversations/${id}/members/${userId}`),

  leaveGroup: async (id) => apiClient.post(`/chat/conversations/${id}/leave`, {}),
}
