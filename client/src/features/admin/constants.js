import {
  FiUsers, FiShield, FiDatabase,
  FiCpu, FiServer, FiRefreshCw, FiBarChart2, FiFileText, FiBriefcase,
} from 'react-icons/fi'
// buildDefaultPermissions() iterates ALL_ROLES; it was previously referenced
// here without an import (latent ReferenceError). Imported from the single
// source of truth so the retired roles can never reappear in the matrix.
import { ALL_ROLES } from '@/constants'

// Admin sub-module navigation. Drives the AdminLayout side rail and the hub grid.
// Phase 6.16 (TASK 5) ROOT CAUSE: Permissions, API Keys, Company, Email, Theme,
// Security and Activity were plain UI-only settings screens with no other
// screen depending on their PAGE (their backend routes/services are kept -
// see server/src/routes/adminRoutes.js and client/src/api/adminApi.js - only
// the UI entry points are removed here). The Permissions BACKEND endpoint and
// its `PermissionsList` component are still used by pages/admin/UserDetail.jsx
// ( "Access for <role>" panel), so only the standalone Admin Panel page/route/
// nav entry for Permissions is removed - the endpoint, matrix constants and
// PermissionsList component are untouched and stay fully live.
export const ADMIN_SECTIONS = [
  { key: 'users', label: 'Users', path: '/admin/users', icon: FiUsers, tone: 'primary', desc: 'Accounts, roles & access' },
  { key: 'roles', label: 'Roles', path: '/admin/roles', icon: FiShield, tone: 'accent', desc: 'Define org roles' },
  { key: 'audit', label: 'Audit Logs', path: '/admin/audit-logs', icon: FiFileText, tone: 'primary', desc: 'Who did what, when' },
  { key: 'system', label: 'System Logs', path: '/admin/system-logs', icon: FiCpu, tone: 'danger', desc: 'Application events' },
  { key: 'backup', label: 'Backup', path: '/admin/backup', icon: FiServer, tone: 'success', desc: 'Scheduled & manual' },
  { key: 'restore', label: 'Restore', path: '/admin/restore', icon: FiRefreshCw, tone: 'accent', desc: 'Recover from snapshots' },
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
export const BACKUP_TYPES = ['Full', 'Incremental', 'Differential']
export const BACKUP_STATUS = ['Completed', 'In Progress', 'Failed']
export const LOG_SEVERITY = ['Info', 'Warning', 'Critical']
export const SYS_LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG']
export const THEME_MODES = ['light', 'dark', 'system']
export const DENSITY = ['Comfortable', 'Compact']
export const SIDEBAR = ['Expanded', 'Collapsed', 'Icon Only']
export const ENCRYPTION = ['None', 'SSL/TLS', 'STARTTLS']
export const EMAIL_PROVIDERS = ['SMTP', 'SendGrid', 'SES', 'Mailgun']
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED']
export const FISCAL_YEARS = ['January', 'April', 'July', 'October']

// --- Permission matrix config ---
export const ACCESS_LEVELS = ['Full', 'View', 'Deny']
// Phase 5.5 (Tasks 8/9): 'CRM' and 'Inventory' removed with their modules.
// Existing permission documents may still carry those keys; they are simply
// ignored because the matrix is rendered from this list.
export const ADMIN_MODULES = [
  'Dashboard', 'Employees', 'HR', 'Attendance', 'Leave',
  'Projects', 'Finance', 'Announcements', 'Files',
  'Calendar', 'Notifications', 'Reports', 'Admin',
]
export const ROLE_DESCRIPTIONS = {
  Admin: 'Unrestricted access to every module and setting (highest authority).',
  // HR absorbed the retired Sales and Finance roles in Phase 4.
  HR: 'Manages people, recruitment, payroll, performance and finance.',
  Manager: 'Oversees team, projects and approvals.',
  Employee: 'Standard self-service access to personal tools.',
  Client: 'Limited portal access to their own projects & invoices.',
}
// Build a sensible default matrix for every role.
export const buildDefaultPermissions = () =>
  Object.fromEntries(
    ALL_ROLES.map((role) => [
      role,
      Object.fromEntries(
        ADMIN_MODULES.map((mod) => {
          if (role === 'Admin') return [mod, 'Full']
          // HR inherits its own modules PLUS everything the retired roles
          // previously owned, so no permission is lost by retiring them
          // (Phase 4 folded in Finance). Phase 5.5 removed the CRM and
          // Inventory modules entirely, so they are no longer listed.
          if (role === 'HR') return [mod, ['Employees', 'HR', 'Attendance', 'Leave', 'Reports', 'Dashboard', 'Finance'].includes(mod) ? 'Full' : 'View']
          if (role === 'Manager') return [mod, ['Dashboard', 'Projects', 'Employees', 'Reports', 'Calendar'].includes(mod) ? 'Full' : 'View']
          return [mod, ['Dashboard', 'Calendar', 'Files', 'Notifications', 'Announcements', 'Leave', 'Attendance'].includes(mod) ? 'View' : 'Deny']
        })
      ),
    ])
  )
