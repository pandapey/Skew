import { z } from 'zod'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FiGlobe, FiArrowRight } from 'react-icons/fi'
import { EntityManager } from '@/features/hr/EntityManager'
import { clientService } from '@/features/client/clientService'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
// Phase 6.6 (TASK 2): the SAME shared password policy the Admin -> Users form
// validates against. Imported rather than restated so the two forms can never
// drift apart. The server re-validates independently and stays authoritative.
// Phase 6.14 (TASK 3): the client half of this form (zod shape, password rule
// and field list) now lives in the client feature module so pages/admin/
// ClientDetail.jsx can render the SAME edit form. This page composes the
// project half on top of it; neither surface redefines a client field.
import {
  clientShape, clientPasswordRefine, clientEditSchema,
  CLIENT_FIELDS, CLIENT_CREDENTIAL_FIELDS,
} from '@/features/client/clientForm'
// Phase 6.14 (TASK 2): the EXISTING unified Client + Project provisioning
// endpoint and the EXISTING employee directory used by the project member
// picker. Neither is new - projectApi.createWithClient is the same call
// pages/Projects.jsx already makes, and employeeService.list is the same query
// (['employees']) features/projects/ProjectModal.jsx uses for its MultiSelect.
import { projectApi, employeeService } from '@/api/services'
import { PROJECT_STATUSES, PRIORITIES } from '@/features/projects/constants'

// Phase 6.1 (Tasks 1, 2, 3 & 5): Clients is no longer an Admin-only module.
// Was ADMIN_WRITE_ROLES, which hid Add/Edit/Delete from HR and Manager even
// once the route opened. Manager rows are already limited server-side to the
// clients of projects they lead, so a Manager can only ever act on a client
// they are entitled to. Delete stays Admin-only on the SERVER
// (adminClientRouter -> adminOnly), so this list does not grant deletion.
// Phase 6.0 (TASK 1) - DE-DUPLICATED. This was a page-local re-declaration of a
// role set that the central permission map also needs. It is now imported from
// features/rbac/editPermissions.js so Clients and every other client surface
// read the SAME list, satisfying "standardize everything to one permission
// system". The VALUE is byte-for-byte identical to what was declared here
// ([Admin, HR, Manager]), so behaviour is unchanged.
import { CLIENT_WRITE_ROLES } from '@/features/rbac/editPermissions'

// Top-level "Clients" module - a first-class sidebar section that behaves just
// like Employees (search / filter / paginate / add / edit / delete + export).
// It reuses the generic EntityManager and the existing admin client API, so no
// design or backend changes are needed. listClients returns the full array; we
// page/search/filter it client-side and normalise the row id to clientId so
// Manage links and edit/delete resolve correctly.
//
// PHASE NEXT (TASK 4): this used to be a module-level constant. It is now built
// by a factory so `create()` can know WHO is creating the client (see the
// manager-lead note inside). The query/update/remove behaviour is byte-for-byte
// the same, and it is still ONE api object shared by every role - no
// Manager-specific service, endpoint or dataset was introduced.
const buildClientsApi = (currentUser) => ({
  query: async (params = {}) => {
    const res = await clientService.listClients()
    const all = (Array.isArray(res) ? res : res?.data || []).map((c) => ({ ...c, id: c.clientId || c.id || c._id }))
    const term = (params.search || '').trim().toLowerCase()
    let rows = all
    if (term) {
      rows = rows.filter((c) =>
        // Phase 6.9 (TASK 10): accountManager removed from the search filter.
        [c.company, c.contactPerson, c.email, c.industry]
          .some((v) => String(v || '').toLowerCase().includes(term))
      )
    }
    if (params.status) rows = rows.filter((c) => c.status === params.status)
    const total = rows.length
    const limit = Number(params.limit) || 8
    const page = Number(params.page) || 1
    const start = (page - 1) * limit
    return { data: rows.slice(start, start + limit), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) }
  },
  // Phase 6.14 (TASK 2) - ONE CREATION FLOW FOR CLIENT + INITIAL PROJECT.
  //
  // ROOT CAUSE of "Add Client does not create a project": this create() called
  // clientService.createClient -> POST /admin/clients, a client-only endpoint.
  // It provisions a Client document and (since Phase 6.6) an optional portal
  // login, but it has no concept of a Project, so a client created here started
  // life with nothing to work on.
  //
  // A unified routine ALREADY existed and is already used by
  // pages/Projects.jsx: POST /project/with-client ->
  // services/projectService.js createProjectWithClient(), which resolves-or-
  // creates the Client, provisions the portal login through the SHARED
  // clientLoginService, creates the Project linked to that client, and records
  // the advance payment - transactionally, with compensating rollback. So this
  // form is pointed at that existing flow rather than a second workflow being
  // written. No new endpoint, service, controller or collection is introduced,
  // and Projects -> Add Project still calls the very same function.
  //
  // `confirmPassword` stays a UI-only field: validated by the schema below,
  // then dropped. The server re-validates independently and is authoritative.
  //
  // PHASE NEXT (TASK 4) - SECOND HALF OF THE "MANAGER SEES NO CLIENTS" BUG.
  // Server-side, a Manager's client list is scoped to the clients of projects
  // they lead or are a member of (services/scopeService.js). But the `lead`
  // computed below is `members[0]`, i.e. the first employee the creator picked -
  // so a Manager creating a client produced a project they had NO relationship
  // with, and the brand-new client immediately fell outside their own scope.
  // The Manager is therefore recorded on the project they just created, which
  // is also the truthful relationship. Admin/HR behaviour is unchanged.
  create: ({ confirmPassword, password, projectMembers, ...values }) => {
    const {
      projectName, projectCode, projectDescription, projectStatus,
      projectPriority, projectBudget, projectStartDate, projectEndDate,
      ...client
    } = values

    const members = Array.isArray(projectMembers) ? projectMembers : []
    const creatorName = String(currentUser?.name || '').trim()
    const creatorIsManager = currentUser?.role === ROLES.MANAGER && !!creatorName
    // The lead defaults to the first selected member, matching ProjectModal's
    // rule, and members are persisted in the { name, role } shape the Project
    // schema's memberSchema requires.
    // A Manager who creates the project leads it - that is what makes the new
    // client visible to them straight away under the EXISTING scope rule.
    const lead = creatorIsManager ? creatorName : (members[0] || '')
    // Keep the picked employees, and make sure the creating Manager is on the
    // team exactly once (never duplicated if they picked themselves).
    const memberNames = creatorIsManager && !members.includes(creatorName)
      ? [creatorName, ...members]
      : members

    return projectApi.createWithClient({
      client,
      project: {
        name: projectName,
        code: projectCode || '',
        description: projectDescription || '',
        status: projectStatus,
        priority: projectPriority,
        budget: projectBudget,
        startDate: projectStartDate || '',
        // The Project schema's end-of-project field is `deadline`; "End Date"
        // is the label the brief uses for it. Mapped here rather than adding a
        // second date field to the model.
        deadline: projectEndDate || '',
        lead,
        members: memberNames.map((n) => ({ name: n, role: n === lead ? 'Lead' : 'Member' })),
      },
      // A password typed on this form provisions the Client USER. Left blank,
      // the server still creates the Client record and the Project, exactly as
      // POST /admin/clients did before - backward compatible.
      createPortalLogin: !!password,
      portalPassword: password || '',
    })
  },
  update: (id, values) => clientService.updateClient(id, values),
  remove: (id) => clientService.removeClient(id),
})

// --- Phase 6.14 (TASK 2): the INITIAL PROJECT -------------------------------
// These mirror features/projects/schemas.js projectSchema field for field (same
// required set: a name; a budget that tolerates an empty input; the rest
// optional). They are prefixed `project*` purely to keep them from colliding
// with the client's own name/status/description keys in this one flat
// react-hook-form namespace; api.create above unprefixes them before they reach
// the shared endpoint, so the server contract is unchanged.
const projectShape = {
  projectName: z.string().min(2, 'Project name required'),
  projectCode: z.string().optional(),
  projectDescription: z.string().optional(),
  projectStatus: z.string().optional(),
  projectPriority: z.string().optional(),
  // Same z.preprocess treatment projectSchema uses, so a cleared number input
  // ('') is treated as "not supplied" instead of failing to coerce.
  projectBudget: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().min(0, 'Budget cannot be negative').optional()
  ),
  projectStartDate: z.string().optional(),
  projectEndDate: z.string().optional(),
  projectMembers: z.array(z.string()).min(1, 'Select at least one project member'),
}

// The CREATE schema = client fields + project fields. The EDIT schema
// (clientEditSchema, imported above) deliberately omits the project half.
const schema = z.object({ ...clientShape, ...projectShape })
  .superRefine(clientPasswordRefine)
  .superRefine((val, ctx) => {
    // Phase 6.14 (TASK 2): a deadline before the start date is nonsense, and the
    // Project schema stores both as plain strings, so it is caught here.
    if (val.projectStartDate && val.projectEndDate && val.projectEndDate < val.projectStartDate) {
      ctx.addIssue({
        path: ['projectEndDate'],
        code: z.ZodIssueCode.custom,
        message: 'End date cannot be before the start date',
      })
    }
  })

const columns = [
  { key: 'company', header: 'Company', render: (r) => (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><FiGlobe className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="truncate font-medium">{r.company}</p><p className="truncate text-xs text-muted">{r.contactPerson}</p></div>
    </div>
  ) },
  { key: 'industry', header: 'Industry' },
  { key: 'plan', header: 'Plan', render: (r) => <span className="chip bg-primary/10 text-primary">{r.plan}</span> },
  { key: 'projectCount', header: 'Projects', render: (r) => r.projectCount ?? 0 },
  { key: 'activeProjects', header: 'Active', render: (r) => r.activeProjects ?? 0 },
  { key: 'status', header: 'Status', render: (r) => <span className={`chip ${r.status === 'Active' ? 'bg-success/12 text-success' : 'bg-warning/12 text-warning'}`}>{r.status}</span> },
  { key: '_manage', header: '', render: (r) => (
    <Link to={`/clients/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/20">
      Manage <FiArrowRight />
    </Link>
  ) },
]

const fields = [
  // Client half + portal credentials: imported, not restated (see clientForm.js).
  ...CLIENT_FIELDS,
  ...CLIENT_CREDENTIAL_FIELDS,
  // --- Phase 6.14 (TASK 2): INITIAL PROJECT ---------------------------------
  // All `createOnly`, so EDITING a client shows the client fields only. That
  // matters because api.update still targets PUT /admin/clients/:id, which knows
  // nothing about projects - an existing project is edited from the Projects
  // module, which remains the single place project data is changed.
  { name: 'projectName', label: 'Project Name', createOnly: true, placeholder: 'Website Revamp' },
  { name: 'projectCode', label: 'Project Code', createOnly: true, placeholder: 'WEB-01' },
  { name: 'projectStatus', label: 'Project Status', type: 'select', createOnly: true, options: PROJECT_STATUSES.map((v) => ({ value: v, label: v })) },
  { name: 'projectPriority', label: 'Priority', type: 'select', createOnly: true, options: PRIORITIES.map((v) => ({ value: v, label: v })) },
  { name: 'projectBudget', label: 'Budget (\u20b9)', type: 'number', createOnly: true, placeholder: '0' },
  { name: 'projectStartDate', label: 'Start Date', type: 'date', createOnly: true },
  { name: 'projectEndDate', label: 'End Date', type: 'date', createOnly: true },
  {
    name: 'projectMembers',
    label: 'Project Members',
    type: 'multiselect',
    createOnly: true,
    full: true,
    placeholder: 'Search & select employees\u2026',
    emptyText: 'No employees found',
    hint: 'Search by name, employee ID, department or designation. The first member becomes the Lead.',
  },
  { name: 'projectDescription', label: 'Project Description', type: 'textarea', createOnly: true, full: true },
]

const exportColumns = [
  { header: 'Company', accessor: 'company' }, { header: 'Contact', accessor: 'contactPerson' },
  { header: 'Email', accessor: 'email' }, { header: 'Industry', accessor: 'industry' },
  { header: 'Plan', accessor: 'plan' }, { header: 'Status', accessor: 'status' },
]

const filters = [
  { name: 'status', label: 'All Status', options: ['Active', 'On Hold', 'Suspended'] },
]

export default function Clients() {
  const navigate = useNavigate()
  // Phase 6.6 (TASK 3): deep-link params from the Project form. `add=client`
  // opens the create modal; `returnTo=projects` sends the user back to Project
  // Creation afterwards. Both are read once and are inert for normal visits.
  const [searchParams] = useSearchParams()
  const autoOpenAdd = searchParams.get('add') === 'client'
  const returnTo = searchParams.get('returnTo') || ''
  const handleCreated = (res, values) => {
    if (returnTo !== 'projects') return
    // Prefer the server's stored company name; fall back to what was submitted.
    const company = (res?.company || values?.company || '').trim()
    navigate(`/projects?newProject=1&client=${encodeURIComponent(company)}`)
  }
  const { hasRole, user } = useAuth()
  // Phase 6.1: only Admin may be sent to /admin/users (that route is gated to
  // [ROLES.ADMIN]; sending HR/Manager there would land them on /403).
  const isAdmin = hasRole([ROLES.ADMIN])
  // PHASE NEXT (TASK 4): the SAME api object as before, just built with the
  // signed-in user so create() can record a Manager on the project it creates.
  // Memoised on identity only, so it is stable across renders and React Query
  // inside EntityManager is not disturbed.
  const api = useMemo(
    () => buildClientsApi({ name: user?.name, role: user?.role }),
    [user?.name, user?.role],
  )

  // Phase 6.14 (TASK 2): the member picker's option source. This is the SAME
  // query key (['employees']) and the SAME service call
  // features/projects/ProjectModal.jsx uses, so the two member pickers share
  // one cache entry and one directory - the list is not fetched twice and
  // cannot drift. Held here (not inside EntityManager) so the hook runs once
  // per render at the top level rather than inside the fields loop.
  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.list(),
    select: (res) => res?.data || [],
  })
  const memberOptions = employees.map((e) => ({
    value: e.name,
    label: e.name,
    meta: [e.empCode, e.department, e.designation].filter(Boolean).join(' \u00b7 '),
  }))

  return (
    <EntityManager
      title="Clients"
      subtitle="Manage client accounts and their portals."
      api={api}
      queryKey="admin-clients"
      columns={columns}
      fields={fields}
      schema={schema}
      filters={filters}
      exportColumns={exportColumns}
      filename="clients"
      // Phase 6.14 (TASK 2): `status` dropped (removed from the form; the server
      // sets 'Active' on a new client). The project defaults mirror the ones
      // features/projects/ProjectModal.jsx seeds, so a project created from
      // either surface starts in the same state.
      defaultValues={{
        plan: 'Professional',
        projectStatus: 'Planning',
        projectPriority: 'Medium',
        projectBudget: 0,
        projectMembers: [],
      }}
      addLabel="Add Client"
      // Phase 5.7 (Task 2): standalone client creation is retired. Clients are
      // now created as part of the unified Projects -> Add Project workflow, so
      // this button redirects there instead of opening a second create form.
      // The list, edit, delete and export behaviour is untouched.
      // Phase 5.9 (Task 3): MERGE CLIENT CREATION FLOW.
      // ROOT CAUSE: "Add Client" pointed at /projects?newProject=1, i.e. it
      // opened the PROJECT modal, so a client could only be born as a side
      // effect of creating a project. A second, fully separate client-creation
      // screen (pages/admin/Clients.jsx) also existed. Two competing creation
      // paths, and neither was the canonical Admin -> Create User form, so a
      // client made this way got a Client document but no login User document.
      // FIX: route to the single canonical form with Role=Client preselected;
      // ?add=client makes that form return here after saving.
      // Phase 6.1 (Tasks 1, 2 & 3) ROOT CAUSE: this onAdd sent EVERY role to
      // /admin/users, an Admin-only route, so "Add Client" was a guaranteed
      // /403 for HR and Manager - the literal "redirected to the Admin panel"
      // problem in the brief.
      //
      // FIX: Admin keeps the merged Client+Project form from Phase 5.9.2
      // (unchanged - "the Admin portal must remain unchanged"). HR/Manager get
      // `undefined`, which makes EntityManager fall back to its built-in
      // openAdd modal (see EntityManager line 96: `onAdd || openAdd`). That
      // modal renders THIS page's existing `fields` + `schema` + api.create,
      // i.e. the SAME client form already used for editing - no new form, no
      // duplicated validation, and no Admin route involved.
      onAdd={isAdmin ? () => navigate('/admin/users?add=client&role=Client') : undefined}
      // Phase 6.6 (TASK 3): PROJECT -> NEW CLIENT now lands HERE.
      // ProjectModal navigates to /clients?add=client&returnTo=projects after
      // stashing its draft in sessionStorage. `autoOpenAdd` opens this page's
      // OWN create modal - the full form with every commercial field and the new
      // Password / Confirm Password fields - so there is exactly one client form
      // for Clients -> Add Client and for Projects -> New Client.
      autoOpenAdd={autoOpenAdd}
      // On success, hand the new company name back to the project form. The
      // draft restore inside ProjectModal (skew_project_draft) repopulates every
      // project field and ?client= auto-selects the client that was just made.
      onCreated={handleCreated}
      fieldOptions={{ projectMembers: { options: memberOptions, loading: empLoading } }}
      editSchema={clientEditSchema}
      writeRoles={CLIENT_WRITE_ROLES}
    />
  )
}
