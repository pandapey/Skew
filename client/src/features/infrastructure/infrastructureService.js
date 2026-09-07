import apiClient from '@/api/client'

export const domainApi = {
  list: (params = {}) => apiClient.get('/domains', { params }),
  summary: () => apiClient.get('/domains/summary'),
  lookup: (clientId) => apiClient.get('/domains/lookup', { params: clientId ? { client: clientId } : {} }),
  get: (id) => apiClient.get(`/domains/${id}`),
  create: (payload) => apiClient.post('/domains', payload),
  update: (id, payload) => apiClient.put(`/domains/${id}`, payload),
  renew: (id, months = 12) => apiClient.patch(`/domains/${id}/renew`, { months }),
  remove: (id) => apiClient.delete(`/domains/${id}`),
}

export const hostingApi = {
  list: (params = {}) => apiClient.get('/hosting', { params }),
  summary: () => apiClient.get('/hosting/summary'),
  get: (id) => apiClient.get(`/hosting/${id}`),
  create: (payload) => apiClient.post('/hosting', payload),
  update: (id, payload) => apiClient.put(`/hosting/${id}`, payload),
  renew: (id, months = 12) => apiClient.patch(`/hosting/${id}/renew`, { months }),
  remove: (id) => apiClient.delete(`/hosting/${id}`),
}
