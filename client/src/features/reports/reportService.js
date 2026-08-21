import apiClient from '@/api/client'

const ENDPOINTS = {
  dashboard: '/reports/dashboard',
  employees: '/reports/employees',
  attendance: '/reports/attendance',
  leaves: '/reports/leaves',
  finance: '/reports/finance',
  projects: '/reports/projects',
}

// Normalize params so empty filters aren't sent.
const clean = (params = {}) => {
  const p = {}
  if (params.from) p.from = params.from
  if (params.to) p.to = params.to
  if (params.department && params.department !== 'all') p.department = params.department
  return p
}

const call = async (key, params) => {
  return apiClient.get(ENDPOINTS[key], { params: clean(params) })
}

export const reportService = {
  dashboard: (params) => call('dashboard', params),
  employees: (params) => call('employees', params),
  attendance: (params) => call('attendance', params),
  leaves: (params) => call('leaves', params),
  finance: (params) => call('finance', params),
  projects: (params) => call('projects', params),
}
