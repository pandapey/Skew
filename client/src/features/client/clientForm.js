import { z } from 'zod'
import { validatePassword } from '@/features/admin/password'

// ---------------------------------------------------------------------------
// Phase 6.14 (TASK 3) - THE single client form definition
// ---------------------------------------------------------------------------
// The client's zod shape and its field config used to live inside
// pages/Clients.jsx, private to that page. TASK 3 requires Client Details to
// EDIT a client too, and the only alternative to importing a page from a page
// was to retype the fields on the details page - i.e. a duplicate form that
// would silently drift from the list form the first time a field changed.
//
// So the definition moved here, to the feature module that already owns
// clientService. pages/Clients.jsx and pages/admin/ClientDetail.jsx both import
// it. One shape, one field list, one set of validation rules, two surfaces.
// ---------------------------------------------------------------------------

// The Client's own persisted fields - everything PUT /admin/clients/:id accepts.
export const clientShape = {
  company: z.string().min(2, 'Company name required'),
  contactPerson: z.string().min(2, 'Contact person required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  industry: z.string().optional(),
  gst: z.string().optional(),
  plan: z.string().optional(),
  // Phase 5.7 (Task 3): finance fields. Coerced because number inputs yield
  // strings, and optional so existing client records keep validating.
  advancePayment: z.coerce.number().min(0).optional(),
  monthlyDue: z.coerce.number().min(0).optional(),
  // Phase 6.9 (TASK 11): `paymentTerms` removed from the schema.
  billingCycle: z.string().optional(),
  paymentMode: z.string().optional(),
  // Phase 6.14 (TASK 2): `designation` and `status` removed per the brief.
  // `status` is system-managed anyway - createProjectWithClient() hard-sets
  // status: 'Active' on a new Client, so collecting it here was misleading.
  // Phase 6.9 (TASK 10): accountManager removed from the client schema.
  address: z.string().optional(),
  website: z.string().optional(),
  // Phase 6.6 (TASK 2): optional credentials. Optional (not required) so that
  // EDITING an existing client - which reuses this shape and does not render
  // these fields - keeps validating, and so a record-only client can still be
  // created. When a password IS typed it must satisfy the shared policy and
  // match its confirmation (enforced by clientPasswordRefine).
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}

// Shared password rule, applied by both the create and the edit schema.
export const clientPasswordRefine = (val, ctx) => {
  const pw = val.password || ''
  const cpw = val.confirmPassword || ''
  if (!pw && !cpw) return // no login requested - nothing to validate
  // REUSES the shared policy from features/admin/password.js (the same module
  // Admin -> Users validates against). The policy is NOT re-specified here.
  if (!validatePassword(pw).valid) {
    ctx.addIssue({
      path: ['password'],
      code: z.ZodIssueCode.custom,
      message: 'Password must be 8\u201364 chars with upper, lower, number & special',
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

// Phase 6.14 (TASK 2/3): the schema for UPDATING a client. Deliberately has no
// project half - a client edit never creates a project, and validating an edit
// against the create schema would fail on the (absent, createOnly) project
// fields and block Save. Used by EntityManager's `editSchema` prop on the list
// page and by the Edit dialog on Client Details.
export const clientEditSchema = z.object(clientShape).superRefine(clientPasswordRefine)

// The client half of the form, rendered by the shared EntityFormFields.
export const CLIENT_FIELDS = [
  { name: 'company', label: 'Company Name', placeholder: 'Acme Corp' },
  { name: 'contactPerson', label: 'Contact Person', placeholder: 'Jane Doe' },
  { name: 'email', label: 'Business Email', type: 'email', placeholder: 'jane@acme.com' },
  { name: 'phone', label: 'Phone', placeholder: '+91 ...' },
  { name: 'industry', label: 'Industry', placeholder: 'Technology' },
  { name: 'gst', label: 'GST Number', placeholder: '29AAAAA0000A1Z2' },
  { name: 'plan', label: 'Plan', type: 'select', options: ['Enterprise', 'Professional', 'Business', 'Starter'].map((p) => ({ value: p, label: p })) },
  { name: 'address', label: 'Address', full: true, placeholder: 'Street, City, PIN' },
  { name: 'website', label: 'Website', full: true, placeholder: 'acme.com' },
  // Phase 5.7 (Task 3): commercial terms, shared with the Finance module.
  { name: 'advancePayment', label: 'Advance Payment (\u20b9)', type: 'number', placeholder: '0' },
  { name: 'monthlyDue', label: 'Monthly Due (\u20b9)', type: 'number', placeholder: '0' },
  // Phase 6.9 (TASK 11): the Payment Terms form field is removed. Billing Cycle
  // and Payment Mode remain - those two still drive Finance behaviour.
  { name: 'billingCycle', label: 'Expected Billing Cycle', type: 'select', options: ['Monthly', 'Quarterly', 'Milestone', 'One-time'].map((t) => ({ value: t, label: t })) },
  { name: 'paymentMode', label: 'Payment Mode', type: 'select', options: ['Bank Transfer', 'UPI', 'Cheque', 'Credit Card', 'Cash'].map((t) => ({ value: t, label: t })) },
]

// --- Phase 6.6 (TASK 2): PORTAL LOGIN CREDENTIALS ---------------------------
// These drive the EXISTING PasswordField + PasswordStrength components via the
// shared renderer's `type: 'password'` branch - show/hide toggle, strength meter
// and policy checklist all come from the User Creation form's components.
//   * createOnly -> hidden while editing (credentials change via reset).
//   * strength   -> renders the live strength meter + policy checklist.
//   * match      -> renders the live "Passwords match" indicator.
export const CLIENT_CREDENTIAL_FIELDS = [
  { name: 'password', label: 'Password', type: 'password', createOnly: true, strength: true },
  { name: 'confirmPassword', label: 'Confirm Password', type: 'password', createOnly: true, match: 'password' },
]
