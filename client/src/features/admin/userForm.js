import { validatePassword } from '@/features/admin/password'

// ---------------------------------------------------------------------------
// PHASE 6 (TASK 1B / 1C / 1D) - THE single user form definition
// ---------------------------------------------------------------------------
// The blank form, the role -> field-group map, the validation rules and the
// payload builder used to live inside pages/admin/Users.jsx, private to that
// page's modal. Creating an HR / Manager / Admin / Client account is now a
// dedicated PAGE (/admin/users/new?role=...), and the only alternative to
// importing a page from a page was to retype all of it - i.e. a duplicate form
// that would drift the first time a field changed.
//
// So the definition moved here. pages/admin/Users.jsx (edit) and
// pages/admin/UserForm.jsx (create) both import it: one shape, one field list,
// one set of rules, two surfaces - exactly the pattern Phase 6.14 established
// for the client form in features/client/clientForm.js.
// ---------------------------------------------------------------------------

export const EMPTY_USER_FORM = {
  name: '', email: '', phone: '', department: '', designation: '', employeeId: '',
  role: 'Employee', status: 'Active',
  // Phase 5 (Task 1): empty means "not chosen yet" and fails validation on
  // create. It is NOT defaulted to Male/Female, because guessing a person's
  // gender is exactly the bug Task 2's leave filtering depends on avoiding.
  gender: '',
  password: '', confirmPassword: '',
  // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `workLocation` removed.
  employmentType: 'Full-time', joiningDate: '',
  reportingManager: '', shift: '',
  experienceYears: '', emergencyContact: '', salaryCtc: '',
  // Phase 6.9 (TASK 10 + TASK 11): `accountManager` and `clientStatus` removed
  // from the blank form - both fields are gone from the UI and the API.
  // ---------------------------------------------------------------------------
  // PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 6 / TASK 8 / TASK 14)
  // ---------------------------------------------------------------------------
  // `clientMode`, `clientCompany`, `address`, `gst`, `advancePayment`,
  // `monthlyDue`, `budget`, `projectType`, `projectMembers`, `projectName`,
  // `projectCode` and `projectDescription` are all REMOVED from this form shape.
  // Together they WERE the duplicate Client Creation form that lived on
  // Admin -> Users (see the TASK 6 note in UserFormFields.jsx). Client company
  // details, commercial terms and the Plan belong to the ONE client form
  // (features/client/clientForm.js); project fields belong to Project Creation.
  //
  // `clientId` survives on its own: it is the LINK from this user account to an
  // existing Client profile, which is genuinely user-account data and is what
  // scopes everything the portal login can see.
  clientId: '',
  // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3): `reportingTeam` removed from
  // the form shape. The User column stays (scopeService depends on it) but this
  // form no longer reads or writes it - see UserFormFields.jsx for the full
  // reasoning and buildUserPayload() below for the payload consequence.
  // PHASE ADMIN ATTENDANCE (TASK 2): `empCode` is DELETED from this form. The
  // employee code is allocated by the server (Employee.js `nextEmpCode`) and
  // mirrored back onto the User by identityLink, so there is nothing for an
  // admin to type. See server/src/controllers/userController.js.
  avatar: '',
  // ---------------------------------------------------------------------------
  // PHASE ADMIN USER WIZARD (TASK 6): extended HR profile fields collected by
  // the multi-step creation wizard (staff roles only). Persisted onto the
  // linked Employee record (the User document never stores them) and surfaced
  // on the employee's My Profile. Scalars live here; the array/object fields
  // are created FRESH per form via blankUserForm() below so two mounted forms
  // can never share one mutable array reference (a plain `{...EMPTY_USER_FORM}`
  // spread is shallow).
  dob: '', address: '', bloodGroup: '', maritalStatus: 'Single',
}

// PHASE ADMIN USER WIZARD (TASK 6): single education row in the wizard's
// Education step. `qualification` + `institution` are required per row
// (mirroring the server's educationSchema); the rest are optional.
export const EMPTY_EDUCATION_ROW = {
  qualification: '', institution: '', fieldOfStudy: '', startYear: '', endYear: '', grade: '',
}

// PHASE ADMIN USER WIZARD (TASK 6): single emergency-contact row in the
// wizard's Emergency Contacts step. Mirrors Employee.emergencyContactSchema
// (name required, relation + phone optional).
export const EMPTY_EMERGENCY_ROW = { name: '', relation: '', phone: '' }

// PHASE ADMIN USER WIZARD (TASK 6): bank details object in the wizard's Bank
// step. Mirrors Employee.bankSchema (name / account / ifsc, all optional).
export const EMPTY_BANK = { name: '', account: '', ifsc: '' }

// PHASE ADMIN USER WIZARD (TASK 6): FRESH form state factory. `EMPTY_USER_FORM`
// is the shared base, but its collection fields (education / bank /
// emergencyContacts) are per-instance here so `{...EMPTY_USER_FORM}`'s shallow
// copy can never hand two mounted forms one shared array. `overrides` merges on
// top exactly like the old `{ ...EMPTY_USER_FORM, ...{ role: preset } }` call.
export function blankUserForm(overrides = {}) {
  return {
    ...EMPTY_USER_FORM,
    education: [{ ...EMPTY_EDUCATION_ROW }],
    bank: { ...EMPTY_BANK },
    emergencyContacts: [{ ...EMPTY_EMERGENCY_ROW }],
    ...overrides,
  }
}

// PHASE ADMIN USER WIZARD (TASK 6): option lists for the wizard's Personal
// step. Mirror the server enums: Employee.maritalStatus ('Single' | 'Married'
// | 'Other') and the free-form blood group set shown on My Profile.
export const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Other']
export const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

// PHASE ADMIN USER WIZARD (TASK 6): education-row years (start / end). The
// wizard offers 1980..current year — a number input would accept anything;
// a bounded select keeps the stored data tidy without inventing a constraint.
export const EDUCATION_YEAR_OPTIONS = (() => {
  const current = new Date().getFullYear()
  const years = []
  for (let y = current; y >= 1980; y -= 1) years.push(String(y))
  return years
})()

// Roles that own an Employee HR profile - the extended HR fields only show for
// these. Phase 5: the 'Inventory' role was retired and merged into HR. Phase
// 7.2: HR itself was retired and merged into Manager.
export const STAFF_FORM_ROLES = ['Employee', 'Manager']

// Phase 5 (Task 1): gender options offered in the form. Mirrors GENDERS in
// server/src/models/User.js - the server rejects anything outside this set.
export const GENDER_OPTIONS = ['Male', 'Female']

// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 14): `PROJECT_TYPES` is REMOVED.
// Its only consumer was the "Project Type" select in the duplicate client form
// on UserFormFields.jsx, deleted by TASK 6. `Client.projectType` remains a live
// column on the Mongo model and is still accepted by userController, so no
// stored data is affected — only this now-unreferenced constant is gone.

// ---------------------------------------------------------------------------
// Phase 5.9 (Task 1) - ROLE-BASED FIELD VISIBILITY MAP
//
// ROOT CAUSE of the old "every field for every role" form: visibility was
// driven by two coarse booleans (`isClient` and `isStaff`), so an Admin was
// shown Department / Designation / Employee ID (none of which apply to an
// oversight account) and a Client was shown Employee ID plus Department and
// Designation. This map is the SINGLE source of truth; the JSX reads only from
// here, so adding or retiring a role never again means hunting through render
// conditions.
//   hr               -> Employee ID, Department, Designation, Joining Date,
//                       Salary (CTC), Employment Type, Shift, Experience,
//                       Emergency Contact
//   reportingManager -> Employee only
//   client           -> Company, Client ID, Address, GST, Advance Payment,
//                       Monthly Due, Budget, Project Type, Project details
//   gender           -> every role that owns an Employee HR profile. Clients are
//                       external portal accounts and the SERVER already refuses
//                       to store gender for them (userController.assertGender).
export const ROLE_FIELDS = {
  Admin: { hr: false, client: false, gender: true, reportingManager: false },
  Manager: { hr: true, client: false, gender: true, reportingManager: false },
  Employee: { hr: true, client: false, gender: true, reportingManager: true },
  Client: { hr: false, client: true, gender: false, reportingManager: false },
}

export const roleFields = (role) => ROLE_FIELDS[role] || ROLE_FIELDS.Employee

/**
 * Validate the user form. `mode` is 'add' | 'edit'.
 * Returns a { field: message } map; empty means valid.
 *
 * The SERVER re-validates every one of these rules independently
 * (userController.createUser / updateUser) and remains authoritative - this is
 * inline feedback, not the gate.
 */
export function validateUserForm(form, mode = 'add') {
  const e = {}
  const isClient = form.role === 'Client'

  if (!form.name || form.name.trim().length < 2) e.name = 'Full name is required'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email'

  // Phase 6.3 (Task 1): every create path provisions a login, so a password is
  // always required on create.
  if (mode === 'add') {
    const { valid } = validatePassword(form.password)
    if (!valid) e.password = 'Password must be 8–64 chars with upper, lower, number & special'
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match'
  }

  // Phase 5 (Task 1): gender is required for staff accounts, which are the ones
  // that own an Employee HR profile and apply for leave. Required on CREATE
  // only - on edit a legacy user with no gender can still have their status or
  // department changed, matching the server-side rule in updateUser.
  if (!isClient && mode === 'add' && !form.gender) e.gender = 'Gender is required'

  // ---------------------------------------------------------------------------
  // PHASE ADMIN USER WIZARD (TASK 6): extended HR profile rules (staff roles,
  // create only). The wizard validates per STEP by filtering this map down to
  // the step's own fields, and the final "Create User" submit re-checks
  // everything, so there is ONE rule set for both surfaces. Rows that are
  // entirely blank are ignored (the lists start with one empty row); any row
  // that carries a value must be complete.
  // ---------------------------------------------------------------------------
  if (!isClient && mode === 'add' && STAFF_FORM_ROLES.includes(form.role)) {
    const educations = Array.isArray(form.education) ? form.education : []
    const filledEducations = educations.filter((r) => r && (r.qualification || r.institution || r.fieldOfStudy || r.startYear || r.endYear || r.grade))
    if (filledEducations.length > 4) {
      e.education = 'At most 4 education entries are allowed'
    } else if (filledEducations.some((r) => !String(r.qualification || '').trim() || !String(r.institution || '').trim())) {
      e.education = 'Every education row needs a qualification and an institution'
    }

    const bank = form.bank || {}
    const hasBank = Boolean(bank.name?.trim() || bank.account?.trim() || bank.ifsc?.trim())
    if (hasBank) {
      if (!String(bank.name || '').trim()) {
        e.bank = 'Bank name is required when account details are given'
      } else if (String(bank.account || '').trim() && String(bank.account).trim().length < 6) {
        e.bank = 'Account number looks too short'
      } else if (String(bank.ifsc || '').trim() && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(String(bank.ifsc).trim())) {
        e.bank = 'IFSC must look like SBIN0001234'
      }
    }

    const contacts = Array.isArray(form.emergencyContacts) ? form.emergencyContacts : []
    const filledContacts = contacts.filter((r) => r && (r.name || r.relation || r.phone))
    if (filledContacts.length > 3) {
      e.emergencyContacts = 'At most 3 emergency contacts are allowed'
    } else if (filledContacts.some((r) => !String(r.name || '').trim())) {
      e.emergencyContacts = 'Every emergency contact needs a name'
    }
  }

  // PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 6): a Client account is now ONLY
  // ever linked to an EXISTING client profile from this form, so the company /
  // money / project rules that used to live here moved to the one client form
  // (features/client/clientForm.js `clientSchema`) along with the fields they
  // validated. What remains is the single rule this form still owns.
  //
  // Required on CREATE only: an existing Client account being edited may predate
  // the link, and forcing one to be chosen would block an unrelated status or
  // name change — the same reasoning the gender rule above uses.
  if (isClient && mode === 'add' && !form.clientId) {
    e.clientId = 'Select the client profile this login belongs to'
  }

  return e
}

/**
 * Build the create/update payload. Mirrors what userController accepts.
 * `mode` is 'add' | 'edit'.
 */
export function buildUserPayload(form, mode = 'add') {
  const isClient = form.role === 'Client'
  const isStaff = STAFF_FORM_ROLES.includes(form.role)
  const fields = roleFields(form.role)

  const payload = {
    name: form.name.trim(), email: form.email.trim(), phone: form.phone,
    role: form.role, status: form.status, avatar: form.avatar || undefined,
  }

  // Phase 5.9 (Task 1): department / designation / employeeId are HR profile
  // fields and are sent ONLY for roles that actually own them. Still ALWAYS
  // sent for the hr roles (including empty strings) so clearing a value works.
  if (fields.hr) {
    payload.department = form.department
    payload.designation = form.designation
    // EMPLOYEE ID STANDARDISATION: no typed Employee ID is sent on CREATE any
    // more — the server always allocates the next sequential EMP001-style code
    // (the create form displays this instead of an input). The server still
    // accepts a typed code from API callers but validates the EMP<digits>
    // format. On EDIT `employeeId` is never sent: the employee code is
    // immutable — it is the join key Attendance, LeaveRequest and Payroll
    // match on, so changing it would orphan those records — and
    // `User.employeeId` is the internal LINK to the Employee document, which
    // identityLink owns. Sending either would at best be ignored and at worst
    // corrupt the link.
  }
  // Phase 5 (Task 1): `null` explicitly clears gender, which is how an admin can
  // undo a wrong value; `undefined` would be dropped from the JSON body.
  if (!isClient) payload.gender = form.gender || null

  if (isStaff) {
    payload.employmentType = form.employmentType
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `workLocation` is no longer
    // part of this payload - the column is gone from both Mongo models.
    payload.joiningDate = form.joiningDate || undefined
    payload.reportingManager = form.reportingManager
    payload.shift = form.shift
    payload.experienceYears = form.experienceYears
    payload.emergencyContact = form.emergencyContact
    payload.salaryCtc = form.salaryCtc === '' ? 0 : Number(form.salaryCtc)
    // PHASE ADMIN ATTENDANCE (TASK 2): `empCode` is not part of this payload.
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3): neither is `reportingTeam`.
    // OMITTING the key (rather than sending []) is what preserves the value an
    // existing Manager document already holds: updateUser() only writes keys
    // that are present in the patch.

    // -------------------------------------------------------------------------
    // PHASE ADMIN USER WIZARD (TASK 6): extended HR profile fields. Sent on
    // CREATE only, for staff roles only - the server persists them onto the
    // linked Employee record; edit keeps the existing single-page fields, and
    // the Employee record already owns any richer data. Empty rows are
    // filtered out here so the server never stores blank entries.
    // -------------------------------------------------------------------------
    if (mode === 'add') {
      payload.dob = form.dob || undefined
      payload.address = form.address
      payload.bloodGroup = form.bloodGroup
      payload.maritalStatus = form.maritalStatus
      const educations = (Array.isArray(form.education) ? form.education : []).filter(
        (r) => r && (r.qualification || r.institution || r.fieldOfStudy || r.startYear || r.endYear || r.grade)
      )
      if (educations.length) payload.education = educations
      if (form.bank && (form.bank.name?.trim() || form.bank.account?.trim() || form.bank.ifsc?.trim())) {
        payload.bank = form.bank
      }
      const contacts = (Array.isArray(form.emergencyContacts) ? form.emergencyContacts : []).filter(
        (r) => r && (r.name || r.relation || r.phone)
      )
      if (contacts.length) payload.emergencyContacts = contacts
    }
  }

  if (mode === 'add') {
    payload.password = form.password
    // PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 6): ONE branch, because there is
    // now ONE thing this form does for a Client — link the login to an existing
    // client profile. The `clientCompany` branch that created a whole Client
    // document (plus its address, GST, project type, commercial terms and an
    // embedded project) is gone; that is the Client Creation page's job, and its
    // single persistence path is POST /admin/clients.
    //
    // userController.createUser still accepts `clientId` exactly as before and
    // validates that the profile exists, so this half of the contract is
    // byte-for-byte unchanged.
    if (isClient) payload.clientId = form.clientId
  }

  return payload
}

/** Map an existing user row onto the flat form shape (edit mode). */
export function toUserFormValues(row) {
  // PHASE ADMIN USER WIZARD (TASK 6): the base is blankUserForm() so the
  // edit form gets FRESH per-instance collection fields (education / bank /
  // emergencyContacts), never a shared module-level array. The wizard fields
  // are create-only and the User row carries none of them, so they stay blank
  // here by default; any value a future server response does carry is mapped
  // through defensively.
  return {
    ...blankUserForm(),
    name: row.name, email: row.email, phone: row.phone || '', department: row.department || '',
    designation: row.designation || '',
    // PHASE SALARY/BILLING (TASK 10): show the real business code, NOT
    // `row.employeeId` — that column holds the linked Employee document's Mongo
    // ObjectId (identityLink writes `employeeId: String(emp._id)`), so the edit
    // form used to prefill its "Employee ID" box with a 24-char hex string.
    employeeId: row.empCode || '',
    role: row.role,
    status: row.status || 'Active',
    gender: row.gender || '',
    password: '', confirmPassword: '', avatar: row.avatar || '',
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASKS 2 & 3): `workLocation` and
    // `reportingTeam` are no longer mapped onto the form. Neither has an input
    // any more, and because buildUserPayload() omits both keys the previous
    // "load it so saving does not wipe it" guard is no longer needed.
    employmentType: row.employmentType || 'Full-time',
    reportingManager: row.reportingManager || '', shift: row.shift || '',
    joiningDate: row.joiningDate ? String(row.joiningDate).slice(0, 10) : '',
    experienceYears: row.experienceYears || '', emergencyContact: row.emergencyContact || '',
    salaryCtc: row.salaryCtc || '',
    // PHASE ADMIN USER WIZARD (TASK 6): defensive mapping for the wizard
    // fields, in case a future edit payload ever carries them.
    dob: row.dob ? String(row.dob).slice(0, 10) : '',
    address: row.address || '',
    bloodGroup: row.bloodGroup || '',
    maritalStatus: row.maritalStatus || 'Single',
    education: Array.isArray(row.education) && row.education.length
      ? row.education.map((r) => ({ ...EMPTY_EDUCATION_ROW, ...r }))
      : [{ ...EMPTY_EDUCATION_ROW }],
    bank: { ...EMPTY_BANK, ...(row.bank || {}) },
    emergencyContacts: Array.isArray(row.emergencyContacts) && row.emergencyContacts.length
      ? row.emergencyContacts.map((r) => ({ ...EMPTY_EMERGENCY_ROW, ...r }))
      : [{ ...EMPTY_EMERGENCY_ROW }],
    // TASK 6: only the link survives — see EMPTY_USER_FORM above.
    clientId: row.clientId || '',
  }
}
