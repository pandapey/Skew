// Client Portal service. Talks to the real Express + MongoDB backend at
// /api/client* (and /api/admin* for admin operations), which scopes every
// record by the authenticated client's clientId server-side.
import apiClient from '@/api/client'
import { ROLES } from '@/constants'

// ===== Client-facing API ===================================================
export const clientService = {
  // --- Dashboard / profile ---
  getProfile: async () => apiClient.get('/client/profile'),

  getProjects: async () => apiClient.get('/client/projects'),

  getProject: async (user, projectId) => apiClient.get(`/client/projects/${projectId}`),

  // Phase 6.10 (TASK 2 / TASK 6) DEAD CODE REMOVED: `getTasks`, `getTimeline`
  // and `getDocuments` had exactly one caller each - ClientTasks.jsx,
  // ClientTimeline.jsx and ClientDocuments.jsx. Those three pages were deleted
  // because their views now live as tabs on Project Details, so these wrappers
  // became unreachable. The server routes GET /client/tasks, /client/timeline
  // and /client/documents are deliberately LEFT IN PLACE (they are account-wide
  // aggregates that other/future callers may use, and deleting them would be an
  // unrequested API removal), but the portal no longer calls them.

  getTeam: async (user, projectId) =>
    apiClient.get('/client/team', { params: projectId ? { projectId } : {} }),

  getActivity: async (user, projectId) =>
    apiClient.get('/client/activity', { params: projectId ? { projectId } : {} }),

  // Phase 5.8 (Task 3): upload/delete real client-owned project documents.
  uploadProjectDocument: async (projectId, formData) =>
    apiClient.post(`/client/projects/${projectId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  deleteProjectDocument: async (projectId, docId) =>
    apiClient.delete(`/client/projects/${projectId}/documents/${docId}`),

  downloadProjectDocumentUrl: (projectId, docId) => `/client/projects/${projectId}/documents/${docId}/download`,

  // Phase 5.8 (Task 5): reuses the internal unified task-history timeline.
  getProjectTaskHistory: async (projectId) => apiClient.get(`/client/projects/${projectId}/task-history`),

  // Phase 5.8 (Task 7): reuses existing project/task/milestone calculations.
  getProjectProgress: async (projectId) => apiClient.get(`/client/projects/${projectId}/progress`),

  // Phase 5.4 (Task 4): the shared project discussion thread. Same underlying
  // ProjectComment records the internal Projects UI uses - the backend scopes
  // them to this client's own project.
  getProjectComments: async (projectId) => apiClient.get(`/client/projects/${projectId}/comments`),

  addProjectComment: async (projectId, body) =>
    apiClient.post(`/client/projects/${projectId}/comments`, { body }),

  // Phase 5.8 (Task 2): edit/delete own project comment (Project Communication Center).
  updateProjectComment: async (projectId, commentId, body) =>
    apiClient.patch(`/client/projects/${projectId}/comments/${commentId}`, { body }),

  deleteProjectComment: async (projectId, commentId) =>
    apiClient.delete(`/client/projects/${projectId}/comments/${commentId}`),

  uploadCommentAttachment: async (projectId, formData) =>
    // Phase 6.0 (TASK 2) ROOT CAUSE FIX: was `/attachments`, but clientRoutes.js:31
    // only registers `/projects/:id/comments/attachments`. The short path matched
    // no route, so every comment attachment 404'd silently (the comment itself
    // saved in a prior call, so the file just vanished). Repointed at the EXISTING
    // route - no new API, no server change; field name 'file' already matched.
    apiClient.post(`/client/projects/${projectId}/comments/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // ---------------------------------------------------------------------------
  // Phase 6.10 (TASK 3) ROOT CAUSE - "payments.reduce is not a function".
  //
  // The backend contract CHANGED and the frontend was never migrated. Phase 6.9
  // (Task 18) rewrote clientController.buildBillingRows() to return an OBJECT:
  //     { rows, advancePayment, monthlyDue }
  // instead of the bare array it used to return, because advancePayment /
  // monthlyDue would have been silently dropped if tacked onto an array. Its own
  // comment even claims "ClientBilling.jsx and ClientDashboard.jsx were updated
  // to read this shape" - they were not. GET /client/payments therefore resolved
  // to an object, `useQuery`'s `data` was that object, and ClientBilling's very
  // first statement `payments.reduce(...)` threw, which React Router surfaced as
  // "Unexpected Application Error".
  //
  // So `payments` was never "sometimes not an array" - it is ALWAYS an object,
  // and an Array.isArray() guard would only have hidden the schema mismatch and
  // left every billing card reading 0. The correct fix is to consume the real
  // schema. It is normalised HERE, in the single service method both callers
  // share, so the two consumers cannot drift apart again and the ['client-payments']
  // React Query cache holds one stable shape.
  // ---------------------------------------------------------------------------
  getPayments: async () => {
    const data = await apiClient.get('/client/payments')
    return {
      rows: data?.rows || [],
      advancePayment: data?.advancePayment || 0,
      monthlyDue: data?.monthlyDue || 0,
    }
  },

  // Phase 6.3 (TASK 11): `getInvoices` removed - it had ZERO component callers
  // (the ClientBilling ['client-invoices'] query that once used it was itself
  // dead and was removed in Task 8). The backend GET /client/invoices route is
  // deliberately KEPT as a documented alias of getAllPayments, for backward
  // compatibility with any existing external caller.

  getMeetings: async () => apiClient.get('/client/meetings'),

  // Phase 6.11 (TASK 5): upcoming Company Holidays, read-only, for the meeting
  // date picker. Backed by the SAME Holiday collection Attendance/Leave use -
  // this is a client-scoped projection of it, not a second holiday source. See
  // getHolidays() in clientController.js for why the staff endpoints could not
  // be called directly from a Client session.
  getHolidays: async () => apiClient.get('/client/holidays'),

  // Phase 6.9 (Task 17): client submits a new meeting request (created as a
  // real CalendarEvent with meetingStatus: 'Pending' on the server).
  requestMeeting: async (payload) => apiClient.post('/client/meetings', payload),

  // Phase 6.17 (TASK 3) ROOT CAUSE FIX: when STAFF raises a meeting request
  // (Projects -> Selected Project -> Meeting section), the request is FROM
  // staff TO the client, so only the Client can Accept/Reject/Reschedule it.
  // These call the two new client-scoped PATCH routes on the SAME
  // CalendarEvent record - no new meeting model or endpoint family.
  respondToMeeting: async (id, status) => apiClient.patch(`/client/meetings/${id}/status`, { status }),

  rescheduleMeeting: async (id, start) => apiClient.patch(`/client/meetings/${id}/reschedule`, { start }),

  getNotifications: async () => apiClient.get('/client/notifications'),
  // Phase 6.3 (Task 10): mark-one / mark-all. The single-row endpoint already
  // existed server-side but had no client-side caller at all.
  markNotificationRead: async (id) => apiClient.patch(`/client/notifications/${id}/read`),
  markAllNotificationsRead: async () => apiClient.post('/client/notifications/read-all'),

  // ===== Admin API ========================================================
  listClients: async () => apiClient.get('/admin/clients'),

  getClient: async (clientId) => apiClient.get(`/admin/clients/${clientId}`),

  listProjects: async () => apiClient.get('/admin/projects'),

  createClient: async (payload) => apiClient.post('/admin/clients', payload),

  updateClient: async (clientId, patch) => apiClient.put(`/admin/clients/${clientId}`, patch),

  removeClient: async (clientId) => apiClient.delete(`/admin/clients/${clientId}`),

  assignProject: async (clientId, projectId) =>
    apiClient.post(`/admin/clients/${clientId}/projects`, { projectId }),

  assignProjectManager: async (projectId, manager) =>
    apiClient.put(`/admin/projects/${projectId}/manager`, { manager }),

  assignTeam: async (projectId, members) =>
    apiClient.put(`/admin/projects/${projectId}/team`, { members }),

  generateInvoice: async (projectId, invoice) =>
    apiClient.post(`/admin/projects/${projectId}/invoices`, invoice),

  updatePayment: async (projectId, paymentId, patch) =>
    apiClient.put(`/admin/projects/${projectId}/payments/${paymentId}`, patch),

  publishAnnouncement: async (payload) => apiClient.post('/admin/announcements', payload),

  uploadDocument: async (projectId, doc) =>
    apiClient.post(`/admin/projects/${projectId}/documents`, doc),

  updateProgress: async (projectId, progress) =>
    apiClient.put(`/admin/projects/${projectId}/progress`, { progress }),
}

export { ROLES as _ROLES }
