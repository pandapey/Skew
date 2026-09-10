import apiClient from './client'

const resource = (endpoint) => ({
  list: (params) => apiClient.get(endpoint, { params }),
  get: (id) => apiClient.get(`${endpoint}/${id}`),
  create: (payload) => apiClient.post(endpoint, payload),
  update: (id, payload) => apiClient.put(`${endpoint}/${id}`, payload),
  remove: (id) => apiClient.delete(`${endpoint}/${id}`),
})

export const authService = {

  login: async ({ email, password, device, browser, os }) => {
    return apiClient.post('/auth/login', { email, password, device, browser, os })
  },
  me: () => apiClient.get('/auth/me'),
  logout: async (sessionId) => apiClient.post('/auth/logout', { sessionId }),
  uploadAvatar: async (file) => {
    const fd = new FormData()
    fd.append('avatar', file)
    return apiClient.post('/auth/me/avatar', fd, {
      timeout: 60000,
      skipRetry: true,
      skipErrorToast: true,
    })
  },
  deleteAvatar: async () => apiClient.delete('/auth/me/avatar'),
  changePassword: async ({ currentPassword, newPassword, confirmPassword }) =>
    apiClient.post('/auth/me/password', { currentPassword, newPassword, confirmPassword }),
}

export const employeeService = resource('/employees')

export const employeeApi = {

  query: async (params = {}) => apiClient.get('/employees', { params }),

  create: async (payload) => apiClient.post('/employees', payload),

  get: async (id) => apiClient.get(`/employees/${id}`),

  myProfile: async () => apiClient.get('/employees/me'),

  update: async (id, payload) => apiClient.put(`/employees/${id}`, payload),

  remove: async (id) => apiClient.delete(`/employees/${id}`),

  bulkRemove: async (ids) => apiClient.post('/employees/bulk-delete', { ids }),

  bulkUpdate: async (ids, patch) => apiClient.post('/employees/bulk-update', { ids, patch }),

  stats: async () => apiClient.get('/employees/stats'),

  uploadPhoto: async (id, file) => {
    const fd = new FormData()
    fd.append('photo', file)
    return apiClient.post(`/employees/${id}/photo`, fd)
  },

  uploadDocument: async (id, file, category = 'General') => {
    const fd = new FormData()
    fd.append('document', file)
    fd.append('category', category)
    return apiClient.post(`/employees/${id}/documents`, fd)
  },

  updateSelf: async (payload) => apiClient.put('/employees/me', payload),

  uploadSelfDocument: async (file, category = 'General') => {
    const fd = new FormData()
    fd.append('document', file)
    fd.append('category', category)
    return apiClient.post('/employees/me/documents', fd)
  },
  selfDocumentUrl: (docId) => `/employees/me/documents/${docId}`,
  deleteSelfDocument: async (docId) => apiClient.delete(`/employees/me/documents/${docId}`),
  documentUrl: (id, docId) => `/employees/${id}/documents/${docId}`,
}
export const attendanceService = resource('/attendance')
export const leaveService = resource('/leaves')
export const projectService = resource('/projects')
export const taskService = resource('/tasks')
export const financeService = resource('/transactions')

export const announcementApi = {

  list: async (params = {}) => apiClient.get('/announcements', { params }),

  get: async (id) => apiClient.get(`/announcements/${id}`),

  create: async (payload) => apiClient.post('/announcements', payload),

  update: async (id, patch) => apiClient.put(`/announcements/${id}`, patch),

  remove: async (id) => apiClient.delete(`/announcements/${id}`),

  like: async (id) => apiClient.patch(`/announcements/${id}/like`, {}),

  comment: async (id, body) => apiClient.post(`/announcements/${id}/comments`, { body }),

  uploadMedia: async (id, file) => {
    const fd = new FormData()
    fd.append('media', file)
    return apiClient.post(`/announcements/${id}/media`, fd)
  },

  markRead: async (id) => apiClient.post(`/announcements/${id}/read`),
  unreadCount: async () => apiClient.get('/announcements/unread-count'),
}
export const fileService = {
  list: async (params = {}) => apiClient.get('/files', { params }),

  storage: async () => apiClient.get('/files/storage'),

  createFolder: async ({ name, parent }) => apiClient.post('/files/folders', { name, parent }),

  get: async (id) => apiClient.get(`/files/${id}`),

  upload: async (file, { folder, onProgress } = {}) => {
    const fd = new FormData()
    fd.append('file', file)
    if (folder && folder !== 'root') fd.append('folder', folder)
    return apiClient.post('/files/upload', fd, {
      onUploadProgress: (e) => onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
  },

  download: async (id) => apiClient.get(`/files/${id}/download`, { responseType: 'blob' }),

  update: async (id, patch) => apiClient.patch(`/files/${id}`, patch),

  remove: async (id) => apiClient.delete(`/files/${id}`),
  bulkDelete: async (ids) => apiClient.post('/files/bulk-delete', { ids }),
  bulkHardDelete: async (ids) => apiClient.post('/files/bulk-hard-delete', { ids }),
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

const hrCollection = (endpoint) => ({
  query: (params = {}) => apiClient.get(endpoint, { params }),
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
    run: (payload) => apiClient.post('/hr/payroll/run', payload),
    me: () => apiClient.get('/hr/payroll/me'),
    mySalary: (params = {}) => apiClient.get('/hr/payroll/me/salary', { params }),
  },

  payrollSettings: {
    get: () => apiClient.get('/hr/payroll-settings'),
    update: (payload) => apiClient.put('/hr/payroll-settings', payload),
  },
  reviews: hrCollection('/hr/reviews'),
  movements: hrCollection('/hr/movements'),

  moveCandidate: async (id, stage) => apiClient.patch(`/hr/candidates/${id}/stage`, { stage }),

  stats: async () => apiClient.get('/hr/stats'),

  clientBilling: async () => apiClient.get('/hr/client-billing'),
}

export const attendanceApi = {

  myHistory: async (params = {}) => apiClient.get('/attendance/me', { params }),

  mySummary: async (params = {}) => apiClient.get('/attendance/me/summary', { params }),

  dayRecords: async (params = {}) => apiClient.get('/attendance/day', { params }),

  today: async () => apiClient.get('/attendance/today'),

  checkIn: async ({ timezone } = {}) => apiClient.post('/attendance/check-in', { timezone }),
  checkOut: async () => apiClient.post('/attendance/check-out', {}),
  toggleBreak: async ({ onBreak } = {}) => apiClient.post('/attendance/break', { onBreak }),

  calendar: async (params = {}) => apiClient.get('/attendance/calendar', { params }),
  stats: async (params = {}) => apiClient.get('/attendance/stats', { params }),

  shifts: {
    all: async () => apiClient.get('/attendance/shifts/all'),
    query: async (params = {}) => apiClient.get('/attendance/shifts', { params }),
    create: async (payload) => apiClient.post('/attendance/shifts', payload),
    update: async (id, patch) => apiClient.put(`/attendance/shifts/${id}`, patch),
    remove: async (id) => apiClient.delete(`/attendance/shifts/${id}`),
  },
  holidays: {
    all: async () => apiClient.get('/attendance/holidays/all'),
    query: async (params = {}) => apiClient.get('/attendance/holidays', { params }),
    create: async (payload) => apiClient.post('/attendance/holidays', payload),
    update: async (id, patch) => apiClient.put(`/attendance/holidays/${id}`, patch),
    remove: async (id) => apiClient.delete(`/attendance/holidays/${id}`),
  },
}

export const leaveApi = {

  query: async (params = {}) => apiClient.get('/leave/requests', { params }),

  myRequests: async (params = {}) => apiClient.get('/leave/me', { params }),
  get: async (id) => apiClient.get(`/leave/requests/${id}`),

  apply: async (payload) => apiClient.post('/leave/apply', payload),

  approve: async (id, comment) => apiClient.patch(`/leave/requests/${id}/approve`, { comment }),
  reject: async (id, comment) => apiClient.patch(`/leave/requests/${id}/reject`, { comment }),
  cancel: async (id) => apiClient.patch(`/leave/requests/${id}/cancel`, {}),
  remove: async (id) => apiClient.delete(`/leave/requests/${id}`),

  balances: async () => apiClient.get('/leave/balances'),
  stats: async () => apiClient.get('/leave/stats'),
  holidays: async () => apiClient.get('/leave/holidays'),
  hourlyBalance: async (month) => apiClient.get('/leave/hourly-balance', { params: month ? { month } : {} }),
  applyHourly: async (payload) => apiClient.post('/leave/hourly-permission', payload),

  types: {
    query: async (params = {}) => apiClient.get('/leave/types', { params }),
    create: async (payload) => apiClient.post('/leave/types', payload),
    update: async (id, patch) => apiClient.put(`/leave/types/${id}`, patch),
    remove: async (id) => apiClient.delete(`/leave/types/${id}`),
  },
}

export const projectApi = {

  list: async (params = {}) => apiClient.get('/project', { params }),
  all: async () => apiClient.get('/project/all'),
  get: async (id) => apiClient.get(`/project/${id}`),
  create: async (payload) => apiClient.post('/project', payload),
  update: async (id, patch) => apiClient.put(`/project/${id}`, patch),
  remove: async (id) => apiClient.delete(`/project/${id}`),

  detail: async (id) => apiClient.get(`/project/${id}/detail`),

  calendarEvents: async () => apiClient.get('/project/calendar-events'),

  documents: async (id) => apiClient.get(`/project/${id}/documents`),
  uploadDocument: async (id, formData) =>
    apiClient.post(`/project/${id}/documents`, formData),
  deleteDocument: async (id, docId) => apiClient.delete(`/project/${id}/documents/${docId}`),
  downloadDocumentUrl: (id, docId) => `/project/${id}/documents/${docId}/download`,

  tasks: async (params = {}) => apiClient.get('/project/tasks', { params }),
  myTasksCount: async () => apiClient.get('/project/tasks/mine/count'),
  markTaskViewed: async (id) => apiClient.post(`/project/tasks/${id}/view`),
  createTask: async (payload) => apiClient.post('/project/tasks', payload),
  updateTask: async (id, patch) => apiClient.put(`/project/tasks/${id}`, patch),
  moveTask: async (id, status) => apiClient.patch(`/project/tasks/${id}/move`, { status }),
  assignSprint: async (id, sprint) => apiClient.patch(`/project/tasks/${id}/sprint`, { sprint }),
  removeTask: async (id) => apiClient.delete(`/project/tasks/${id}`),

  submitTask: async (id, payload) => apiClient.post(`/project/tasks/${id}/submit`, payload),

  startTask: async (id) => apiClient.post(`/project/tasks/${id}/start`),
  pauseTask: async (id, reason) => apiClient.post(`/project/tasks/${id}/pause`, { reason }),
  resumeTask: async (id) => apiClient.post(`/project/tasks/${id}/resume`),
  setTaskStatus: async (id, status) => apiClient.patch(`/project/tasks/${id}/status`, { status }),

  uploadTaskAttachment: async (id, formData) =>
    apiClient.post(`/project/tasks/${id}/attachments`, formData),

  reviewTask: async (id, action, comment) => {
    const verb = ['approve', 'reject', 'return'].includes(action) ? action : 'reject'
    return apiClient.patch(`/project/tasks/${id}/review/${verb}`, { comment })
  },
  reviewQueue: async () => apiClient.get('/project/tasks/review-queue'),

  taskHistory: async (params = {}) => apiClient.get('/project/tasks/history', { params }),

  assignees: async () => apiClient.get('/project/assignees'),

  createWithClient: async (payload) => apiClient.post('/project/with-client', payload),

  sprints: async (params = {}) => apiClient.get('/project/sprints/list', { params }),
  createSprint: async (payload) => apiClient.post('/project/sprints', payload),
  updateSprint: async (id, patch) => apiClient.put(`/project/sprints/${id}`, patch),
  removeSprint: async (id) => apiClient.delete(`/project/sprints/${id}`),

  milestones: async (params = {}) => apiClient.get('/project/milestones/list', { params }),
  createMilestone: async (payload) => apiClient.post('/project/milestones', payload),
  updateMilestone: async (id, patch) => apiClient.put(`/project/milestones/${id}`, patch),
  removeMilestone: async (id) => apiClient.delete(`/project/milestones/${id}`),

  comments: async (params = {}) => apiClient.get('/project/comments', { params }),
  addComment: async (payload) => apiClient.post('/project/comments', payload),
  files: async (params = {}) => apiClient.get('/project/files', { params }),
  addFile: async (payload) => apiClient.post('/project/files', payload),
  activity: async (params = {}) => apiClient.get('/project/activity', { params }),

  stats: async () => apiClient.get('/project/stats'),
}

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

  createInvoice: async (payload) => apiClient.post('/finance/invoices/create', payload),

  recordInvoicePayment: async (id, amount) => apiClient.patch(`/finance/invoices/${id}/pay`, { amount }),

  stats: async () => apiClient.get('/finance/stats'),
  taxReport: async () => apiClient.get('/finance/reports/tax'),
  periodReport: async (groupBy = 'month', year = 2026) => apiClient.get('/finance/reports/period', { params: { groupBy, year } }),
}

export const calendarApi = {

  list: async () => apiClient.get('/calendar'),

  range: async (from, to) => apiClient.get('/calendar/range', { params: { from, to } }),

  get: async (id) => apiClient.get(`/calendar/${id}`),

  create: async (payload) => apiClient.post('/calendar', payload),

  update: async (id, patch) => apiClient.put(`/calendar/${id}`, patch),

  remove: async (id) => apiClient.delete(`/calendar/${id}`),

  toggleDone: async (id) => apiClient.patch(`/calendar/${id}/done`, {}),

  updateMeetingStatus: async (id, status) => apiClient.patch(`/calendar/${id}/meeting-status`, { status }),

  reschedule: async (id, { start, end }) => apiClient.patch(`/calendar/${id}/reschedule`, { start, end }),
}

export const dashboardService = {
  stats: async () => apiClient.get('/dashboard/stats'),
}
