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

// Roles that are intentionally NOT scoped. Admin has full access (unchanged);
// HR is company-wide by design per the Phase 6.1 RBAC matrix.
export const UNSCOPED_ROLES = ['Admin', 'HR']

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
 * Extra Mongo filter restricting a client listing to what the caller may see.
 * Returns null for Admin/HR (no restriction - unchanged behaviour).
 * A Manager leading no projects gets `{ _id: { $in: [] } }`, i.e. an honest
 * empty list rather than a silent full listing.
 */
export const buildClientScopeFilter = async (user) => {
  if (isUnscoped(user)) return null
  if (user?.role !== 'Manager') return { _id: { $in: [] } }
  const companies = await getManagerClientCompanies(user)
  if (!companies.length) return { _id: { $in: [] } }
  return { company: { $in: companies } }
}

/**
 * Throw 403 unless the caller may read/write this specific client document.
 * Company comparison is case-insensitive so a Manager is not locked out by
 * casing drift between Project.client and Client.company.
 */
export const assertCanAccessClient = async (user, clientDoc) => {
  if (isUnscoped(user)) return
  if (user?.role !== 'Manager') {
    throw new ApiError(403, 'Forbidden: insufficient permissions')
  }
  const companies = (await getManagerClientCompanies(user)).map(lower)
  if (!companies.includes(lower(clientDoc?.company))) {
    throw new ApiError(403, 'Forbidden: this client is not linked to one of your projects')
  }
}

/**
 * Throw 403 unless the caller may modify this specific employee document.
 * Admin/HR unrestricted (unchanged). Manager limited to their own team.
 */
export const assertCanEditEmployee = async (user, employeeDoc) => {
  if (isUnscoped(user)) return
  if (user?.role !== 'Manager') {
    throw new ApiError(403, 'Forbidden: insufficient permissions')
  }
  const emails = await getManagerTeamEmails(user)
  if (!emails.includes(lower(employeeDoc?.email))) {
    throw new ApiError(403, 'Forbidden: this employee is not in your reporting team')
  }
}

export const scopeService = {
  UNSCOPED_ROLES,
  isUnscoped,
  getManagerClientCompanies,
  getManagerTeamEmails,
  buildClientScopeFilter,
  assertCanAccessClient,
  assertCanEditEmployee,
}

export default scopeService
