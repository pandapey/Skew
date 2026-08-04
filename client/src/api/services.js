// Service layer. Talks to the real Express + MongoDB backend through apiClient.
import apiClient from './client'

// Generic factory over a REST resource.
const resource = (endpoint) => ({
  list: (params) => apiClient.get(endpoint, { params }),
  get: (id) => apiClient.get(`${endpoint}/${id}`),
  create: (payload) => apiClient.post(endpoint, payload),
  update: (id, payload) => apiClient.put(`${endpoint}/${id}`, payload),
  remove: (id) => apiClient.delete(`${endpoint}/${id}`),
})

export const authService = {
  login: async ({ email, password }) => {
    return apiClient.post('/auth/login', { email, password })
  },
  forgotPassword: async ({ email }) =>
    apiClient.post('/auth/forgot-password', { email }),
  resetPassword: async (payload) =>
    apiClient.post('/auth/reset-password', payload),
  me: () => apiClient.get('/auth/me'),
  // Self-serve profile picture upload for the logged-in user. Reuses the shared
  // multipart upload backend (POST /auth/me/avatar -> uploadImage middleware).
  uploadAvatar: async (file) => {
    const fd = new FormData()
    fd.append('avatar', file)
    return apiClient.post('/auth/me/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  // Phase 6.3 (Task 9): clear the signed-in user's own profile picture. Mirrors
  // uploadAvatar above - same /auth/me/avatar path, same `protect`-only guard,
  // target derived from req.user on the server.
  deleteAvatar: async () => apiClient.delete('/auth/me/avatar'),
  // Phase 5.5 (Task 1): self-serve password change for the signed-in user.
  // Available to every role including Client (see authRoutes: `protect` only).
  changePassword: async ({ currentPassword, newPassword, confirmPassword }) =>
    apiClient.post('/auth/me/password', { currentPassword, newPassword, confirmPassword }),
}

export const employeeService = resource('/employees')

// --- Extended Employee API for the upgraded module ---
export const employeeApi = {
  // Paginated + filtered + sorted list.
  query: async (params = {}) => apiClient.get('/employees', { params }),

  // Phase 6.2 (Task 5): create an employee WITHOUT going through Admin -> Users.
  // Server-side this route delegates to the very same createUser provisioning
  // routine the Admin module uses (see server/src/routes/employeeRoutes.js), so
  // there is exactly one provisioning implementation, not two.
  create: async (payload) => apiClient.post('/employees', payload),

  get: async (id) => apiClient.get(`/employees/${id}`),

  update: async (id, payload) => apiClient.put(`/employees/${id}`, payload),

  remove: async (id) => apiClient.delete(`/employees/${id}`),

  bulkRemove: async (ids) => apiClient.post('/employees/bulk-delete', { ids }),

  bulkUpdate: async (ids, patch) => apiClient.post('/employees/bulk-update', { ids, patch }),

  stats: async () => apiClient.get('/employees/stats'),

  uploadPhoto: async (id, file) => {
    const fd = new FormData()
    fd.append('photo', file)
    return apiClient.post(`/employees/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },

  uploadDocument: async (id, file, category = 'General') => {
    const fd = new FormData()
    fd.append('document', file)
    fd.append('category', category)
    return apiClient.post(`/employees/${id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}
export const attendanceService = resource('/attendance')
export const leaveService = resource('/leaves')
export const projectService = resource('/projects')
export const taskService = resource('/tasks')
export const financeService = resource('/transactions')

// --- Announcements / Company Feed API ---
// Posts (Company News, Announcements, Events, Birthdays) with pinned flags,
// likes, nested comments and media (images / videos / file attachments).
export const announcementApi = {
  // List with optional search / type / pinned filter and sort.
  list: async (params = {}) => apiClient.get('/announcements', { params }),

  get: async (id) => apiClient.get(`/announcements/${id}`),

  create: async (payload) => apiClient.post('/announcements', payload),

  update: async (id, patch) => apiClient.put(`/announcements/${id}`, patch),

  remove: async (id) => apiClient.delete(`/announcements/${id}`),

  // Toggle the current user's like.
  like: async (id) => apiClient.patch(`/announcements/${id}/like`, {}),

  // Add a comment to a post.
  //
  // PHASE ADMIN (TASK 2): the `author = 'You'` parameter was REMOVED. It sent a
  // hardcoded literal string "You" as the comment author (AnnouncementApp only
  // ever called `comment(id, body)`, so the default always won), which meant
  // every comment ever persisted was stored with the author "You" for every
  // user. The author is now derived from the authenticated session server-side
  // in announcementController.comment - correct, and unspoofable by a caller.
  comment: async (id, body) => apiClient.post(`/announcements/${id}/comments`, { body }),

  // Upload media (real backend, multer).
  uploadMedia: async (id, file) => {
    const fd = new FormData()
    fd.append('media', file)
    return apiClient.post(`/announcements/${id}/media`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// --- File Management API ---
// Full file manager: folders, uploads (with versioning), download, preview,
// sharing, permissions, version history, recycle bin and storage usage.
export const fileService = {
  // List folders + files for a location (folder id, search, type, trash).
  list: async (params = {}) => apiClient.get('/files', { params }),

  storage: async () => apiClient.get('/files/storage'),

  createFolder: async ({ name, parent }) => apiClient.post('/files/folders', { name, parent }),

  get: async (id) => apiClient.get(`/files/${id}`),

  // Upload a browser File.
  upload: async (file, { folder, onProgress } = {}) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folder && folder !== 'root') fd.append('folder', folder)
    return apiClient.post('/files/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
  },

  download: async (id) => apiClient.get(`/files/${id}/download`, { responseType: 'blob' }),

  update: async (id, patch) => apiClient.patch(`/files/${id}`, patch),

  // Soft delete → recycle bin.
  remove: async (id) => apiClient.delete(`/files/${id}`),
  hardRemove: async (id) => apiClient.delete(`/files/${id}/hard`),
  restore: async (id) => apiClient.post(`/files/${id}/restore`),

  trash: async (params = {}) => apiClient.get('/files/trash', { params }),

  share: async (id, { user, permission }) => apiClient.post(`/files/${id}/share`, { user, permission }),
  unshare: async (id, user) => apiClient.delete(`/files/${id}/share`, { data: { user } }),
  restoreVersion: async (id, versionId) => apiClient.post(`/files/${id}/version/${versionId}/restore`),

  renameFolder: async (id, name) => apiClient.patch(`/files/folders/${id}`, { name }),
  removeFolder: async (id) => apiClient.delete(`/files/folders/${id}`),
  restoreFolder: async (id) => apiClient.post(`/files/folders/${id}/restore`),
}

// --- HR Management API ---
// Generic REST collection factory mapping to the Express backend.
const hrCollection = (endpoint) => ({
  query: (params = {}) => apiClient.get(endpoint, { params }),
  // Phase 5.4 (Task 1) root cause: this hit the base list route, which returns
  // a PAGINATED envelope ({ data, total, page, limit, totalPages }) rather than
  // an array. Every dropdown built on `.all()` (Department, Designation, Jobs)
  // guards with `Array.isArray(x) ? x : []`, so they all silently resolved to
  // an empty list. The backend already exposes an unpaginated '/all' route
  // (resourceRouter.js) returning the plain array — the same one the other
  // collection factories in this file already use.
  all: () => apiClient.get(`${endpoint}/all`),
  get: (id) => apiClient.get(`${endpoint}/${id}`),
  create: (payload) => apiClient.post(endpoint, payload),
  update: (id, patch) => apiClient.put(`${endpoint}/${id}`, patch),
  remove: (id) => apiClient.delete(`${endpoint}/${id}`),
})

export const hrApi = {
  departments: hrCollection('/hr/departments'),
  designations: hrCollection('/hr/designations'),
  jobs: hrCollection('/hr/jobs'),
  candidates: hrCollection('/hr/candidates'),
  interviews: hrCollection('/hr/interviews'),
  offers: hrCollection('/hr/offers'),
  onboarding: hrCollection('/hr/onboarding'),
  payroll: {
    ...hrCollection('/hr/payroll'),
    // Self-serve: the logged-in employee's own payslip history only.
    me: () => apiClient.get('/hr/payroll/me'),
    // Self-serve: the logged-in employee's own computed salary portal (own data only).
    mySalary: (params = {}) => apiClient.get('/hr/payroll/me/salary', { params }),
  },
  reviews: hrCollection('/hr/reviews'),
  movements: hrCollection('/hr/movements'),

  // Move a candidate across the interview pipeline (drives the Kanban board).
  moveCandidate: async (id, stage) => apiClient.patch(`/hr/candidates/${id}/stage`, { stage }),

  stats: async () => apiClient.get('/hr/stats'),
}

// --- Attendance API ---
export const attendanceApi = {
  // Personal attendance history (filter by status, paginated).
  myHistory: async (params = {}) => apiClient.get('/attendance/me', { params }),

  // Personal attendance analytics for the LOGGED-IN employee only:
  // Average Hours, Overtime, present/absent/leave counts for a selected period.
  mySummary: async (params = {}) => apiClient.get('/attendance/me/summary', { params }),

  // Org-wide records for a date (department reports).
  dayRecords: async (params = {}) => apiClient.get('/attendance/day', { params }),

  // Live status for the current user "today".
  today: async () => apiClient.get('/attendance/today'),

  checkIn: async ({ timezone } = {}) => apiClient.post('/attendance/check-in', { timezone }),
  checkOut: async () => apiClient.post('/attendance/check-out', {}),
  toggleBreak: async ({ onBreak } = {}) => apiClient.post('/attendance/break', { onBreak }),

  calendar: async () => apiClient.get('/attendance/calendar'),
  // Phase 5.7 (Task 5): accepts an optional { date } so the Company Attendance
  // Dashboard can summarise any day. Defaults to {} — existing callers that
  // pass no argument keep hitting today's summary exactly as before.
  stats: async (params = {}) => apiClient.get('/attendance/stats', { params }),

  // Shift & holiday collections (query/CRUD).
  shifts: {
    // Phase 5.9.1 hotfix: same latent defect as holidays.all below - '/' is the
    // paginated LIST route, not an array. Corrected preventively. Verified no
    // caller depended on the old envelope shape (shifts.all had no consumers).
    all: async () => apiClient.get('/attendance/shifts/all'),
    query: async (params = {}) => apiClient.get('/attendance/shifts', { params }),
    create: async (payload) => apiClient.post('/attendance/shifts', payload),
    update: async (id, patch) => apiClient.put(`/attendance/shifts/${id}`, patch),
    remove: async (id) => apiClient.delete(`/attendance/shifts/${id}`),
  },
  holidays: {
    // Phase 5.9.1 hotfix ROOT CAUSE: this said get('/attendance/holidays'),
    // which is the LIST route ('/'). buildResourceRouter's list handler returns
    // service.list() -> { data, total, page, limit, totalPages } (an OBJECT).
    // Callers expecting an array then crashed. The real "give me everything"
    // route is '/all', whose handler returns service.all() -> repository.findAll(),
    // a genuine array. Route order is safe: '/all' is declared before '/:id'.
    all: async () => apiClient.get('/attendance/holidays/all'),
    query: async (params = {}) => apiClient.get('/attendance/holidays', { params }),
    create: async (payload) => apiClient.post('/attendance/holidays', payload),
    update: async (id, patch) => apiClient.put(`/attendance/holidays/${id}`, patch),
    remove: async (id) => apiClient.delete(`/attendance/holidays/${id}`),
  },
}

// --- Leave Management API ---
export const leaveApi = {
  // Org-wide requests (approvals inbox / reports).
  query: async (params = {}) => apiClient.get('/leave/requests', { params }),
  // Current user's own requests.
  myRequests: async (params = {}) => apiClient.get('/leave/me', { params }),
  get: async (id) => apiClient.get(`/leave/requests/${id}`),

  apply: async (payload) => apiClient.post('/leave/apply', payload),

  // Phase 4 (Part 2): the approver comment is MANDATORY. The previous default
  // values ('Approved' / 'Rejected') were removed on purpose — a caller must now
  // pass a real comment, and the server returns 422 if it is blank.
  approve: async (id, comment) => apiClient.patch(`/leave/requests/${id}/approve`, { comment }),
  reject: async (id, comment) => apiClient.patch(`/leave/requests/${id}/reject`, { comment }),
  cancel: async (id) => apiClient.patch(`/leave/requests/${id}/cancel`, {}),
  remove: async (id) => apiClient.delete(`/leave/requests/${id}`),

  balances: async () => apiClient.get('/leave/balances'),
  stats: async () => apiClient.get('/leave/stats'),
  holidays: async () => apiClient.get('/leave/holidays'),

  // Phase 5.5 (Task 4): hourly permission. Approval/rejection/cancellation
  // deliberately reuse the leave methods above — an hourly permission is stored
  // as a LeaveRequest, so it flows through the same approval endpoints.
  hourlyBalance: async (month) => apiClient.get('/leave/hourly-balance', { params: month ? { month } : {} }),
  applyHourly: async (payload) => apiClient.post('/leave/hourly-permission', payload),

  // Leave type CRUD (EntityManager-compatible).
  types: {
    query: async (params = {}) => apiClient.get('/leave/types', { params }),
    create: async (payload) => apiClient.post('/leave/types', payload),
    update: async (id, patch) => apiClient.put(`/leave/types/${id}`, patch),
    remove: async (id) => apiClient.delete(`/leave/types/${id}`),
  },
}

// --- Project Management API ---
export const projectApi = {
  // Projects list (paginated + filtered) and CRUD.
  list: async (params = {}) => apiClient.get('/project', { params }),
  all: async () => apiClient.get('/project/all'),
  get: async (id) => apiClient.get(`/project/${id}`),
  create: async (payload) => apiClient.post('/project', payload),
  update: async (id, patch) => apiClient.put(`/project/${id}`, patch),
  remove: async (id) => apiClient.delete(`/project/${id}`),

  // Full detail bundle (project + tasks + sprints + milestones + files + activity).
  detail: async (id) => apiClient.get(`/project/${id}/detail`),

  // Phase 6.9 (Task 15): RBAC-scoped project events for the main Calendar merge.
  calendarEvents: async () => apiClient.get('/project/calendar-events'),

  // Phase 6.12 (TASK 1): the STAFF door onto the SAME shared project document
  // store the client portal writes to (ClientProject.documents[]). These are
  // the staff counterparts of clientService.uploadProjectDocument etc. - same
  // array, same /uploads directory, same document shape. Not a second document
  // module: only the router prefix differs, because /client/* is Client-only
  // and /project/* is staff-only.
  documents: async (id) => apiClient.get(`/project/${id}/documents`),
  uploadDocument: async (id, formData) =>
    apiClient.post(`/project/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteDocument: async (id, docId) => apiClient.delete(`/project/${id}/documents/${docId}`),
  downloadDocumentUrl: (id, docId) => `/project/${id}/documents/${docId}/download`,

  // --- Tasks / bugs ---
  tasks: async (params = {}) => apiClient.get('/project/tasks', { params }),
  createTask: async (payload) => apiClient.post('/project/tasks', payload),
  updateTask: async (id, patch) => apiClient.put(`/project/tasks/${id}`, patch),
  moveTask: async (id, status) => apiClient.patch(`/project/tasks/${id}/move`, { status }),
  assignSprint: async (id, sprint) => apiClient.patch(`/project/tasks/${id}/sprint`, { sprint }),
  removeTask: async (id) => apiClient.delete(`/project/tasks/${id}`),

  // Phase 4 (Parts 7-8): task submission and project-lead review.
  submitTask: async (id, payload) => apiClient.post(`/project/tasks/${id}/submit`, payload),
  // Phase 5.5 (Task 5): 'return' joined approve/reject as a real review
  // outcome. The action is now allow-listed rather than reduced to a binary,
  // so an unknown value fails loudly instead of silently rejecting the work.
  reviewTask: async (id, action, comment) => {
    const verb = ['approve', 'reject', 'return'].includes(action) ? action : 'reject'
    return apiClient.patch(`/project/tasks/${id}/review/${verb}`, { comment })
  },
  reviewQueue: async () => apiClient.get('/project/tasks/review-queue'),

  // Phase 6.2 (Task 2): acceptTask/declineTask removed. Employees no longer
  // accept or reject assigned work, so the client API surface for it is gone.
  // Unified task history remains (it is read-only and used by Task History).
  // params: { project?, mine?, status?, assignmentStatus?, from?, to? }
  taskHistory: async (params = {}) => apiClient.get('/project/tasks/history', { params }),

  // Phase 5.7 (Task 1): unified Client + Project creation. Provisions the
  // Client (reusing an existing one when the company already exists), an
  // optional portal login, the Project, and Finance initialisation in a single
  // atomic call.
  createWithClient: async (payload) => apiClient.post('/project/with-client', payload),

  // --- Sprints & milestones ---
  sprints: async (params = {}) => apiClient.get('/project/sprints/list', { params }),
  createSprint: async (payload) => apiClient.post('/project/sprints', payload),
  updateSprint: async (id, patch) => apiClient.put(`/project/sprints/${id}`, patch),
  removeSprint: async (id) => apiClient.delete(`/project/sprints/${id}`),

  milestones: async (params = {}) => apiClient.get('/project/milestones/list', { params }),
  createMilestone: async (payload) => apiClient.post('/project/milestones', payload),
  updateMilestone: async (id, patch) => apiClient.put(`/project/milestones/${id}`, patch),
  removeMilestone: async (id) => apiClient.delete(`/project/milestones/${id}`),

  // --- Comments / files / activity feed ---
  comments: async (params = {}) => apiClient.get('/project/comments', { params }),
  addComment: async (payload) => apiClient.post('/project/comments', payload),
  files: async (params = {}) => apiClient.get('/project/files', { params }),
  addFile: async (payload) => apiClient.post('/project/files', payload),
  activity: async (params = {}) => apiClient.get('/project/activity', { params }),

  stats: async () => apiClient.get('/project/stats'),
}

// --- Finance Management API ---
// Generic REST collection factory mapping to the Express backend.
const finCollection = (endpoint) => ({
  query: (params = {}) => apiClient.get(endpoint, { params }),
  all: () => apiClient.get(`${endpoint}/all`),
  get: (id) => apiClient.get(`${endpoint}/${id}`),
  create: (payload) => apiClient.post(endpoint, payload),
  update: (id, patch) => apiClient.put(`${endpoint}/${id}`, patch),
  remove: (id) => apiClient.delete(`${endpoint}/${id}`),
})

export const financeApi = {
  transactions: finCollection('/finance/transactions'),
  income: finCollection('/finance/transactions'),
  expenses: finCollection('/finance/transactions'),
  categories: finCollection('/finance/categories'),
  budgets: finCollection('/finance/budgets'),
  payments: finCollection('/finance/payments'),
  invoices: finCollection('/finance/invoices'),

  // Invoice create.
  createInvoice: async (payload) => apiClient.post('/finance/invoices/create', payload),
  // Record a payment against an invoice → updates paid amount + status.
  recordInvoicePayment: async (id, amount) => apiClient.patch(`/finance/invoices/${id}/pay`, { amount }),

  stats: async () => apiClient.get('/finance/stats'),
  taxReport: async () => apiClient.get('/finance/reports/tax'),
  periodReport: async (groupBy = 'month', year = 2026) => apiClient.get('/finance/reports/period', { params: { groupBy, year } }),
}

// --- Calendar Management API ---
export const calendarApi = {
  // All event masters.
  list: async () => apiClient.get('/calendar'),

  // Range-scoped list (overlap filter) — used by the real backend.
  range: async (from, to) => apiClient.get('/calendar/range', { params: { from, to } }),

  get: async (id) => apiClient.get(`/calendar/${id}`),

  create: async (payload) => apiClient.post('/calendar', payload),

  update: async (id, patch) => apiClient.put(`/calendar/${id}`, patch),

  remove: async (id) => apiClient.delete(`/calendar/${id}`),

  // Toggle completion for task-type events.
  toggleDone: async (id) => apiClient.patch(`/calendar/${id}/done`, {}),

  // Phase 6.9 (Task 17): Approve/Reject/Cancel a client meeting request.
  updateMeetingStatus: async (id, status) => apiClient.patch(`/calendar/${id}/meeting-status`, { status }),

  // Phase 6.12 (TASK 2): propose a new time for a client meeting request. A
  // narrow start/end-only action so a Project Lead can reschedule without
  // needing PUT /calendar/:id, which stays Admin/HR/Manager-only.
  reschedule: async (id, { start, end }) => apiClient.patch(`/calendar/${id}/reschedule`, { start, end }),
}

export const dashboardService = {
  stats: async () => apiClient.get('/dashboard/stats'),
}
