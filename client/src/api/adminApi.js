// Admin module service layer.
// Pure proxy over the Express + MongoDB backend (/api/admin/* and /api/users).
// Every call hits the real database through apiClient — there is NO mock or
// fallback path. Response shapes mirror those returned by the backend
// (collections return { data, total, page, limit, totalPages }; .all returns
// an array; singleton settings/permissions return the document directly).
import apiClient from './client'

// Generic collection proxy that maps the same surface the UI expects
// (query / all / get / create / update / remove) onto REST endpoints.
const proxyCollection = (endpoint) => ({
  query: (params = {}) => apiClient.get(endpoint, { params }),
  all: () => apiClient.get(`${endpoint}/all`),
  get: (id) => apiClient.get(`${endpoint}/${id}`),
  create: (payload) => apiClient.post(endpoint, payload),
  update: (id, patch) => apiClient.put(`${endpoint}/${id}`, patch),
  remove: (id) => apiClient.delete(`${endpoint}/${id}`),
})

export const adminApi = {
  // --- Users (account management) ---
  users: {
    query: (params = {}) => apiClient.get('/users', { params }),
    all: () => apiClient.get('/users', { params: { limit: 1000 } }).then((r) => (Array.isArray(r) ? r : r?.data)),
    get: (id) => apiClient.get(`/users/${id}`),
    create: (payload) => apiClient.post('/users', payload),
    update: (id, patch) => apiClient.put(`/users/${id}`, patch),
    remove: (id) => apiClient.delete(`/users/${id}`),
    // Reset password (admin action; backend returns a generated temp password).
    resetPassword: (id, body = {}) => apiClient.post(`/users/${id}/reset-password`, body),
    // --- Bulk operations ---
    bulkUpdate: (ids = [], patch = {}) => apiClient.patch('/users/bulk', { ids, patch }),
    bulkRemove: (ids = []) => apiClient.delete('/users/bulk', { data: { ids } }),
    // --- Per-user derived histories (computed from live collections) ---
    loginHistory: (id) => apiClient.get(`/users/${id}/login-history`),
    auditHistory: (id) => apiClient.get(`/users/${id}/audit-history`),
    assignedProjects: (id) => apiClient.get(`/users/${id}/assigned-projects`),
    activity: (id) => apiClient.get(`/users/${id}/activity`),
  },

  // --- Roles ---
  roles: proxyCollection('/admin/roles'),

  // --- Audit Logs (read + filter + delete) ---
  auditLogs: {
    query: (params = {}) => apiClient.get('/admin/audit-logs', { params }),
    all: () => apiClient.get('/admin/audit-logs/all'),
    remove: (id) => apiClient.delete(`/admin/audit-logs/${id}`),
  },

  // --- System Logs (read + filter) ---
  systemLogs: {
    query: (params = {}) => apiClient.get('/admin/system-logs', { params }),
    all: () => apiClient.get('/admin/system-logs/all'),
  },

  // --- Backups (CRUD + trigger + download) ---
  backups: {
    ...proxyCollection('/admin/backups'),
    trigger: (payload = {}) => apiClient.post('/admin/backups/trigger', payload),
    download: (id) => apiClient.get(`/admin/backups/${id}/download`, { responseType: 'blob' }),
  },

  // --- Restore points ---
  restore: {
    list: () => apiClient.get('/admin/restore'),
    restore: (id) => apiClient.post(`/admin/restore/${id}`, {}),
  },

  // --- Permissions matrix (single document) ---
  permissions: {
    get: () => apiClient.get('/admin/permissions'),
    update: (matrix) => apiClient.put('/admin/permissions', { matrix }),
  },

  // --- Clients (admin-managed) ---
  clients: {
    all: () => apiClient.get('/admin/clients'),
    get: (id) => apiClient.get(`/admin/clients/${id}`),
    create: (payload) => apiClient.post('/admin/clients', payload),
    update: (id, patch) => apiClient.put(`/admin/clients/${id}`, patch),
    remove: (id) => apiClient.delete(`/admin/clients/${id}`),
    projects: () => apiClient.get('/admin/projects'),
    assignProject: (id, payload) => apiClient.post(`/admin/clients/${id}/projects`, payload),
    generateInvoice: (id, payload) => apiClient.post(`/admin/projects/${id}/invoices`, payload),
    uploadDocument: (id, payload) => apiClient.post(`/admin/projects/${id}/documents`, payload),
    publishAnnouncement: (payload) => apiClient.post('/admin/announcements', payload),
    messages: (clientId) => apiClient.get(`/admin/clients/${clientId}/messages`),
    reply: (threadId, text) => apiClient.post(`/admin/messages/${threadId}/reply`, { text }),
  },

  // --- Database health + analytics ---
  dbHealth: () => apiClient.get('/admin/db-health'),
  analytics: () => apiClient.get('/admin/analytics'),

  // --- Aggregate hub stats ---
  stats: () => apiClient.get('/admin/stats'),
}

export default adminApi
