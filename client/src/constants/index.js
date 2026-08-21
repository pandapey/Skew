// Application-wide constants

// PHASE BRANDING: APP_NAME is the neutral product name (no company wording) —
// it feeds the browser tab title, the boot loader and nothing else on the
// auth/nav surfaces, which are now logo-only. COMPANY_NAME is intentionally
// KEPT: it is the legal company name used on payslips, offer letters, export
// letterheads and copyright footers (document/legal information, not
// login/navbar branding).
export const APP_NAME = 'EMS'
export const COMPANY_NAME = 'Skew Infotech Pvt. Ltd.'

// Role restructuring. Mirrors the server enum in server/src/models/User.js.
//   Phase 4: Super Admin folded into Admin (Admin is now the highest
//            authority); Sales and Finance folded into HR.
//   Phase 5: Inventory folded into HR.
//   Phase 7.2: HR retired entirely and merged into Manager. The final role set
//            is Admin / Manager / Employee / Client.
// NOTE: Phase 5.5 (Task 9) removed the Inventory MODULE as well, so no
// navigation entry, route or permission-matrix column remains for it.
export const ROLES = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  CLIENT: 'Client',
}

export const ALL_ROLES = Object.values(ROLES)

// Internal staff roles = everyone except external Clients. Used to gate shared
// routes (e.g. global search) that must never expose internal data to clients.
export const STAFF_ROLES = ALL_ROLES.filter((r) => r !== ROLES.CLIENT)

export const STORAGE_KEYS = {
  TOKEN: 'seh_token',
  REFRESH: 'seh_refresh',
  THEME: 'seh_theme',
}

export const LEAVE_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  // Phase 5: terminal state for a request that was never actioned before the
  // shift start time on its first day of leave.
  EXPIRED: 'Expired',
}

export const PRIORITY = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

export const TASK_STATUS = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Done',
}
