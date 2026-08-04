import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { ATTENDANCE_WRITE_ROLES } from '@/features/attendance/constants'
import { FINANCE_WRITE_ROLES } from '@/features/finance/constants'
import { HR_WRITE_ROLES } from '@/features/hr/constants'
import { PROJECT_WRITE_ROLES } from '@/features/projects/constants'

/**
 * ---------------------------------------------------------------------------
 * Phase 5.9 (Task 7) - EDIT BUTTON RBAC
 *
 * ROOT CAUSE
 * ----------
 * Edit affordances were never actually missing: `features/hr/EntityManager.jsx`
 * already renders an Edit and a Delete button per row, both gated behind
 * `canWrite = hasRole(writeRoles)`.
 *
 * The real defect was the DEFAULT on that prop:
 *
 *     headerActions, writeRoles = HR_WRITE_ROLES,
 *
 * Of the 13 pages that mount EntityManager, only TWO ever passed `writeRoles`
 * explicitly (pages/Clients.jsx and pages/admin/Roles.jsx, both ADMIN_WRITE_ROLES).
 * The other eleven silently inherited HR_WRITE_ROLES = ['Admin', 'HR'].
 *
 * That default is wrong in two different directions, which is why the symptom
 * looked like "some modules have no Edit button":
 *
 *   1. TOO STRICT - Shifts and the Holiday Calendar are attendance data. Their
 *      real permission set is ATTENDANCE_WRITE_ROLES = ['Admin','HR','Manager'],
 *      so a Manager who is entitled to edit them saw NO Edit button at all.
 *   2. TOO IMPLICIT - the remaining pages happened to land on the correct role
 *      set purely by accident of the default. Nothing declared their intent, so
 *      any future change to HR_WRITE_ROLES would silently re-permission
 *      unrelated modules across the app.
 *
 * FIX
 * ---
 * This module makes the permission for every editable module explicit and
 * declarative in ONE place. It does not invent a new permission system: it
 * composes the role constants that already exist per feature, and `useCanEdit`
 * delegates to the existing `useAuth().hasRole`. No RBAC is loosened anywhere -
 * the only role set that genuinely widens is Shifts/Holidays, which gains
 * Manager, matching ATTENDANCE_WRITE_ROLES that the attendance module already
 * enforces for its other writes (and which the server already authorises).
 *
 * Server-side authorisation is unchanged and remains the real gate. Everything
 * here is UI affordance only: hiding a button never grants access, and showing
 * one never bypasses `authorize(...)` on the Express route.
 * ---------------------------------------------------------------------------
 */

/** Only the user themselves (any role) - used for "my own profile" surfaces. */
export const SELF_ONLY = 'SELF_ONLY'

/**
 * Module -> roles allowed to see an Edit affordance.
 * Keys are stable identifiers, NOT display strings.
 */
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
  // Employees may edit their own personal information; Clients may edit their
  // own profile. Ownership is asserted at the call site (and on the server),
  // not by role alone.
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
