import {
  FiHome, FiUsers, FiShield, FiDatabase, FiBarChart2, FiTag, FiGlobe,
} from 'react-icons/fi'
import { ALL_ROLES } from '@/constants'

export const ADMIN_SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: FiHome, tone: 'primary', desc: 'Console overview', match: 'exact' },
  { key: 'users', label: 'Users', path: '/admin/users', icon: FiUsers, tone: 'primary', desc: 'Accounts, roles & access' },
  { key: 'roles', label: 'Roles', path: '/admin/roles', icon: FiShield, tone: 'accent', desc: 'Define org roles' },
  { key: 'plans', label: 'Plans', path: '/admin/plans', icon: FiTag, tone: 'success', desc: 'Client subscription plans' },
  { key: 'domain-plans', label: 'Domain Plans', path: '/admin/domain-plans', icon: FiGlobe, tone: 'primary', desc: 'Domain creation plans' },
  { key: 'dbhealth', label: 'Database', path: '/admin/database-health', icon: FiDatabase, tone: 'primary', desc: 'MongoDB health & stats' },
  { key: 'analytics', label: 'Analytics', path: '/admin/analytics', icon: FiBarChart2, tone: 'success', desc: 'Usage & trends' },
]

export const ADMIN_WRITE_ROLES = ['Admin']

export const USER_STATUSES = ['Active', 'Inactive', 'Suspended', 'Pending', 'Blocked']
export const USER_DEPARTMENTS = [
  'Management', 'Engineering', 'Human Resources', 'Sales', 'Finance',
  'Marketing', 'Design', 'Operations', 'Support', 'Legal',
]
export const API_ENVIRONMENTS = ['Production', 'Staging', 'Development']
export const API_SCOPES = ['read', 'write', 'admin']
export const PERMISSION_LEVELS = ['Full', 'View', 'Deny']
export const LOG_SEVERITY = ['Info', 'Warning', 'Critical']
export const SYS_LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG']
export const SYS_SOURCES = ['api-gateway', 'auth-service', 'db-connector', 'cron-scheduler']
export const THEME_MODES = ['light', 'dark', 'system']
export const DENSITY = ['Comfortable', 'Compact']
export const SIDEBAR = ['Expanded', 'Collapsed', 'Icon Only']
export const ENCRYPTION = ['None', 'SSL/TLS', 'STARTTLS']
export const EMAIL_PROVIDERS = ['SMTP', 'SendGrid', 'SES', 'Mailgun']
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED']
export const FISCAL_YEARS = ['January', 'April', 'July', 'October']

export const ACCESS_LEVELS = ['Full', 'View', 'Deny']
export const ADMIN_MODULES = [
  'Dashboard', 'Employees', 'HR', 'Attendance', 'Leave',
  'Projects', 'Finance', 'Announcements', 'Files',
  'Calendar', 'Notifications', 'Reports', 'Admin',
]
export const ROLE_DESCRIPTIONS = {
  Admin: 'Unrestricted access to every module and setting (highest authority).',
  Manager: 'Owns people, recruitment, payroll, performance, finance, team, projects and approvals.',
  Employee: 'Standard self-service access to personal tools.',
  Client: 'Limited portal access to their own projects & invoices.',
}

export const buildDefaultPermissions = () =>
  Object.fromEntries(
    ALL_ROLES.map((role) => [
      role,
      Object.fromEntries(
        ADMIN_MODULES.map((mod) => {
          if (role === 'Admin') return [mod, 'Full']
          if (role === 'Manager') return [mod, ['Dashboard', 'Projects', 'Employees', 'HR', 'Attendance', 'Leave', 'Reports', 'Calendar', 'Finance'].includes(mod) ? 'Full' : 'View']
          return [mod, ['Dashboard', 'Calendar', 'Files', 'Notifications', 'Announcements', 'Leave', 'Attendance'].includes(mod) ? 'View' : 'Deny']
        })
      ),
    ])
  )
