import { useQuery } from '@tanstack/react-query'
import { FiCheckCircle, FiXCircle } from 'react-icons/fi'
// TASK 14: `Textarea` dropped — its only use was the removed client "Address"
// field. MultiSelect stays (Department / Designation / Reporting Manager).
import { Input, Select, MultiSelect } from '@/components/ui'
import { ProfileImageField } from '@/features/employees/ProfileImageField'
import { EMPLOYMENT_TYPES } from '@/features/employees/constants'
import { adminApi } from '@/api/adminApi'
import { hrApi, attendanceApi } from '@/api/services'
import { ALL_ROLES } from '@/constants'
import { USER_STATUSES } from '@/features/admin/constants'
import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
// TASK 14: `PROJECT_TYPES` dropped — its only use was the removed client
// "Project Type" select on this form.
import { GENDER_OPTIONS, roleFields } from './userForm'

// ---------------------------------------------------------------------------
// PHASE 6 (TASK 1B / 1C / 1D) - THE shared user form body
// ---------------------------------------------------------------------------
// Lifted VERBATIM out of the create/edit <Modal> in pages/admin/Users.jsx (same
// order, same branches, same class names, same components) so the dedicated
// creation PAGE (/admin/users/new) and the existing edit dialog render the SAME
// inputs from the SAME role map with the SAME validation. Extracting it is what
// makes "HR creation is a page" possible without a second user form.
//
// Props:
//   form     - the flat form state object (see features/admin/userForm.js)
//   setField - (key, value) => void
//   errors   - { field: message }
//   mode     - 'add' | 'edit'
//   enabled  - gate the async option queries (false while a dialog is closed)
//   lockRole - render Role read-only (used when the page was opened for one
//              specific role, e.g. /admin/users/new?role=HR). Cosmetic only:
//              the SERVER decides what the caller may create via
//              CREATE_ROLE_MATRIX in userController.js, and it never trusts the
//              role that arrives in the body.
// ---------------------------------------------------------------------------
export function UserFormFields({
  form, setField, errors = {}, mode = 'add', enabled = true, lockRole = false,
}) {
  const isClient = form.role === 'Client'
  const fields = roleFields(form.role)
  // Phase 5.9 (Task 2): live matching indicator, computed during render (not on
  // submit) so the user gets feedback while typing.
  const passwordsMatch = form.password.length > 0 && form.password === form.confirmPassword

  // Task 1: Department and Designation loaded dynamically from MongoDB.
  const { data: deptData = [], isLoading: deptLoading } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
    enabled,
  })
  const { data: desigData = [], isLoading: desigLoading } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrApi.designations.all(),
    staleTime: 60_000,
    enabled,
  })
  const deptOptions = (Array.isArray(deptData) ? deptData : []).map((d) => ({
    value: d.name || d,
    label: d.name || String(d),
  }))
  // Filter designations by selected department; show all when no dept chosen.
  const desigOptions = (Array.isArray(desigData) ? desigData : []).filter(
    (d) => !form.department || d.department === form.department
  ).map((d) => ({ value: d.title || d, label: d.title || String(d) }))

  // ROOT CAUSE (Shift field): this Select fed from a hardcoded SHIFT_OPTIONS
  // array, so a shift created in Attendance -> Shift Management never showed up
  // here. FIX: load the real Shift records through the EXISTING attendanceApi
  // and the SAME ['attendance-shifts'] query key the Shift Management page
  // already invalidates on create/update/delete. Value stays the shift's own
  // `name` - attendanceService.js matches Attendance/User.shift on it.
  const { data: shiftData = [], isLoading: shiftLoading } = useQuery({
    queryKey: ['attendance-shifts'],
    queryFn: () => attendanceApi.shifts.all(),
    staleTime: 60_000,
    enabled,
  })
  const shiftOptions = (Array.isArray(shiftData) ? shiftData : [])
    .filter((s) => s?.name)
    .map((s) => ({ value: s.name, label: s.start && s.end ? `${s.name} (${s.start}–${s.end})` : s.name }))

  const { data: clients = [] } = useQuery({
    queryKey: ['admin-clients', 'all'],
    queryFn: () => adminApi.clients.all(),
    enabled: enabled && isClient,
  })

  // PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 14): the ['admin-users',
  // 'reporting-team'] employee query and its `teamOptions` list are REMOVED.
  // After PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3) removed the Manager
  // "Reporting Team" picker, its ONLY remaining consumer was the Client form's
  // "Project Members" MultiSelect — which is removed by TASK 6 above, because
  // project members belong to Project Creation (TASK 8), not to a user form.
  // With no consumer left, the query would have kept firing a /users request on
  // every Client-role render for a list nothing displayed.

  // Phase 6.5 (TASK 2): "Reporting Manager" reuses the SAME adminApi.users.query
  // service, filtered to the Manager role, and is rendered through the existing
  // MultiSelect instead of a plain text field.
  const { data: managerData, isLoading: managerLoading } = useQuery({
    queryKey: ['admin-users', 'reporting-manager'],
    queryFn: () => adminApi.users.query({ role: 'Manager', limit: 200 }),
    enabled: enabled && fields.reportingManager,
    staleTime: 60_000,
  })
  const managerOptions = (managerData?.data || []).map((u) => ({
    value: u.name,
    label: u.name,
    meta: [u.department, u.designation].filter(Boolean).join(' · '),
  }))

  return (
    <>
      {/* Phase 6.9 (TASK 12): Role is the FIRST field for every user type,
          because Role is what drives ROLE_FIELDS and therefore which fields
          render at all. Rendered full-width because it governs everything
          beneath it. When the page was opened for one specific role
          (?role=HR) it is shown read-only - the server is the real gate. */}
      {lockRole ? (
        <Input label="Role" value={form.role} readOnly disabled className="sm:col-span-2" />
      ) : (
        <Select label="Role" value={form.role} onChange={(e) => setField('role', e.target.value)}
          options={ALL_ROLES.map((r) => ({ value: r, label: r }))} className="sm:col-span-2" />
      )}

      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-muted">Profile Image</label>
        <ProfileImageField value={form.avatar} onChange={(v) => setField('avatar', v)} />
      </div>

      <Input label={fields.client ? 'Client Name' : 'Full Name'} placeholder=" " value={form.name} onChange={(e) => setField('name', e.target.value)} error={errors.name} />
      <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} error={errors.email} placeholder="jane@skew.com" />
      <Input label="Phone Number" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+91 …" />

      {/* Phase 5.9 (Task 1): Employee ID / Department / Designation are HR
          profile fields, gated on the role's `hr` group. */}
      {fields.hr && (
        <>
          {/* EMPLOYEE ID STANDARDISATION: the ID is always server-generated
              (next sequential EMP001-style code). The create form shows a
              read-only notice instead of an input, so no manual entry is
              possible; on edit the assigned code is displayed immutable (the
              server enforces the same rule — sanitizePatch drops both
              `empCode` and `employeeId`). */}
          <Input
            label="Employee ID"
            value={mode === 'add' ? 'Auto-generated (EMP001, EMP002, …)' : form.employeeId}
            readOnly
            disabled
          />
          {mode === 'edit' && (
            <p className="-mt-2 text-xs text-muted sm:col-span-2">
              The Employee ID is assigned when the account is created and is the key that links this person to their
              attendance, leave and payroll records, so it cannot be changed here.
            </p>
          )}
          <MultiSelect
            label="Department"
            singleSelect
            value={form.department ? [form.department] : []}
            onChange={(arr) => { setField('department', arr[0] || ''); setField('designation', '') }}
            options={deptOptions}
            loading={deptLoading}
            emptyText="No departments found"
            placeholder="Select department…"
            error={errors.department}
          />
          <MultiSelect
            label="Designation"
            singleSelect
            value={form.designation ? [form.designation] : []}
            onChange={(arr) => setField('designation', arr[0] || '')}
            options={desigOptions}
            loading={desigLoading}
            emptyText={form.department ? 'No designations for this department' : 'Select a department first'}
            placeholder="Select designation…"
            error={errors.designation}
          />
        </>
      )}

      {/* Phase 6.16 (TASK 1): hidden for Client only - a new Client is always
          created Active and status is managed on the client record itself. */}
      {!fields.client && (
        <Select label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}
          options={USER_STATUSES.map((s) => ({ value: s, label: s }))} />
      )}

      {/* Phase 5 (Task 1): Gender. Hidden for Client accounts, which have no
          Employee HR profile. Drives gender-based leave-type filtering. */}
      {fields.gender && (
        <Select label="Gender" value={form.gender} onChange={(e) => setField('gender', e.target.value)}
          options={GENDER_OPTIONS.map((g) => ({ value: g, label: g }))}
          placeholder="Select gender" error={errors.gender} required aria-required="true" />
      )}

      {/* Extended HR fields - only for staff roles that own an Employee profile */}
      {fields.hr && (
        <>
          <Select label="Employment Type" value={form.employmentType} onChange={(e) => setField('employmentType', e.target.value)}
            options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))} />
          {/* PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): the "Work Location"
              <Select/> that used to sit here is REMOVED - the concept is retired
              from every form, payload and model in the application. */}
          {/* Phase 5.9 (Task 1): an Employee reports UP to one manager. The
              Manager-side "Reporting Team" counterpart is REMOVED - see the
              TASK 3 note below the block. */}
          {fields.reportingManager && (
            <MultiSelect
              label="Reporting Manager"
              singleSelect
              value={form.reportingManager ? [form.reportingManager] : []}
              onChange={(arr) => setField('reportingManager', arr[0] || '')}
              options={managerOptions}
              loading={managerLoading}
              emptyText="No managers found"
              placeholder="Select reporting manager…"
            />
          )}
          {/* --------------------------------------------------------------
              PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 3) - "Reporting Team"
              REMOVED from Manager creation AND Manager editing.
              This component is the single body behind BOTH surfaces
              (/admin/users/new and the edit dialog in pages/admin/Users.jsx),
              so deleting the input here removes it consistently from both.

              The User.reportingTeam COLUMN is deliberately KEPT: it is a live
              input to services/scopeService.js -> getManagerTeamEmails(), which
              backs assertCanEditEmployee() (the per-document Manager write
              scope on PUT /employees/:id). Deleting the column would silently
              shrink every existing Manager's team scope. Because the form no
              longer submits the key, buildUserPayload() omits it entirely and
              updateUser() therefore never writes it - existing values on
              existing Manager documents are preserved untouched.
              -------------------------------------------------------------- */}
          <Select label="Shift" value={form.shift} onChange={(e) => setField('shift', e.target.value)}
            options={shiftOptions} loading={shiftLoading} emptyText="No shifts available"
            placeholder={shiftLoading ? 'Loading shifts…' : 'Select shift…'} />
          <Input label="Annual CTC (₹)" type="number" value={form.salaryCtc} onChange={(e) => setField('salaryCtc', e.target.value)} placeholder="e.g. 1200000" />
          <Input label="Joining Date" type="date" value={form.joiningDate} onChange={(e) => setField('joiningDate', e.target.value)} />
          <Input label="Experience" value={form.experienceYears} onChange={(e) => setField('experienceYears', e.target.value)} placeholder="e.g. 4 yrs" />
          <Input label="Emergency Contact" value={form.emergencyContact} onChange={(e) => setField('emergencyContact', e.target.value)} placeholder="+91 …" />
        </>
      )}

      {/* ---------------------------------------------------------------
          Phase 5.9 (Task 2) - PASSWORD BLOCK (create only)
          Both inputs live in a dedicated full-width sub-grid with
          `items-start`, and the strength meter sits on its own full-width row
          BELOW them, so neither grid cell can be inflated by the meter.
          Reuses the EXISTING PasswordField (show/hide toggle) and
          PasswordStrength - no new password component.
      --------------------------------------------------------------- */}
      {mode === 'add' && (
        <div className="grid grid-cols-1 items-start gap-4 sm:col-span-2 sm:grid-cols-2">
          <PasswordField label="Password" value={form.password} onChange={(e) => setField('password', e.target.value)} error={errors.password} />
          <div>
            <PasswordField label="Confirm Password" value={form.confirmPassword} onChange={(e) => setField('confirmPassword', e.target.value)} error={errors.confirmPassword} />
            {form.confirmPassword.length > 0 && !errors.confirmPassword && (
              <p className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${passwordsMatch ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {passwordsMatch ? <FiCheckCircle className="h-3.5 w-3.5 shrink-0" /> : <FiXCircle className="h-3.5 w-3.5 shrink-0" />}
                {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <PasswordStrength value={form.password} />
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
          Passwords are managed via <b>Reset Password</b> — they cannot be edited here.
        </p>
      )}

      {/* ---------------------------------------------------------------------
          Client-only profile LINKING
          ---------------------------------------------------------------------
          PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 6) — THE SECOND CLIENT FORM.

          ROOT CAUSE of "Client Creation has two forms", the half that was not on
          the Client Creation page at all: this block used to offer
          `clientMode: 'new'`, which rendered a COMPLETE second client-creation
          form right here — Company Name, Client Code, Address, GST, Project
          Type, Advance Payment, Monthly Due, Budget, Project Name, Project Code,
          Project Description and Project Members. It had its own field list
          (this file), its own validation (validateUserForm in userForm.js), its
          own submit (adminApi.users.create), its own endpoint (POST /users) and
          its own MongoDB write path (userController.createUser →
          `Client.create({...})`). Two forms, two schemas, two persistence paths
          for one capability — and it combined Client with Project creation,
          which TASK 5 forbids.

          It is REMOVED. What remains is the one thing that genuinely belongs on
          a USER form: linking this portal login to an EXISTING client profile.
          That is account provisioning, not client creation.

          Creating the client itself is now exclusively Clients → Add Client
          (/clients/new), which persists through POST /admin/clients. That page
          already provisions the portal login when a password is typed (shared
          services/clientLoginService.js), so no capability is lost — an Admin
          who needs a brand-new client with a login gets both there, in one step.

          RBAC is untouched: POST /users is still authorize('Admin') and
          CREATE_ROLE_MATRIX still decides which roles the caller may create.
          The SERVER still accepts `clientCompany` (userController.createUser and
          updateUser are unchanged) so any existing integration or import script
          posting that shape keeps working — only this duplicate UI is gone.
      --------------------------------------------------------------------- */}
      {fields.client && (
        <>
          <Select
            label="Assigned Client"
            value={form.clientId}
            onChange={(e) => setField('clientId', e.target.value)}
            error={errors.clientId}
            className="sm:col-span-2"
            options={[{ value: '', label: 'Select client…' }, ...clients.map((c) => ({ value: c.id || c.clientId, label: c.company || c.name }))]}
          />
          <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
            This links the portal login to an existing client. To add a client
            that is not listed, create it first in{' '}
            <b>Clients → Add Client</b> — that form owns company details,
            commercial terms, the Plan and (optionally) the portal login itself.
          </p>
        </>
      )}
    </>
  )
}
