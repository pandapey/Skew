import {
  FiColumns, FiList, FiZap, FiAlertCircle, FiImage, FiFileText,
  FiFlag, FiClock, FiPieChart, FiFile, FiArchive, FiCode,
} from 'react-icons/fi'

// Project sub-module navigation — drives the hub grid.
export const PROJECT_SECTIONS = [
  { key: 'board', label: 'Kanban Board', path: '/projects/board', icon: FiColumns, tone: 'primary', desc: 'Drag tasks across stages' },
  { key: 'backlog', label: 'Backlog', path: '/projects/backlog', icon: FiList, tone: 'accent', desc: 'Groom unscheduled work' },
  { key: 'sprints', label: 'Sprint Planning', path: '/projects/sprints', icon: FiZap, tone: 'primary', desc: 'Plan sprints & capacity' },
  { key: 'bugs', label: 'Bug Tracking', path: '/projects/bugs', icon: FiAlertCircle, tone: 'danger', desc: 'Track and squash bugs' },
  { key: 'milestones', label: 'Milestones', path: '/projects/milestones', icon: FiFlag, tone: 'warning', desc: 'Key delivery targets' },
  { key: 'timeline', label: 'Timeline', path: '/projects/timeline', icon: FiClock, tone: 'primary', desc: 'Gantt-style schedule' },
  { key: 'reports', label: 'Reports & Analytics', path: '/projects/reports', icon: FiPieChart, tone: 'success', desc: 'Charts & exports' },
]

export const TASK_STATUSES = ['Todo', 'In Progress', 'Review', 'Done']
export const TASK_TYPES = ['Task', 'Bug', 'Story', 'Improvement']
export const PROJECT_STATUSES = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled']
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
export const SEVERITIES = ['Minor', 'Major', 'Critical', 'Blocker']
export const SPRINT_STATUSES = ['Planned', 'Active', 'Completed']
export const MILESTONE_STATUSES = ['Upcoming', 'In Progress', 'Reached', 'Missed']
export const STORY_POINTS = [1, 2, 3, 5, 8, 13]

export const PROJECT_WRITE_ROLES = ['Admin', 'Manager']

export const PROJECT_DRAFT_KEY = 'skew_project_draft'

export const TASK_EVENTS = [
  'Assigned', 'Accepted', 'Rejected', 'Reassigned',
  'Submitted', 'Approved', 'Returned', 'Completed',
]
export const TASK_EVENT_TONE = {
  Assigned: 'accent',
  Accepted: 'primary',
  Rejected: 'danger',
  Reassigned: 'warning',
  Submitted: 'primary',
  Approved: 'success',
  Returned: 'warning',
  Completed: 'success',
}

export const ASSIGNMENT_STATUSES = ['Assigned', 'Accepted', 'Rejected', 'Reassigned']
export const SUBMISSION_STATUSES = ['Not Submitted', 'Submitted', 'Approved', 'Rejected', 'Returned']
export const ASSIGNMENT_STATUS_TONE = {
  Assigned: 'default', Accepted: 'success', Rejected: 'danger', Reassigned: 'warning',
}

export const PRIORITY_TONE = { Low: 'default', Medium: 'accent', High: 'warning', Urgent: 'danger' }
export const SEVERITY_TONE = { Minor: 'default', Major: 'accent', Critical: 'warning', Blocker: 'danger' }
export const TASK_STATUS_TONE = { Todo: 'default', 'In Progress': 'primary', Review: 'warning', Done: 'success' }
export const PROJECT_STATUS_TONE = { Planning: 'accent', Active: 'primary', 'On Hold': 'warning', Completed: 'success', Cancelled: 'danger' }
export const TYPE_TONE = { Task: 'primary', Bug: 'danger', Story: 'accent', Improvement: 'warning' }
export const MILESTONE_TONE = { Upcoming: 'default', 'In Progress': 'primary', Reached: 'success', Missed: 'danger' }

// Kanban column top-border accents.
export const COLUMN_BORDER = {
  Todo: 'border-t-slate-400', 'In Progress': 'border-t-primary', Review: 'border-t-warning', Done: 'border-t-success',
}

export const MEMBER_ROLES = ['Lead', 'Member', 'QA', 'Designer', 'Backend', 'Frontend', 'DevOps']

// File-type presentation: icon + tone by stored `type` string.
export const FILE_TYPE_META = {
  pdf: { icon: FiFileText, tone: 'danger' },
  image: { icon: FiImage, tone: 'accent' },
  design: { icon: FiImage, tone: 'accent' },
  doc: { icon: FiFileText, tone: 'primary' },
  word: { icon: FiFileText, tone: 'primary' },
  excel: { icon: FiFileText, tone: 'success' },
  zip: { icon: FiArchive, tone: 'warning' },
  code: { icon: FiCode, tone: 'primary' },
  file: { icon: FiFile, tone: 'default' },
}
export const fileMeta = (type) => FILE_TYPE_META[type] || FILE_TYPE_META.file

export const PROJECT_DETAIL_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'board', label: 'Tasks' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'sprints', label: 'Sprints' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'documents', label: 'Documents' },
  { key: 'files', label: 'Files' },
  { key: 'members', label: 'Members' },
  { key: 'meetings', label: 'Meeting Requests' },
  { key: 'comments', label: 'Comments' },
  { key: 'activity', label: 'Activity' },
]

export const MANAGER_HIDDEN_SECTION_KEYS = ['backlog', 'sprints', 'milestones']
export const MANAGER_HIDDEN_DETAIL_TAB_KEYS = ['backlog', 'sprints', 'milestones', 'files', 'activity']
