import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Modal, Input, Select, MultiSelect, Textarea, Button } from '@/components/ui'
import { projectSchema } from './schemas'
import { PROJECT_STATUSES, PRIORITIES } from './constants'
import { employeeService } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { clientService } from '@/features/client/clientService'

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444', '#06B6D4', '#0EA5E9']
const DEFAULTS = {
  name: '', code: '', client: '', description: '', lead: '', priority: 'Medium',
  status: 'Planning', budget: 0, startDate: '', deadline: '', color: COLORS[0],
}

// Phase 6.4 (TASK 3): key used to persist the project form draft in
// sessionStorage so Admin can navigate to Create User and come straight back.
const PROJECT_DRAFT_KEY = 'skew_project_draft'

// ---------------------------------------------------------------------------
// Phase 5.9 (Task 4) — MERGE PROJECT & CLIENT CREATION
//
// ROOT CAUSE of the "new client from a project" flow never working: this file
// carried a full second client-creation implementation in local state
// (CLIENT_DEFAULTS / clientInfo / clientMode / createPortalLogin) and submitted
// it through a `__clientInfo` side-channel to projectApi.createWithClient — but
// NO JSX ever rendered those inputs and nothing ever called setClientMode('new').
// `clientMode` was therefore permanently 'existing', so the entire branch was
// unreachable dead code.
//
// ---------------------------------------------------------------------------
// Phase 6.3 (TASK 1) — THIS IS NOW THE ONE AND ONLY PROJECT FORM.
//
// Admin, HR and Manager all render this component. The Admin-only detour that
// used to live here (goToCreateClient() -> navigate('/admin/users?...') plus a
// sessionStorage draft under PROJECT_DRAFT_KEY) has been removed, because:
//   * it sent Admin to a DIFFERENT project form (the `withProject` block in
//     pages/admin/Users.jsx), which is exactly the duplication Task 1 forbids;
//   * it made Admin's workflow structurally different from HR/Manager's -
//     Admin left the page mid-form and had to have values restored from
//     sessionStorage, while HR/Manager completed everything inline;
//   * the draft/restore machinery only existed to survive that navigation, so
//     with the navigation gone it is dead weight.
//
// Admin now uses the SAME inline client-capture path HR and Manager use, which
// submits through the SAME POST /project/with-client endpoint
// (authorize('Admin','Manager','HR')). One UI, one set of fields, one zod
// schema, one workflow, one component. No role branching remains in this file.
export function ProjectModal({ open, onClose, onSubmit, editing, saving, presetClient }) {
  const form = useForm({ resolver: zodResolver(projectSchema), defaultValues: DEFAULTS })
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === ROLES.ADMIN
  const [memberNames, setMemberNames] = useState([])
  // Phase 6.9 (TASK 11): Members is a REQUIRED field, but the picker is local
  // state rather than a react-hook-form input, so zod never sees it. Its error
  // is therefore tracked here and surfaced in the same place a zod error would
  // appear, keeping the three required fields visually consistent.
  const [memberError, setMemberError] = useState('')
  const [color, setColor] = useState(COLORS[0])
  // Phase 5.9 (Task 4): 'existing' | 'new'. Purely a UI switch now.
  // Phase 6.4 (TASK 3): for Admin, 'new' triggers the Admin Panel redirect;
  // for Manager/HR it stays inline.
  const [clientMode, setClientMode] = useState('existing')

  // Live clients. Shares the ['admin-clients'] query key used by the Clients
  // admin page, so the realtime 'resource:changed' handler invalidates it and
  // the dropdown auto-refreshes whenever a new client is created.
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ['admin-clients'],
    queryFn: () => clientService.listClients(),
    // Only fetch when the modal is actually open. This query hits the
    // admin-only GET /admin/clients endpoint; firing it on mount made the
    // Employee project-detail page call an admin route it cannot access
    // (403/500). Employees never open this editor (render is gated on
    // canWrite), so the request is never issued for them. No behaviour change
    // for authorised roles 2014 the data still loads when they open the modal.
    enabled: open,
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })
  const activeClients = clients.filter((c) => !c.status || c.status === 'Active')
  const clientOptions = activeClients.map((c) => ({ value: c.company, label: c.company }))
  // Preserve a currently-selected client even if it is now inactive/renamed.
  const currentClient = editing?.client
  if (currentClient && !clientOptions.some((o) => o.value === currentClient)) {
    clientOptions.unshift({ value: currentClient, label: currentClient })
  }

  // Live employees for the member picker (auto-updates when employees change).
  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeeService.list(),
    // Same guard: the member picker only needs employees once the editor is open.
    enabled: open,
    select: (res) => res?.data || [],
  })
  const employeeOptions = employees.map((e) => ({
    value: e.name,
    label: e.name,
    meta: [e.empCode, e.department, e.designation].filter(Boolean).join(' \u00b7 '),
  }))

  // Phase 6.3 (Task 1): inline client capture, for EVERY role that may create a
  // project. Previously Manager/HR captured inline while Admin was redirected
  // into the Admin panel - two different workflows. Now there is one.
  // Phase 6.6 (TASK 3): `newClient` state removed - see the deleted inline
  // capture block below. Clients are created in the full shared form now, so
  // this modal never holds client field values.

  // Phase 6.4 (TASK 3): Admin-only. Save the current form values to
  // sessionStorage so they survive the navigation to Admin → Create User,
  // then bounce Admin to /admin/users?add=client&returnTo=projects.
  // Phase 6.6 (TASK 3): ONE destination rule for "New Client".
  //
  // ROOT CAUSE of the "simplified 4-field form": Admin was sent to a real client
  // form, but HR/Manager fell through to an inline block right here in this
  // modal that rendered only Company / Contact Person / Email / Phone (+ a
  // portal checkbox). That inline block WAS the 4-field form - a second,
  // impoverished client-creation UI that ignored industry, GST, plan, status,
  // account manager, address, website and every commercial term the real form
  // collects, and could not set a password at all.
  //
  // FIX: HR/Manager now go to /clients (pages/Clients.jsx) with ?add=client,
  // which opens the SAME EntityManager create modal that Manager -> Clients ->
  // Add Client opens - the full form, now including Password / Confirm
  // Password. Admin keeps its existing /admin/users destination so the Admin
  // portal is unchanged. Either way the draft is saved first, so no typed
  // project data is lost.
  const goToCreateClient = () => {
    const vals = form.getValues()
    sessionStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({
      ...vals,
      memberNames,
      color,
    }))
    navigate(isAdmin
      ? '/admin/users?add=client&returnTo=projects'
      : '/clients?add=client&returnTo=projects')
  }

  useEffect(() => {
    if (!open) return
    // Phase 6.9 (TASK 11): clear any stale Members error when the modal reopens.
    setMemberError('')
    // Phase 6.4 (TASK 3): restore draft if Admin returns from Create User.
    const rawDraft = sessionStorage.getItem(PROJECT_DRAFT_KEY)
    if (rawDraft) {
      try {
        const draft = JSON.parse(rawDraft)
        sessionStorage.removeItem(PROJECT_DRAFT_KEY)
        const { memberNames: mn, color: col, ...vals } = draft
        // Phase 6.6 (TASK 3): the brand-new client must end up SELECTED. The
        // draft's own `client` value is whatever was chosen before leaving (very
        // often blank, since the user left precisely to create one), so the
        // company name handed back via ?client=<company> takes precedence.
        // Without this the draft restored the project fields but silently reset
        // the client picker to empty.
        form.reset({ ...DEFAULTS, ...vals, ...(presetClient ? { client: presetClient } : {}) })
        if (Array.isArray(mn)) setMemberNames(mn)
        if (col) setColor(col)
        setClientMode('existing')
        return
      } catch (_) { /* ignore corrupt draft */ }
    }
    // Phase 6.3 (Task 1): the sessionStorage draft restore is gone along with
    // the Admin redirect it existed to compensate for. Nobody navigates away
    // mid-form any more, so component state is sufficient for every role.
    const base = editing ? { ...DEFAULTS, ...editing } : { ...DEFAULTS }
    // Auto-select a client passed down from Projects.jsx via ?client=. Retained
    // for backward compatibility with any existing deep link.
    if (!editing && presetClient) base.client = presetClient
    form.reset(base)
    setMemberNames(editing ? (editing?.members || []).map((m) => m.name).filter(Boolean) : [])
    setColor(editing?.color || COLORS[0])
    setClientMode('existing')
  }, [open, editing, presetClient]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit((values) => {
    // Phase 6.9 (TASK 11): Members is required. Checked before anything is sent
    // so the user sees an inline field error rather than a 422 toast from the
    // server-side rule in validators/projectValidators.js.
    if (memberNames.length === 0) {
      setMemberError('Select at least one member')
      return
    }
    setMemberError('')
    const lead = values.lead || memberNames[0] || ''
    // Persist the same { name, role } member shape the backend already expects.
    const members = memberNames.map((n) => ({ name: n, role: n === lead ? 'Lead' : 'Member' }))
    const base = { ...values, lead, members, color }
    // Phase 5.9 (Task 4): a single submit shape. The old `__clientInfo` /
    // `__createPortalLogin` side-channel is gone because clients are no longer
    // created from inside this modal — by the time we submit, the client
    // already exists and is selected by name, exactly like the existing-client
    // path always did. Projects.jsx keeps its createWithClient branch for
    // backward compatibility with any other caller.
    // Phase 6.3 (Task 1): ALL roles (Admin included) now take this same inline
    // path. Projects.jsx forwards any payload carrying __clientInfo to
    // projectApi.createWithClient -> POST /project/with-client, which is
    // authorize('Admin','Manager','HR') and creates client + project (+ optional
    // portal login + advance transaction) in ONE transaction. Reuses the
    // existing endpoint and service - no new API surface, no duplicated
    // client-creation logic, and no role branch.
    // Phase 6.6 (TASK 3): the `__clientInfo` / `__createPortalLogin`
    // side-channel is no longer emitted from here, because by the time this
    // form submits the client has ALREADY been created in the full shared form
    // and is selected by name - identical to the existing-client path.
    // Projects.jsx retains its createWithClient branch untouched, so
    // POST /project/with-client and any other caller remain fully supported.
    onSubmit(base)
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Project' : 'New Project'}
      size="xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={submit}>{editing ? 'Save' : 'Create'}</Button></>}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Input label="Project Name" error={form.formState.errors.name?.message} {...form.register('name')} /></div>
        <Input label="Code" placeholder="PRJ-100" {...form.register('code')} />

        {/* -----------------------------------------------------------------
            Phase 5.9 (Task 4) — CLIENT SECTION
            Existing Client -> searchable dropdown of ACTIVE clients (unchanged).
            New Client      -> hand off to Admin → Create User (Role = Client),
                               then come straight back with the draft restored
                               and the new client auto-selected.
        ----------------------------------------------------------------- */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Client</label>
          {!editing && (
            <div className="mb-2 flex flex-wrap items-center gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="projectClientMode"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={clientMode === 'existing'}
                  onChange={() => setClientMode('existing')}
                />
                Existing Client
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="projectClientMode"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={clientMode === 'new'}
                  onChange={() => setClientMode('new')}
                />
                New Client
              </label>
            </div>
          )}
          <Select
            searchable
            loading={clientsLoading}
            emptyText="No clients found"
            placeholder={clientsLoading ? 'Loading clients\u2026' : (clientOptions.length ? 'Select a client' : 'No clients found')}
            options={clientOptions}
            error={form.formState.errors.client?.message}
            {...form.register('client')}
          />
          {/* Phase 6.6 (TASK 3): ONE "New Client" affordance for EVERY role.
              The Manager/HR inline 4-field capture that used to live here has
              been deleted - it was a duplicate, cut-down client form and it is
              exactly what the task reports as wrong. All roles now open the
              FULL shared Client Creation form (the same EntityManager form as
              Clients -> Add Client) and are returned here with the draft
              restored and the new client auto-selected. */}
          {!editing && clientMode === 'new' && (
            <div className="mt-2 rounded-xl border border-[var(--border)] p-3 space-y-2">
              <p className="text-xs text-muted">
                Opens the full Client Creation form (company, commercial terms and optional
                portal login). Your project details are saved and restored automatically.
              </p>
              <Button type="button" variant="ghost" onClick={goToCreateClient}>
                Open Create Client Form →
              </Button>
            </div>
          )}
        </div>
        <div className="sm:col-span-2"><Textarea label="Description" rows={2} {...form.register('description')} /></div>
        <Select label="Status" options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))} {...form.register('status')} />
        <Select label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: p }))} {...form.register('priority')} />
        <Input label="Budget (\u20b9)" type="number" error={form.formState.errors.budget?.message} {...form.register('budget')} />
        <Select label="Lead" options={[{ value: '', label: 'Auto (first member)' }, ...memberNames.map((n) => ({ value: n, label: n }))]} {...form.register('lead')} />
        <Input label="Start Date" type="date" {...form.register('startDate')} />
        <Input label="Deadline" type="date" {...form.register('deadline')} />

        {/* Colour */}
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">Colour</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-[var(--surface)] transition ${color === c ? 'ring-current' : 'ring-transparent'}`}
                style={{ backgroundColor: c }} aria-label={`Colour ${c}`} />
            ))}
          </div>
        </div>

        {/* Members \u2014 searchable multi-select of real employees */}
        <div className="sm:col-span-2">
          <MultiSelect
            label="Members"
            options={employeeOptions}
            value={memberNames}
            onChange={(next) => { setMemberNames(next); if (next.length) setMemberError('') }}
            loading={empLoading}
            placeholder="Search & select employees\u2026"
            emptyText="No employees found"
          />
          {memberError
            ? <p className="mt-1.5 text-xs text-danger" aria-live="polite">{memberError}</p>
            : <p className="mt-1.5 text-xs text-muted">Search by name, employee ID, department or designation. The Lead is chosen above.</p>}
        </div>
      </form>
    </Modal>
  )
}
