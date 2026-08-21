// ---------------------------------------------------------------------------
// Phase 6.1: role scoping helpers (HR & Manager self-service)
// ---------------------------------------------------------------------------
// ROOT CAUSE this file addresses:
//   Before Phase 6.1, every /api/admin/clients* endpoint sat behind
//   `authorize('Admin')` (clientRoutes.js) and employee writes behind
//   `authorize('Admin','HR')` (employeeRoutes.js). HR and Manager therefore had
//   NO server-side path to clients at all, which is why client creation was
//   only reachable through the Admin panel.
//
//   Simply widening those authorize() calls to include 'Manager' would have
//   exposed EVERY client and EVERY employee in the company to any Manager -
//   privilege escalation. The spec requires Manager to be limited to "their own
//   projects' clients" and "their team's employees", but no such scoping logic
//   existed anywhere in the codebase. This module adds it in ONE place so the
//   rule is not duplicated per route or per controller.
//
// READ vs WRITE SCOPE (Manager Clients directory):
//   The Manager CLIENT DIRECTORY is a READ surface and is company-wide:
//   `buildClientScopeFilter` / `assertCanReadClient` treat Manager exactly like
//   Admin/HR, so the Clients list and the client detail page show EVERY client
//   (with or without projects) from the real Client collection. This is the
//   intended company-wide directory - it must never be driven by a
//   project-scoped query.
//
//   WRITES stay deliberately narrower: `assertCanAccessClient` (used by
//   updateClient) still restricts a Manager to clients linked to projects they
//   lead, and delete stays Admin-only at the route layer. VIEW CLIENTS is
//   therefore deliberately broader than EDIT CLIENTS - widening the read does
//   not widen any write.
//
// DATA MODEL NOTES (verified against the models, not assumed):
//   - Project.lead   is a plain indexed String holding the lead's NAME.
//   - Project.client is a plain String holding the client's COMPANY name.
//   - Client.company is the matching String on the Client collection.
//   - Employee has NO manager field; team linkage lives on the User document
//     as User.reportingManager (String name) and User.reportingTeam ([String]).
//   - Employee.email is unique and is the reliable join key to User.email.
//
// Nothing here widens Admin or HR. Admin/HR remain unscoped exactly as before,
// so this is backward compatible.

import { Project } from '../models/projectModels.js'
import { User } from '../models/User.js'
import { ApiError } from '../utils/asyncHandler.js'

// Roles that are intentionally NOT scoped. Admin has full access (unchanged).
// Phase 6.1: HR was company-wide by design. Phase 7.2: HR was merged into
// Manager, so the merged Manager inherits HR's company-wide scope — the former
// Manager-only team/client narrowing is gone with the role that needed it.
export const UNSCOPED_ROLES = ['Admin', 'Manager']

export const isUnscoped = (user) => UNSCOPED_ROLES.includes(user?.role)

const norm = (v) => String(v || '').trim()
const lower = (v) => norm(v).toLowerCase()

/**
 * Company names of every project this Manager is INVOLVED IN.
 *
 * PHASE NEXT (TASK 4) ROOT CAUSE - "Manager Clients section shows nothing":
 * this used to query `Project.find({ lead: name })` ONLY. Two consequences:
 *   1. A Manager who is on a project team but is not its recorded `lead` saw
 *      none of that project's clients, even though they work on it.
 *   2. Worse for the reported bug: when a Manager creates a client through
 *      Clients -> Add Client, pages/Clients.jsx sets the new project's `lead`
 *      to the FIRST SELECTED MEMBER (ProjectModal's rule), which is normally an
 *      employee - not the Manager. So the client the Manager had just created
 *      failed this filter and the list came back empty. buildClientScopeFilter
 *      then returned `{ _id: { $in: [] } }`, an honest but confusing empty list.
 *
 * FIX: match projects the Manager LEADS **or** is a MEMBER of. Project.members
 * is the existing memberSchema array ({ name, role }) already used everywhere
 * for team membership - no new field, collection or model. This stays a real
 * per-document scope (a Manager still cannot see clients of projects they have
 * no relationship with); it is NOT a widening to "all clients".
 *
 * The frontend half of the fix (pages/Clients.jsx) additionally records the
 * creating Manager on the project, so creation and visibility agree.
 */
export const getManagerClientCompanies = async (user) => {
  const name = norm(user?.name)
  if (!name) return []
  const projects = await Project.find({
    $or: [{ lead: name }, { 'members.name': name }],
  }).select('client').lean()
  const companies = projects.map((p) => norm(p.client)).filter(Boolean)
  return [...new Set(companies)]
}

/**
 * Emails of the employees inside this Manager's team.
 * Two sources, unioned, because the schema supports both directions:
 *   - upward:   User.reportingManager === manager name
 *   - downward: manager's own User.reportingTeam array (added in Phase 5.9)
 * reportingTeam entries may hold either a name or an email, so both are matched.
 *
 * PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3): the "Reporting Team" INPUT was
 * removed from Manager creation/editing, but this read is UNCHANGED and the
 * User.reportingTeam column is retained on purpose. Two reasons:
 *   1. Existing Manager documents already hold values here; dropping the read
 *      would silently shrink their write scope on PUT /employees/:id.
 *   2. The upward source keeps working for new Managers - employeeRoutes.js
 *      `forceEmployeeRole` stamps the creating Manager's name onto every new
 *      hire's `reportingManager`, so a Manager can still edit the people they
 *      created without the downward array ever being populated.
 * This is therefore the "still used elsewhere" case the task asks to preserve.
 */
export const getManagerTeamEmails = async (user) => {
  const name = norm(user?.name)
  const team = Array.isArray(user?.reportingTeam) ? user.reportingTeam.filter(Boolean) : []
  const or = []
  if (name) or.push({ reportingManager: name })
  if (team.length) {
    or.push({ name: { $in: team.map(norm) } })
    or.push({ email: { $in: team.map(lower) } })
  }
  if (!or.length) return []
  const users = await User.find({ $or: or }).select('email').lean()
  return [...new Set(users.map((u) => lower(u.email)).filter(Boolean))]
}

/**
 * Extra Mongo filter restricting a CLIENT DIRECTORY LISTING (read) to what the
 * caller may see. Returns null for Admin/HR/Manager (no restriction — the
 * company-wide client directory), so clients WITHOUT projects are included:
 * the listing reads the whole Client collection and the per-client
 * projectCount/activeProjects figures are computed separately from
 * ClientProject, never used as a filter.
 *
 * Any other role (defensive — the routes are already gated to Admin/HR/Manager)
 * gets `{ _id: { $in: [] } }`, an honest empty list rather than a silent full
 * listing.
 *
 * This is READ scope only. Write scope stays behind assertCanAccessClient().
 */
export const buildClientScopeFilter = async (user) => {
  if (isUnscoped(user)) return null
  return { _id: { $in: [] } }
}

/**
 * Throw 403 unless the caller may READ this specific client document (the
 * client directory is company-wide for Admin/HR/Manager). Used by the
 * read-only single-client route; the write path still uses
 * assertCanAccessClient() so a Manager can never EDIT an unrelated client.
 */
export const assertCanReadClient = async (user) => {
  if (isUnscoped(user)) return
  throw new ApiError(403, 'Forbidden: insufficient permissions')
}

/**
 * Throw 403 unless the caller may read/write this specific client document.
 *
 * PHASE 7.2: HR was merged into Manager, so Manager is now unscoped exactly as
 * HR was — the former "linked to projects they lead or belong to" write
 * restriction is removed. Every non-staff role is still blocked.
 */
export const assertCanAccessClient = async (user) => {
  if (isUnscoped(user)) return
  throw new ApiError(403, 'Forbidden: insufficient permissions')
}

/**
 * Throw 403 unless the caller may modify this specific employee document.
 *
 * PHASE 7.2: HR was merged into Manager, so the merged Manager inherits HR's
 * company-wide employee write access; the former reporting-team restriction is
 * removed. Every non-staff role is still blocked.
 */
export const assertCanEditEmployee = async (user) => {
  if (isUnscoped(user)) return
  throw new ApiError(403, 'Forbidden: insufficient permissions')
}

export const scopeService = {
  UNSCOPED_ROLES,
  isUnscoped,
  getManagerClientCompanies,
  getManagerTeamEmails,
  buildClientScopeFilter,
  assertCanReadClient,
  assertCanAccessClient,
  assertCanEditEmployee,
}

export default scopeService
