import {
  FiHome, FiUsers, FiShield, FiDatabase, FiBarChart2, FiTag,
  // ADMIN PANEL NAV (FINAL): FiUsers (Users), FiShield (Roles) and FiTag
  // (Plans) are restored for the ADMIN_SECTIONS entries below - Users / Roles
  // / Plans now live INSIDE the Admin Panel (they are not in the main
  // sidebar's NAV_ITEMS). `FiFileText` and `FiCpu` were the icons for the
  // Audit Logs and System Logs entries ONLY; those entries are removed below
  // (navigation-only - the routes, APIs and logging middleware are untouched).
} from 'react-icons/fi'
// buildDefaultPermissions() iterates ALL_ROLES; it was previously referenced
// here without an import (latent ReferenceError). Imported from the single
// source of truth so the retired roles can never reappear in the matrix.
import { ALL_ROLES } from '@/constants'

// Admin sub-module navigation. Drives the AdminLayout horizontal tab bar and
// the AdminHub "Admin Modules" grid.
// Phase 6.16 (TASK 5) ROOT CAUSE: Permissions, API Keys, Company, Email, Theme,
// Security and Activity were plain UI-only settings screens with no other
// screen depending on their PAGE (their backend routes/services are kept -
// see server/src/routes/adminRoutes.js and client/src/api/adminApi.js - only
// the UI entry points are removed here). The Permissions BACKEND endpoint and
// the permission matrix are untouched and stay fully live.
export const ADMIN_SECTIONS = [
  // ADMIN CONSOLE DASHBOARD TAB: Dashboard is the FIRST section. It points at
  // the EXISTING /admin index route (pages/admin/AdminHub.jsx - the same
  // console overview the 'Admin Panel' sidebar item opens), so no second
  // dashboard page exists. `match: 'exact'` tells AdminLayout to highlight it
  // only on /admin itself, never on /admin/* sub-pages.
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: FiHome, tone: 'primary', desc: 'Console overview', match: 'exact' },
  // ADMIN PANEL NAV (FINAL): Users / Roles / Plans are ADMIN PANEL sections
  // again - listed HERE (the Admin console's own navigation) and NOT in the
  // main sidebar's NAV_ITEMS, so they are reachable only through the Admin
  // Panel (horizontal tabs + the AdminHub "Admin Modules" grid). This array
  // is the single source for BOTH the AdminLayout tab bar and the AdminHub
  // grid. The /admin/users, /admin/roles and /admin/plans routes, pages,
  // models, controllers, services, APIs and RBAC are all untouched (the
  // multi-step user creation wizard stays at /admin/users/new). The 'audit'
  // and 'system' entries remain removed (routes, APIs and logging untouched -
  // still reachable at /admin/audit-logs and /admin/system-logs).
  { key: 'users', label: 'Users', path: '/admin/users', icon: FiUsers, tone: 'primary', desc: 'Accounts, roles & access' },
  { key: 'roles', label: 'Roles', path: '/admin/roles', icon: FiShield, tone: 'accent', desc: 'Define org roles' },
  { key: 'plans', label: 'Plans', path: '/admin/plans', icon: FiTag, tone: 'success', desc: 'Client subscription plans' },
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
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 4 / TASK 14): `BACKUP_TYPES` and
// `BACKUP_STATUS` are REMOVED. A repo-wide search found exactly one consumer for
// each - pages/admin/Backup.jsx, which is deleted this phase - so they are now
// genuinely unreferenced. The SERVER-side vocabulary is unaffected: the Backup
// model in server/src/models/adminModels.js keeps its own enums, and the backup
// endpoints still accept and return them.
export const LOG_SEVERITY = ['Info', 'Warning', 'Critical']
export const SYS_LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG']
// PHASE ADMIN ATTENDANCE (TASK 4): the System Log Source filter used to offer a
// hardcoded list of seven invented service names ('mailer', 'file-storage',
// 'cache-node', …) that no record could ever carry. These four mirror
// SYSTEM_LOG_SOURCES in server/src/utils/systemLog.js — the sources the server
// actually writes — so every option can match real data.
export const SYS_SOURCES = ['api-gateway', 'auth-service', 'db-connector', 'cron-scheduler']
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
  // Phase 7.2: HR was retired and merged into Manager — Manager now owns the
  // former HR surface (people, recruitment, payroll, performance, finance)
  // on top of its own team/project/approval duties.
  Manager: 'Owns people, recruitment, payroll, performance, finance, team, projects and approvals.',
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
          // Phase 7.2: HR was retired and merged into Manager. The Manager
          // arm therefore carries everything the old HR arm granted (its own
          // modules PLUS the retired Sales/Finance inheritance) in addition to
          // its own module grants, so no permission is lost by the merge.
          if (role === 'Manager') return [mod, ['Dashboard', 'Projects', 'Employees', 'HR', 'Attendance', 'Leave', 'Reports', 'Calendar', 'Finance'].includes(mod) ? 'Full' : 'View']
          return [mod, ['Dashboard', 'Calendar', 'Files', 'Notifications', 'Announcements', 'Leave', 'Attendance'].includes(mod) ? 'View' : 'Deny']
        })
      ),
    ])
  )
