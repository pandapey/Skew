import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { ATTENDANCE_WRITE_ROLES } from '@/features/attendance/constants'
import { FINANCE_WRITE_ROLES } from '@/features/finance/constants'
import { HR_WRITE_ROLES } from '@/features/hr/constants'
import { PROJECT_WRITE_ROLES } from '@/features/projects/constants'

export const SELF_ONLY = 'SELF_ONLY'

export const MODULE_EDIT_ROLES = {
  // --- Admin-owned -----------------------------------------------------
  users: ADMIN_WRITE_ROLES,                 // ['Admin']
  clients: ADMIN_WRITE_ROLES,               // ['Admin']
  roles: ADMIN_WRITE_ROLES,                 // ['Admin']

  // --- HR-owned --------------------------------------------------------
  departments: HR_WRITE_ROLES,              // ['Admin','HR']
  designations: HR_WRITE_ROLES,
  employees: HR_WRITE_ROLES,
  leaveTypes: HR_WRITE_ROLES,
  recruitment: HR_WRITE_ROLES,
  interviews: HR_WRITE_ROLES,
  offers: HR_WRITE_ROLES,
  movements: HR_WRITE_ROLES,
  performance: HR_WRITE_ROLES,

  // --- Attendance-owned (Manager included) ------------------------------
  attendance: ATTENDANCE_WRITE_ROLES,       // ['Admin','HR','Manager']
  shifts: ATTENDANCE_WRITE_ROLES,
  holidays: ATTENDANCE_WRITE_ROLES,

  // --- Delivery-owned ---------------------------------------------------
  projects: PROJECT_WRITE_ROLES,            // ['Admin','Manager','HR']
  tasks: PROJECT_WRITE_ROLES,
  documents: PROJECT_WRITE_ROLES,
  announcements: PROJECT_WRITE_ROLES,
  calendarEvents: PROJECT_WRITE_ROLES,

  // --- Finance-owned ----------------------------------------------------
  payroll: FINANCE_WRITE_ROLES,             // ['Admin','HR']

  // --- Self-service -----------------------------------------------------
  ownProfile: SELF_ONLY,
}

/**
 * Hook: may the current user edit this module?
 *
 * Reuses the existing `useAuth().hasRole` helper - no parallel RBAC logic.
 *
 * @param {keyof typeof MODULE_EDIT_ROLES} moduleKey
 * @param {{ ownerId?: string }} [opts] ownership check for SELF_ONLY modules
 * @returns {boolean}
 */
export function useCanEdit(moduleKey, opts = {}) {
  const { user, hasRole } = useAuth()
  const allowed = MODULE_EDIT_ROLES[moduleKey]

  // Unknown module key: deny. Failing closed is the only safe default for a
  // permission helper - a typo must never silently grant edit rights.
  if (!allowed) return false

  if (allowed === SELF_ONLY) {
    if (!opts.ownerId) return false
    // Admin retains full oversight, matching "Admin can edit everything".
    if (hasRole(ROLES.ADMIN)) return true
    return String(opts.ownerId) === String(user?.id ?? user?._id ?? '')
  }

  return hasRole(allowed)
}

/**
 * Non-hook accessor for places that already hold a `hasRole` reference
 * (e.g. inside a callback or a non-component helper).
 */
export function canEditWith(hasRole, moduleKey) {
  const allowed = MODULE_EDIT_ROLES[moduleKey]
  if (!allowed || allowed === SELF_ONLY) return false
  return hasRole(allowed)
}
