import { z } from 'zod'
import { validatePassword } from '@/features/admin/password'
import { ROLES } from '@/constants'
import { clientService } from '@/features/client/clientService'

// ---------------------------------------------------------------------------
// THE single client form definition
// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 3) moved the client's zod shape and field config out of
// pages/Clients.jsx so the list page and the details page could edit a client
// through one definition instead of two drifting copies.
//
// ---------------------------------------------------------------------------
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 5 + TASK 6 + TASK 8) — the split
// ---------------------------------------------------------------------------
// ROOT CAUSE of "Client Creation has two forms" and of "client creation and
// project creation are one operation":
//
//   1. `clientCreateSchema` was `z.object({ ...clientShape, ...projectShape })`
//      and `projectShape.projectName` was `z.string().min(2)` — REQUIRED. A
//      client therefore could not be created without also naming a project.
//   2. `CLIENT_FORM_FIELDS` concatenated CLIENT_FIELDS + CLIENT_CREDENTIAL_FIELDS
//      + CLIENT_PROJECT_FIELDS, so the "Client Creation" page rendered a client
//      form AND a project form stacked in one <form> — the two forms reported.
//   3. `buildClientsApi().create` posted to /project/with-client, whose service
//      (projectService.createProjectWithClient) hard-requires a project name and
//      creates a Project on every single client creation.
//
// WORSE, and this is the silent data bug that the split also fixes: that
// endpoint builds its Client document from an EXPLICIT field list
// (projectService.js ~line 1260) which omits `plan`, `industry` and `website`.
// Mongoose then wrote the schema default. So the Plan an admin picked on the
// Client Creation form was NEVER persisted — every client created through this
// page silently became plan 'Business'.
//
// THE FIX — the two workflows are now genuinely independent:
//   * Client Creation  -> pages/clients/ClientForm.jsx -> api.create ->
//                         clientService.createClient -> POST /admin/clients ->
//                         clientController.createClient. Client fields only.
//                         That controller writes `{ ...clientFields }`, so every
//                         field on this form actually persists.
//                         It already provisions the optional portal login through
//                         the SHARED services/clientLoginService.js, so nothing
//                         about credential handling changed.
//   * Project Creation -> pages/projects/ProjectForm.jsx -> projectApi.create ->
//                         POST /project. Picks an EXISTING client from the
//                         dropdown. Untouched by this phase.
//
// POST /project/with-client and createProjectWithClient() are deliberately LEFT
// IN PLACE on the server: removing a working endpoint was not requested, and it
// remains the correct routine for anyone genuinely provisioning both at once.
// It simply has no frontend caller now.
// ---------------------------------------------------------------------------

// Clients is not an Admin-only module. Manager rows are already limited
// server-side to the clients of projects they lead, so a Manager can only ever
// act on a client they are entitled to. Delete stays Admin-only on the SERVER
// (adminClientRouter -> adminOnly), so this list does not grant deletion.
export const CLIENT_WRITE_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

// The Client's own persisted fields — everything POST /admin/clients and
// PUT /admin/clients/:id accept. TASK 8: this shape contains CLIENT information
// only. Project Name / Code / Description / Status / Priority / Budget / Start
// Date / End Date / Members now live exclusively in the project form
// (features/projects/schemas.js + ProjectFormFields.jsx).
//
// ---------------------------------------------------------------------------
// PHASE CLIENT/PROJECT FIELD OWNERSHIP (TASK 1) — six fields REMOVED from here
// ---------------------------------------------------------------------------
// `advancePayment`, `monthlyDue`, `billingCycle`, `paymentMode`, `website` and
// `plan` are gone from this shape, from CLIENT_FIELDS and from
// CLIENT_FORM_DEFAULTS. They are per-ENGAGEMENT terms, so they belong to the
// project form (features/projects/ProjectFormFields.jsx + schemas.js), which is
// where all six now live.
//
// Three consequences, all deliberate:
//   1. The Client form no longer RENDERS them, no longer VALIDATES them and no
//      longer SENDS them. `buildClientsApi().create/update` post exactly this
//      shape, so a client request simply has no such keys.
//   2. The Mongo COLUMNS are untouched — see the TASK 4 note in
//      server/src/models/clientModels.js for why each one is still live. This
//      form's `update` sends a partial patch and clientController.updateClient
//      does a $set of the keys it receives, so EDITING a client can never wipe
//      the values an existing record already holds.
//   3. Because create and edit render the same list, both surfaces lose the six
//      fields together — there is no create/edit asymmetry to reconcile.
// ---------------------------------------------------------------------------
export const clientShape = {
  company: z.string().min(2, 'Company name required'),
  contactPerson: z.string().min(2, 'Contact person required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  industry: z.string().optional(),
  gst: z.string().optional(),
  address: z.string().optional(),
  // Optional portal credentials. Optional (not required) so that EDITING an
  // existing client — which reuses this shape and does not render these fields —
  // keeps validating, and so a record-only client can still be created. When a
  // password IS typed it must satisfy the shared policy and match its
  // confirmation (enforced by clientPasswordRefine).
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}

// Shared password rule. REUSES the policy from features/admin/password.js (the
// same module Admin -> Users validates against). The policy is NOT re-specified.
export const clientPasswordRefine = (val, ctx) => {
  const pw = val.password || ''
  const cpw = val.confirmPassword || ''
  if (!pw && !cpw) return // no login requested - nothing to validate
  if (!validatePassword(pw).valid) {
    ctx.addIssue({
      path: ['password'],
      code: z.ZodIssueCode.custom,
      message: 'Password must be 8–64 chars with upper, lower, number & special',
    })
  }
  if (pw !== cpw) {
    ctx.addIssue({
      path: ['confirmPassword'],
      code: z.ZodIssueCode.custom,
      message: 'Passwords do not match',
    })
  }
}

// ---------------------------------------------------------------------------
// TASK 6 — ONE validation schema.
// ---------------------------------------------------------------------------
// There used to be two: `clientCreateSchema` (client + project) and
// `clientEditSchema` (client only). They had to differ because the create form
// required project fields that an edit could not supply — validating an edit
// against the create schema failed on the absent, createOnly project fields and
// silently blocked Save.
//
// With the project half gone, create and edit validate the SAME client fields,
// so there is exactly one schema. The credential fields are `createOnly` in the
// field config (hidden while editing) and optional in the shape, which is what
// lets one schema serve both modes.
export const clientSchema = z.object(clientShape).superRefine(clientPasswordRefine)

// The client fields, rendered by the shared EntityFormFields renderer.
//
// PHASE CLIENT/PROJECT FIELD OWNERSHIP (TASK 1): the Plan select, the Website
// input and the four commercial-terms inputs (Advance Payment, Monthly Due,
// Expected Billing Cycle, Payment Mode) are REMOVED — all six are project
// fields now. The Plan dropdown's database-backed option source
// (usePlanOptions() in features/client/planForm.js) was NOT deleted with it: it
// is the shared hook, and features/projects/ProjectFormFields.jsx now calls the
// very same hook so there is still exactly ONE Plan option source in the app.
export const CLIENT_FIELDS = [
  { name: 'company', label: 'Company Name', placeholder: 'Acme Corp' },
  { name: 'contactPerson', label: 'Contact Person', placeholder: 'Jane Doe' },
  { name: 'email', label: 'Business Email', type: 'email', placeholder: 'jane@acme.com' },
  { name: 'phone', label: 'Phone', placeholder: '+91 ...' },
  { name: 'industry', label: 'Industry', placeholder: 'Technology' },
  { name: 'gst', label: 'GST Number', placeholder: '29AAAAA0000A1Z2' },
  { name: 'address', label: 'Address', full: true, placeholder: 'Street, City, PIN' },
]

// --- PORTAL LOGIN CREDENTIALS ----------------------------------------------
// These drive the EXISTING PasswordField + PasswordStrength components via the
// shared renderer's `type: 'password'` branch — show/hide toggle, strength meter
// and policy checklist all come from the User Creation form's components.
//   * createOnly -> hidden while editing (credentials change via reset).
//   * strength   -> renders the live strength meter + policy checklist.
//   * match      -> renders the live "Passwords match" indicator.
export const CLIENT_CREDENTIAL_FIELDS = [
  { name: 'password', label: 'Password', type: 'password', createOnly: true, strength: true },
  { name: 'confirmPassword', label: 'Confirm Password', type: 'password', createOnly: true, match: 'password' },
]

// TASK 6: the ONE field list for the client form. Client fields + the optional
// portal credentials, and nothing else. CLIENT_PROJECT_FIELDS is gone — those
// eight inputs were the second form on this page and now belong solely to
// Project Creation.
export const CLIENT_FORM_FIELDS = [
  ...CLIENT_FIELDS,
  ...CLIENT_CREDENTIAL_FIELDS,
]

// PHASE CLIENT/PROJECT FIELD OWNERSHIP (TASK 1): the six moved keys are gone
// from the blank shape too. This object is not just the form's initial state —
// pages/clients/ClientForm.jsx builds its EDIT prefill from `Object.keys(...)`
// of it, so a key left behind here would still be read off the record and PUT
// back on every save. Removing them is what makes the client request genuinely
// stop carrying the fields in BOTH modes.
export const CLIENT_FORM_DEFAULTS = {
  company: '', contactPerson: '', email: '', phone: '', industry: '', gst: '',
  address: '',
  password: '', confirmPassword: '',
}

// ---------------------------------------------------------------------------
// TASK 6 — ONE API workflow, ONE MongoDB persistence path.
// ---------------------------------------------------------------------------
// `create` posts to /admin/clients (clientController.createClient), the
// client-only endpoint. It:
//   * writes ONE Client document and no Project,
//   * persists every field this form collects,
//   * provisions the portal login through the shared clientLoginService when a
//     password was typed, and rolls the Client back if that fails,
//   * mirrors any advance payment into the Finance ledger through the shared
//     recordAdvancePayment() helper (idempotent), so switching away from
//     /project/with-client loses no behaviour.
//
// `update` and `remove` are unchanged: PUT / DELETE /admin/clients/:id.
// ---------------------------------------------------------------------------
export const buildClientsApi = () => ({
  query: async (params = {}) => {
    const res = await clientService.listClients()
    const all = (Array.isArray(res) ? res : res?.data || []).map((c) => ({ ...c, id: c.clientId || c.id || c._id }))
    const term = (params.search || '').trim().toLowerCase()
    let rows = all
    if (term) {
      rows = rows.filter((c) =>
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

  // `confirmPassword` is a UI-only field and is never sent. `password` IS sent:
  // clientController.createClient strips it off the Client document and hands it
  // to clientLoginService, so it is never persisted on the Client record.
  create: ({ confirmPassword, ...values }) => clientService.createClient(values),

  // Credentials are createOnly, so an edit never carries them; they are dropped
  // defensively rather than sent as undefined.
  update: (id, { password, confirmPassword, ...values }) => clientService.updateClient(id, values),

  remove: (id) => clientService.removeClient(id),
})
