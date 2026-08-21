import apiClient from '@/api/client'
import { ROLES } from '@/constants'

export const clientService = {
  // --- Dashboard / profile ---
  getProfile: async () => apiClient.get('/client/profile'),

  getProjects: async () => apiClient.get('/client/projects'),

  getProject: async (user, projectId) => apiClient.get(`/client/projects/${projectId}`),

  getTeam: async (user, projectId) =>
    apiClient.get('/client/team', { params: projectId ? { projectId } : {} }),

  getActivity: async (user, projectId) =>
    apiClient.get('/client/activity', { params: projectId ? { projectId } : {} }),

  // Phase 5.8 (Task 3): upload/delete real client-owned project documents.
  uploadProjectDocument: async (projectId, formData) =>
    apiClient.post(`/client/projects/${projectId}/documents`, formData),

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
    apiClient.post(`/client/projects/${projectId}/attachments`, formData),

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
  // PHASE SALARY/BILLING (TASK 1) ROOT CAUSE #2 — the normaliser TRUNCATED the
  // response contract.
  //
  // buildBillingRows() has returned `totalAmount` (the contracted account value)
  // and `totalBilled` since Phase 6.23, and summarizeBilling() reads
  // `billing.totalAmount` with `billed` as a documented legacy fallback. But
  // this method — the ONE place the payload is normalised — only copied
  // rows/advancePayment/monthlyDue and dropped the rest on the floor. So
  // `billing.totalAmount` was ALWAYS undefined, `Number.isFinite(undefined)`
  // was always false, and the "Total Amount" card silently degraded to the
  // invoice total (0 for any client with no invoices raised yet) on every
  // render. The server was sending the right number the whole time; it never
  // survived this function.
  //
  // The fields are passed through explicitly rather than by spreading `data`,
  // keeping the stable, documented shape both consumers rely on.
  // PHASE CLIENT PAY/BALANCE (TASK 5): `summary` is ADDITIVE — the account
  // summary computed SERVER-side by the same summarizeBilling() routine the
  // Admin/HR "Client Pay/Balance" module reads (GET /hr/client-billing). The
  // portal consumes it instead of re-deriving the arithmetic, so the two
  // surfaces can never disagree. `null` until the server supplies it, which is
  // why consumers keep the client-side summarizeBilling() as a read-compat
  // fallback for a stale cached response.
  getPayments: async () => {
    const data = await apiClient.get('/client/payments')
    return {
      rows: data?.rows || [],
      advancePayment: data?.advancePayment || 0,
      monthlyDue: data?.monthlyDue || 0,
      totalAmount: data?.totalAmount || 0,
      totalBilled: data?.totalBilled || 0,
      projectBudgetTotal: data?.projectBudgetTotal || 0,
      accountBudget: data?.accountBudget || 0,
      summary: data?.summary || null,
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
