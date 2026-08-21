import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiCheck, FiChevronLeft, FiChevronRight, FiPlus, FiTrash2, FiUser,
  FiBriefcase, FiBookOpen, FiCreditCard, FiPhone,
} from 'react-icons/fi'
import { Card, Input, Select, MultiSelect, Button } from '@/components/ui'
import { ProfileImageField } from '@/features/employees/ProfileImageField'
import { EMPLOYMENT_TYPES } from '@/features/employees/constants'
import { adminApi } from '@/api/adminApi'
import { hrApi, attendanceApi } from '@/api/services'
import { USER_STATUSES } from '@/features/admin/constants'
import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
import {
  STAFF_FORM_ROLES,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  BLOOD_GROUP_OPTIONS,
  EDUCATION_YEAR_OPTIONS,
  EMPTY_EDUCATION_ROW,
  EMPTY_EMERGENCY_ROW,
  blankUserForm,
  validateUserForm,
  buildUserPayload,
} from './userForm'

// ---------------------------------------------------------------------------
// PHASE ADMIN USER WIZARD (TASK 6) - multi-step user creation (staff roles)
// ---------------------------------------------------------------------------
// Admin -> Users -> "Add Employee" / "Add Manager" opens a 6-step wizard
// instead of the single-page form:
//
//   1. Personal     - name, email, phone, gender, profile image, DOB, blood
//                     group, marital status, address, password
//   2. Employment   - role, status, Employee ID, department, designation,
//                     employment type, joining date, reporting manager, shift,
//                     experience, annual CTC
//   3. Education    - repeatable academic rows (qualification, institution,
//                     field of study, years, grade)
//   4. Bank Details - bank name, account number, IFSC
//   5. Emergency    - repeatable contacts (name, relation, phone)
//   6. Review       - full summary, then Create
//
// WHY A WIZARD: the single-page staff form had grown to ~25 fields and every
// new hire had to wade through the whole grid. Steps group the fields into
// natural sections with per-step validation, so an Admin answers one section
// at a time and gets immediate feedback.
//
// WHAT IS REUSED - NOTHING IS REIMPLEMENTED:
//   * The form SHAPE is the shared features/admin/userForm.js definition
//     (blankUserForm / validateUserForm / buildUserPayload) - the SAME one
//     the single-page form uses, so the two surfaces can never drift.
//   * Async option queries reuse the EXACT react-query keys and services of
//     UserFormFields.jsx (['hr-departments'], ['hr-designations'],
//     ['attendance-shifts'], ['admin-users','reporting-manager']) - one cache,
//     no duplicate requests.
//   * Submission is the SAME adminApi.users.create -> POST /users endpoint and
//     the SAME createUser() controller; the wizard's extended fields are
//     persisted onto the linked Employee HR profile by the controller and show
//     up on the employee's own My Profile.
//   * Password fields reuse PasswordField / PasswordStrength; the profile
//     image reuses ProfileImageField.
//
// SCOPING: the wizard applies to CREATE mode for staff roles (Employee /
// Manager - the roles that own an Employee HR profile). The Admin role keeps
// the existing single-page form (an Admin is a company owner, not an
// employee, so none of the HR steps apply), and EDIT mode keeps the existing
// single-page form everywhere. Client creation already delegates to
// ClientCreateForm and is untouched. The server remains authoritative - it
// re-validates every rule and CREATE_ROLE_MATRIX decides who may create what.
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'personal', label: 'Personal', icon: FiUser },
  { key: 'employment', label: 'Employment', icon: FiBriefcase },
  { key: 'education', label: 'Education', icon: FiBookOpen },
  { key: 'bank', label: 'Bank', icon: FiCreditCard },
  { key: 'emergency', label: 'Emergency', icon: FiPhone },
  { key: 'review', label: 'Review', icon: FiCheck },
]

// Which validation keys belong to which step. The wizard validates per step by
// filtering the SHARED validateUserForm() map; the final submit re-checks
// everything. Keeping the key lists here (not in userForm.js) means the rule
// definitions stay in ONE place and only their grouping is view-level.
const STEP_KEYS = [
  ['name', 'email', 'phone', 'gender', 'password', 'confirmPassword', 'dob', 'address', 'bloodGroup', 'maritalStatus'],
  ['role', 'status', 'employeeId', 'department', 'designation', 'employmentType', 'joiningDate', 'reportingManager', 'shift', 'experienceYears', 'salaryCtc'],
  ['education'],
  ['bank'],
  ['emergencyContacts'],
]

export default function UserWizard({ presetRole = '', creatableRoles = STAFF_FORM_ROLES, onSubmit, onCancel, saving = false }) {
  const [form, setForm] = useState(blankUserForm(presetRole ? { role: presetRole } : {}))
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState({})
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Same queries, same keys, same services as UserFormFields.jsx - one cache.
  const { data: deptData = [], isLoading: deptLoading } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
  })
  const { data: desigData = [], isLoading: desigLoading } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrApi.designations.all(),
    staleTime: 60_000,
  })
  const { data: shiftData = [], isLoading: shiftLoading } = useQuery({
    queryKey: ['attendance-shifts'],
    queryFn: () => attendanceApi.shifts.all(),
    staleTime: 60_000,
  })
  const { data: managerData, isLoading: managerLoading } = useQuery({
    queryKey: ['admin-users', 'reporting-manager'],
    queryFn: () => adminApi.users.query({ role: 'Manager', limit: 200 }),
    staleTime: 60_000,
  })

  const deptOptions = (Array.isArray(deptData) ? deptData : []).map((d) => ({
    value: d.name || d,
    label: d.name || String(d),
  }))
  const desigOptions = (Array.isArray(desigData) ? desigData : []).filter(
    (d) => !form.department || d.department === form.department
  ).map((d) => ({ value: d.title || d, label: d.title || String(d) }))
  const shiftOptions = (Array.isArray(shiftData) ? shiftData : [])
    .filter((s) => s?.name)
    .map((s) => ({ value: s.name, label: s.start && s.end ? `${s.name} (${s.start}\u2013${s.end})` : s.name }))
  const managerOptions = (managerData?.data || []).map((u) => ({
    value: u.name,
    label: u.name,
    meta: [u.department, u.designation].filter(Boolean).join(' \u00b7 '),
  }))

  const yearOptions = EDUCATION_YEAR_OPTIONS.map((y) => ({ value: y, label: y }))

  const validateStep = (s) => {
    const all = validateUserForm(form, 'add')
    const scoped = {}
    STEP_KEYS[s].forEach((k) => { if (all[k]) scoped[k] = all[k] })
    setErrors(scoped)
    return Object.keys(scoped).length === 0
  }

  const next = () => {
    if (!validateStep(step)) {
      toast.error('Fix the highlighted fields to continue')
      return
    }
    setErrors({})
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const back = () => {
    setErrors({})
    setStep((s) => Math.max(s - 1, 0))
  }

  const create = () => {
    const all = validateUserForm(form, 'add')
    setErrors(all)
    if (Object.keys(all).length) {
      toast.error('Review the highlighted fields before creating')
      return
    }
    onSubmit(buildUserPayload(form, 'add'))
  }

  const setEducation = (idx, field, value) =>
    setForm((f) => ({
      ...f,
      education: (f.education || []).map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    }))
  const addEducation = () => {
    if ((form.education || []).length >= 4) { toast.error('At most 4 education entries'); return }
    setForm((f) => ({ ...f, education: [...f.education, { ...EMPTY_EDUCATION_ROW }] }))
  }
  const removeEducation = (idx) =>
    setForm((f) => ({ ...f, education: f.education.filter((_, i) => i !== idx) }))

  const setContact = (idx, field, value) =>
    setForm((f) => ({
      ...f,
      emergencyContacts: (f.emergencyContacts || []).map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    }))
  const addContact = () => {
    if ((form.emergencyContacts || []).length >= 3) { toast.error('At most 3 emergency contacts'); return }
    setForm((f) => ({ ...f, emergencyContacts: [...f.emergencyContacts, { ...EMPTY_EMERGENCY_ROW }] }))
  }
  const removeContact = (idx) =>
    setForm((f) => ({ ...f, emergencyContacts: f.emergencyContacts.filter((_, i) => i !== idx) }))

  const educations = (form.education || []).filter((r) => r && (r.qualification || r.institution || r.fieldOfStudy || r.startYear || r.endYear || r.grade))
  const contacts = (form.emergencyContacts || []).filter((r) => r && (r.name || r.relation || r.phone))
  const bank = form.bank || {}
  const hasBank = Boolean(bank.name?.trim() || bank.account?.trim() || bank.ifsc?.trim())

  const review = (rows) => rows.filter(Boolean).map((v) => v).join(', ') || 'Not provided'

  return (
    <div>
      {/* Step indicator */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const active = i === step
          const done = i < step
          return (
            <div key={s.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setErrors({}); setStep(i) }}
                className="group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    done ? 'bg-success text-white' : active ? 'bg-primary text-white' : 'bg-app text-muted'
                  }`}
                >
                  {done ? <FiCheck /> : i + 1}
                </span>
                <span className={active ? 'text-primary' : 'text-muted'}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-app" />}
            </div>
          )
        })}
      </div>

      <motion.div
        key={step}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
      >
        {/* Step 1 - Personal */}
        {step === 0 && (
          <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
              <FiUser className="text-primary" /> Personal Information
            </h3>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-muted">Profile Image</label>
              <ProfileImageField value={form.avatar} onChange={(v) => setField('avatar', v)} />
            </div>
            <Input label="Full Name" placeholder="Jane Doe" value={form.name} onChange={(e) => setField('name', e.target.value)} error={errors.name} />
            <Input label="Email" type="email" placeholder="jane@skew.com" value={form.email} onChange={(e) => setField('email', e.target.value)} error={errors.email} />
            <Input label="Phone Number" placeholder="+91 �" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            <Select label="Gender" value={form.gender} onChange={(e) => setField('gender', e.target.value)}
              options={GENDER_OPTIONS.map((g) => ({ value: g, label: g }))} placeholder="Select gender" error={errors.gender} />
            <Input label="Date of Birth" type="date" value={form.dob} onChange={(e) => setField('dob', e.target.value)} />
            <Select label="Blood Group" value={form.bloodGroup} onChange={(e) => setField('bloodGroup', e.target.value)}
              options={BLOOD_GROUP_OPTIONS.map((b) => ({ value: b, label: b }))} placeholder="Select blood group" />
            <Select label="Marital Status" value={form.maritalStatus} onChange={(e) => setField('maritalStatus', e.target.value)}
              options={MARITAL_STATUS_OPTIONS.map((m) => ({ value: m, label: m }))} />
            <Input label="Address" value={form.address} onChange={(e) => setField('address', e.target.value)} placeholder="Street, city" className="sm:col-span-2" />
            <div className="grid grid-cols-1 items-start gap-4 sm:col-span-2 sm:grid-cols-2">
              <PasswordField label="Password" value={form.password} onChange={(e) => setField('password', e.target.value)} error={errors.password} />
              <PasswordField label="Confirm Password" value={form.confirmPassword} onChange={(e) => setField('confirmPassword', e.target.value)} error={errors.confirmPassword} />
              <div className="sm:col-span-2"><PasswordStrength value={form.password} /></div>
            </div>
          </Card>
        )}

        {/* Step 2 - Employment */}
        {step === 1 && (
          <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
              <FiBriefcase className="text-primary" /> Employment Details
            </h3>
            {presetRole ? (
              <Input label="Role" value={form.role} readOnly disabled className="sm:col-span-2" />
            ) : (
              <Select label="Role" value={form.role} onChange={(e) => setField('role', e.target.value)}
                options={creatableRoles.map((r) => ({ value: r, label: r }))} className="sm:col-span-2" />
            )}
            <Select label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}
              options={USER_STATUSES.map((s) => ({ value: s, label: s }))} />
            <Input label="Employee ID" value="Auto-generated (EMP001, EMP002, …)" readOnly disabled className="sm:col-span-2" />
            <MultiSelect label="Department" singleSelect value={form.department ? [form.department] : []}
              onChange={(arr) => { setField('department', arr[0] || ''); setField('designation', '') }}
              options={deptOptions} loading={deptLoading} emptyText="No departments found" placeholder="Select department�" error={errors.department} />
            <MultiSelect label="Designation" singleSelect value={form.designation ? [form.designation] : []}
              onChange={(arr) => setField('designation', arr[0] || '')}
              options={desigOptions} loading={desigLoading}
              emptyText={form.department ? 'No designations for this department' : 'Select a department first'}
              placeholder="Select designation�" error={errors.designation} />
            <Select label="Employment Type" value={form.employmentType} onChange={(e) => setField('employmentType', e.target.value)}
              options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))} />
            <Input label="Joining Date" type="date" value={form.joiningDate} onChange={(e) => setField('joiningDate', e.target.value)} />
            {form.role === 'Employee' && (
              <MultiSelect label="Reporting Manager" singleSelect value={form.reportingManager ? [form.reportingManager] : []}
                onChange={(arr) => setField('reportingManager', arr[0] || '')}
                options={managerOptions} loading={managerLoading} emptyText="No managers found" placeholder="Select reporting manager�" />
            )}
            <Select label="Shift" value={form.shift} onChange={(e) => setField('shift', e.target.value)}
              options={shiftOptions} loading={shiftLoading} emptyText="No shifts available"
              placeholder={shiftLoading ? 'Loading shifts…' : 'Select shift…'} />
            <Input label="Experience" value={form.experienceYears} onChange={(e) => setField('experienceYears', e.target.value)} placeholder="e.g. 4 yrs" />
            <Input label="Annual CTC (₹)" type="number" value={form.salaryCtc} onChange={(e) => setField('salaryCtc', e.target.value)} placeholder="e.g. 1200000" />
          </Card>
        )}

        {/* Step 3 - Education */}
        {step === 2 && (
          <Card>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <FiBookOpen className="text-primary" /> Education
            </h3>
            <p className="mt-1 text-xs text-muted">Academic history shown on the employee's My Profile. Blank rows are ignored.</p>
            <div className="mt-4 space-y-4">
              {(form.education || []).map((row, i) => (
                <div key={i} className="rounded-xl border border-app p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">Entry {i + 1}</span>
                    {(form.education || []).length > 1 && (
                      <button type="button" onClick={() => removeEducation(i)}
                        className="flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                        <FiTrash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Input label="Qualification" placeholder="e.g. B.Tech" value={row.qualification} onChange={(e) => setEducation(i, 'qualification', e.target.value)} />
                    <Input label="Institution" placeholder="e.g. Anna University" value={row.institution} onChange={(e) => setEducation(i, 'institution', e.target.value)} />
                    <Input label="Field of Study" placeholder="e.g. Computer Science" value={row.fieldOfStudy} onChange={(e) => setEducation(i, 'fieldOfStudy', e.target.value)} />
                    <Input label="Grade / CGPA" placeholder="e.g. 8.2" value={row.grade} onChange={(e) => setEducation(i, 'grade', e.target.value)} />
                    <Select label="Start Year" value={row.startYear} onChange={(e) => setEducation(i, 'startYear', e.target.value)}
                      options={yearOptions} placeholder="Year" />
                    <Select label="End Year" value={row.endYear} onChange={(e) => setEducation(i, 'endYear', e.target.value)}
                      options={yearOptions} placeholder="Year" />
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" icon={FiPlus} onClick={addEducation} className="mt-4">Add Education</Button>
            {errors.education && <p className="mt-2 text-xs font-medium text-danger">{errors.education}</p>}
          </Card>
        )}

        {/* Step 4 - Bank */}
        {step === 3 && (
          <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
              <FiCreditCard className="text-primary" /> Bank Details
            </h3>
            <p className="text-xs text-muted sm:col-span-2">Shown on the employee's salary tab in My Profile. Optional — leave blank to skip.</p>
            <Input label="Bank Name" value={bank.name} onChange={(e) => setField('bank', { ...bank, name: e.target.value })} error={errors.bank} placeholder="e.g. State Bank of India" />
            <Input label="Account Number" value={bank.account} onChange={(e) => setField('bank', { ...bank, account: e.target.value })} placeholder="e.g. 12345678901" />
            <Input label="IFSC Code" value={bank.ifsc} onChange={(e) => setField('bank', { ...bank, ifsc: e.target.value })} placeholder="e.g. SBIN0001234" />
          </Card>
        )}

        {/* Step 5 - Emergency contacts */}
        {step === 4 && (
          <Card>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <FiPhone className="text-primary" /> Emergency Contacts
            </h3>
            <p className="mt-1 text-xs text-muted">People to reach if the employee is unreachable. Blank rows are ignored.</p>
            <div className="mt-4 space-y-4">
              {(form.emergencyContacts || []).map((row, i) => (
                <div key={i} className="rounded-xl border border-app p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">Contact {i + 1}</span>
                    {(form.emergencyContacts || []).length > 1 && (
                      <button type="button" onClick={() => removeContact(i)}
                        className="flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                        <FiTrash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Input label="Name" value={row.name} onChange={(e) => setContact(i, 'name', e.target.value)} placeholder="e.g. Raj Kumar" />
                    <Input label="Relationship" value={row.relation} onChange={(e) => setContact(i, 'relation', e.target.value)} placeholder="e.g. Spouse" />
                    <Input label="Phone" value={row.phone} onChange={(e) => setContact(i, 'phone', e.target.value)} placeholder="+91 �" />
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" icon={FiPlus} onClick={addContact} className="mt-4">Add Contact</Button>
            {errors.emergencyContacts && <p className="mt-2 text-xs font-medium text-danger">{errors.emergencyContacts}</p>}
          </Card>
        )}

        {/* Step 6 - Review */}
        {step === 5 && (
          <div className="space-y-4">
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FiUser className="text-primary" /> Personal
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Full Name', form.name.trim()],
                  ['Email', form.email.trim()],
                  ['Phone', form.phone.trim()],
                  ['Gender', form.gender],
                  ['Date of Birth', form.dob],
                  ['Blood Group', form.bloodGroup],
                  ['Marital Status', form.maritalStatus],
                  ['Address', form.address.trim()],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-app p-3">
                    <p className="text-xs text-muted">{label}</p>
                    <p className="truncate font-medium">{value || 'Not provided'}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FiBriefcase className="text-primary" /> Employment
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Role', form.role],
                  ['Status', form.status],
                  ['Employee ID', form.employeeId.trim() || 'Auto-generated'],
                  ['Department', form.department],
                  ['Designation', form.designation],
                  ['Employment Type', form.employmentType],
                  ['Joining Date', form.joiningDate],
                  ['Reporting Manager', form.reportingManager],
                  ['Shift', form.shift],
                  ['Experience', form.experienceYears],
                  ['Annual CTC', form.salaryCtc ? `\u20b9${Number(form.salaryCtc).toLocaleString('en-IN')}` : 'Not provided'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-app p-3">
                    <p className="text-xs text-muted">{label}</p>
                    <p className="truncate font-medium">{value || 'Not provided'}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FiBookOpen className="text-primary" /> Education
              </h3>
              <div className="mt-3 space-y-3 text-sm">
                {educations.length ? educations.map((r, i) => (
                  <div key={i} className="rounded-xl border border-app p-3">
                    <p className="font-medium">{r.qualification || 'Qualification'} {r.institution ? `\u2014 ${r.institution}` : ''}</p>
                    <p className="text-xs text-muted">
                      {review([r.fieldOfStudy, r.startYear ? `From ${r.startYear}` : '', r.endYear ? `To ${r.endYear}` : '', r.grade ? `Grade: ${r.grade}` : ''])}
                    </p>
                  </div>
                )) : <p className="text-sm text-muted">Not provided</p>}
              </div>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FiCreditCard className="text-primary" /> Bank Details
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                {hasBank ? [
                  ['Bank Name', bank.name.trim()],
                  ['Account Number', bank.account.trim()],
                  ['IFSC', bank.ifsc.trim()],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-app p-3">
                    <p className="text-xs text-muted">{label}</p>
                    <p className="truncate font-medium">{value || 'Not provided'}</p>
                  </div>
                )) : <p className="text-sm text-muted">Not provided</p>}
              </div>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FiPhone className="text-primary" /> Emergency Contacts
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                {contacts.length ? contacts.map((c, i) => (
                  <div key={i} className="rounded-xl border border-app p-3">
                    <p className="truncate font-medium">{c.name || 'Contact'}</p>
                    <p className="text-xs text-muted">{review([c.relation && `Relationship: ${c.relation}`, c.phone && `Phone: ${c.phone}`])}</p>
                  </div>
                )) : <p className="text-sm text-muted">Not provided</p>}
              </div>
            </Card>
          </div>
        )}
      </motion.div>

      {/* Footer navigation */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" icon={FiChevronLeft} onClick={step === 0 ? onCancel : back}>
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" icon={FiChevronRight} onClick={next}>Continue</Button>
        ) : (
          <Button type="button" loading={saving} onClick={create}>Create User</Button>
        )}
      </div>
    </div>
  )
}