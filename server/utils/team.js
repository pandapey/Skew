// =============================================================================
// Shared project-team mapper / de-duplicator.
//
// Phase 6.23 (TASK 2) ROOT CAUSE - "Team Lead is listed twice" in the Client
// Portal (My Project -> Team).
//
// The internal Project model stores the lead separately from the members:
//
//     Project { lead: 'John', members: [{ name: 'John', role: 'Developer' }] }
//
// and in practice the lead is ALSO a member of their own project - that is how
// the internal task/assignee rules (accessibleProjectFilter, assignableNames)
// expect it. projectService.syncClientProject() built the client-facing mirror
// by simply concatenating the two lists with no identity check, so the same
// human was written into ClientProject.team twice and the portal faithfully
// rendered two cards. Duplicate rows already sitting in members[] (or in an
// older mirror) were passed straight through as well.
//
// teamMemberSchema (models/clientModels.js) is declared with `_id: false` and
// carries no employeeId/email/ObjectId, so `name` is the ONLY identity this
// architecture has - de-duplication therefore keys on a normalised name.
//
// Display rule implemented here (matches the requirement and the existing
// model): the Team Lead is represented exactly once, listed first, keeping the
// Lead role/designation; every other member stays visible in its original
// order; no field is dropped - blanks on the surviving record are filled in
// from the duplicate, so avatar/department/availability survive whichever copy
// carried them.
// =============================================================================

export const LEAD_ROLE = 'Lead'
export const LEAD_POSITION = 'Team Lead'

// The only identity the client-facing team model has. Case/space insensitive so
// "john  doe" and "John Doe" are recognised as the same person.
export const teamMemberKey = (member) =>
  String(member?.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export const isTeamLead = (member) =>
  String(member?.roleInProject ?? '').trim().toLowerCase() === LEAD_ROLE.toLowerCase()

const MERGEABLE_FIELDS = ['position', 'department', 'availability', 'avatar', 'roleInProject']

/**
 * Collapse a team list so each person appears exactly once.
 * Robust against duplicates already persisted in the database.
 */
export function dedupeTeam(members) {
  const byPerson = new Map()
  for (const raw of Array.isArray(members) ? members : []) {
    if (!raw) continue
    const key = teamMemberKey(raw)
    if (!key) continue // unnamed rows carry no identity and no information
    const existing = byPerson.get(key)
    if (!existing) {
      byPerson.set(key, { ...raw })
      continue
    }
    // Same person seen again: keep the first record, fill in anything it is
    // missing, and let the Lead role win over a generic membership role.
    for (const field of MERGEABLE_FIELDS) {
      if (!existing[field] && raw[field]) existing[field] = raw[field]
    }
    if (isTeamLead(raw) && !isTeamLead(existing)) {
      existing.roleInProject = raw.roleInProject
      existing.position = raw.position || existing.position || LEAD_POSITION
    }
  }
  const people = [...byPerson.values()]
  // Lead first, everyone else in their original order.
  return [...people.filter(isTeamLead), ...people.filter((m) => !isTeamLead(m))]
}

/**
 * Build the client-facing team for a Project document (lead + members),
 * de-duplicated. This is the ONE place that transformation lives.
 */
export function buildProjectTeam(project) {
  const lead = project?.lead
  return dedupeTeam([
    ...(lead ? [{ name: lead, roleInProject: LEAD_ROLE, position: LEAD_POSITION }] : []),
    ...((project?.members || []).map((m) => ({
      name: m?.name,
      roleInProject: m?.role || 'Member',
      position: m?.role || 'Member',
    }))),
  ])
}
