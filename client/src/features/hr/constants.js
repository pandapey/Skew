import {
  FiGrid, FiBriefcase, FiAward, FiUsers, FiUserPlus, FiCalendar,
  FiFileText, FiCheckSquare, FiDollarSign, FiTrendingUp, FiRepeat, FiLogOut,
} from 'react-icons/fi'

// HR sub-module navigation — drives the hub grid and section headers.
export const HR_SECTIONS = [
  { key: 'departments', label: 'Departments', path: '/hr/departments', icon: FiBriefcase, tone: 'primary', desc: 'Org structure & budgets' },
  { key: 'designations', label: 'Designations', path: '/hr/designations', icon: FiAward, tone: 'accent', desc: 'Roles, levels & grades' },
  { key: 'recruitment', label: 'Recruitment', path: '/hr/recruitment', icon: FiUserPlus, tone: 'success', desc: 'Jobs, candidates & pipeline' },
  { key: 'interviews', label: 'Interviews', path: '/hr/interviews', icon: FiCalendar, tone: 'warning', desc: 'Schedule & track rounds' },
  { key: 'offers', label: 'Offer Letters', path: '/hr/offers', icon: FiFileText, tone: 'primary', desc: 'Generate & manage offers' },
  { key: 'onboarding', label: 'Onboarding', path: '/hr/onboarding', icon: FiCheckSquare, tone: 'accent', desc: 'New-hire checklists' },
  { key: 'payroll', label: 'Payroll', path: '/hr/payroll', icon: FiDollarSign, tone: 'success', desc: 'Salary slips & runs' },
  { key: 'performance', label: 'Performance', path: '/hr/performance', icon: FiTrendingUp, tone: 'warning', desc: 'Reviews & appraisals' },
  { key: 'movements', label: 'Transfers & Exits', path: '/hr/movements', icon: FiRepeat, tone: 'danger', desc: 'Promotion, transfer, exit' },
  { key: 'reports', label: 'HR Reports', path: '/hr/reports', icon: FiGrid, tone: 'primary', desc: 'Analytics & exports' },
]

export const DEPARTMENTS = ['Engineering', 'Sales', 'Human Resources', 'Finance', 'Marketing', 'Support', 'Operations']
export const JOB_TYPES = ['Full-time', 'Contract', 'Intern', 'Consultant']
export const JOB_STATUS = ['Open', 'On Hold', 'Closed']
export const CANDIDATE_STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected']
export const INTERVIEW_ROUNDS = ['Screening', 'Technical', 'Managerial', 'HR Round']
export const INTERVIEW_MODES = ['Video Call', 'On-site', 'Phone']
export const INTERVIEW_STATUS = ['Scheduled', 'Completed', 'Cancelled']
export const OFFER_STATUS = ['Pending', 'Sent', 'Accepted', 'Declined']
export const MOVEMENT_TYPES = ['Promotion', 'Transfer', 'Resignation', 'Exit']
export const MOVEMENT_STATUS = ['Pending', 'Approved', 'Rejected']
export const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5']
export const GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']

export const HR_WRITE_ROLES = ['Admin', 'HR']
