import { useEffect, useMemo } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Modal, Button, Input, Select } from '@/components/ui'
// PHASE NEXT (TASK 1): the EXISTING HR department/designation API - the very
// same `hrApi.departments` / `hrApi.designations` collections that back the
// Admin/HR "Departments" and "Designations" management pages
// (pages/hr/Departments.jsx, pages/hr/Designations.jsx). No second data source.
import { hrApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
// Phase 6.20 (CLEANUP - "remove duplicate password inputs"): the last two raw
// <Input type="password"> fields in the app lived below. Same root cause as
// TASK 4 - the shared PasswordField was simply never wired in here - so they
// are switched to it too rather than left as a second, toggle-less pattern.
// PasswordField forwards the react-hook-form `register` spread untouched.
import { PasswordField } from '@/features/admin/PasswordField'
import { ProfileImageField } from '@/features/employees/ProfileImageField'
import { employeeSchema, employeeCreateSchema } from './schema'
// PHASE NEXT (TASK 1): DEPARTMENTS / DESIGNATIONS are no longer imported here.
// ROOT CAUSE of "the dropdown shows code-defined values": this form fed the
// two <Select>s from the static arrays in ./constants, so nothing an Admin/HR
// user created in HR -> Departments / Designations could ever appear. They are
// now loaded from MongoDB through hrApi (see the queries below).
import { EMPLOYMENT_TYPES, EMPLOYEE_STATUS, WORK_LOCATIONS } from './constants'

const EMPTY = {
  // department/designation start EMPTY: seeding 'Engineering' was itself a
  // hardcoded value and would have been saved verbatim if the user never
  // touched the dropdown, even when no such department exists in the database.
  name: '', email: '', phone: '', department: '', designation: '',
  employmentType: 'Full-time', workLocation: 'Bengaluru HQ', salary: 0,
  joiningDate: '', experience: '', emergencyContact: '', status: 'Active',
  role: 'Employee', employeeId: '', avatar: '',
  skills: [],
}

// Mirrors the `level` enum on skillSchema in server/src/models/Employee.js.
const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

// Mirrors GENDERS in server/src/models/User.js. Gender is required by
// userController.createUser (assertGender) for every non-Client role, so the
// create form must collect it or the POST would fail with a 400.
const GENDERS = ['Male', 'Female']

// SHARED employee form.
// Phase 6.2 (Task 5): previously EDIT-ONLY, which is why HR/Manager had nowhere
// to create a person without being bounced to Admin -> Users. It now also runs
// in CREATE mode via the `mode` prop. This is the SAME component, the SAME
// fields and the SAME zod schema object - create mode only adds the three
// account fields the server demands (gender + password + confirmation) and
// swaps the title/button label. No second form was introduced.
export function EmployeeFormModal({ open, onClose, onSubmit, employee, loading, mode = 'edit' }) {
  const isCreate = mode === 'create'
  // PHASE NEXT (TASK 2): the Work Location field is hidden for MANAGER only.
  // Admin / HR keep it (Admin -> Users also still collects it), so nothing is
  // removed globally and the Employee model keeps the field.
  const { user } = useAuth()
  const isManager = user?.role === ROLES.MANAGER
  // Manager must never submit a work location, so the create/reset defaults
  // blank it out for that role instead of sending the seeded 'Bengaluru HQ'.
  const emptyValues = useMemo(
    () => (isManager ? { ...EMPTY, workLocation: '' } : EMPTY),
    [isManager],
  )

  // --- PHASE NEXT (TASK 1): REAL Department / Designation records ----------
  // This is the SAME query key, SAME service call and SAME staleTime already
  // used by pages/admin/Users.jsx (the only place these were already loaded
  // dynamically), so both forms share ONE React Query cache entry and one
  // backend collection. A department or designation created by Admin/HR in
  // HR -> Departments / Designations therefore appears here as soon as the
  // shared ['hr-departments'] / ['hr-designations'] cache refreshes.
  const { data: deptData = [], isLoading: deptLoading } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
    enabled: open,
  })
  const { data: desigData = [], isLoading: desigLoading } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrApi.designations.all(),
    staleTime: 60_000,
    enabled: open,
  })

  const {
    register, handleSubmit, reset, watch, setValue, control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(isCreate ? employeeCreateSchema : employeeSchema),
    defaultValues: EMPTY,
  })

  const avatar = watch('avatar')
  const department = watch('department')
  const designation = watch('designation')

  // Employee.department / Employee.designation are STRINGS on the server model
  // (see server/src/models/Employee.js), and Department.name / Designation.title
  // are the values HR stores. So the option VALUE stays the stored name/title -
  // the existing value relationship the backend expects is preserved exactly.
  const deptOptions = useMemo(() => {
    const rows = Array.isArray(deptData) ? deptData : []
    const opts = rows
      .map((d) => d?.name)
      .filter(Boolean)
      .map((name) => ({ value: name, label: name }))
    // A legacy employee may hold a department that has since been renamed or
    // deleted. Keep their stored value selectable so editing does not silently
    // blank it - this is the record's OWN value, not a hardcoded list.
    if (department && !opts.some((o) => o.value === department)) {
      opts.unshift({ value: department, label: department })
    }
    return opts
  }, [deptData, department])

  const desigOptions = useMemo(() => {
    const rows = Array.isArray(desigData) ? desigData : []
    // Same narrowing rule pages/admin/Users.jsx applies: when a department is
    // chosen, only that department's designations are offered.
    const opts = rows
      .filter((d) => !department || d?.department === department)
      .map((d) => d?.title)
      .filter(Boolean)
      .map((title) => ({ value: title, label: title }))
    if (designation && !opts.some((o) => o.value === designation)) {
      opts.unshift({ value: designation, label: designation })
    }
    return opts
  }, [desigData, department, designation])

  // Reuses react-hook-form's own useFieldArray (already a project dependency).
  // No new state library, and no new form component was introduced.
  const { fields: skillFields, append: addSkill, remove: removeSkill } =
    useFieldArray({ control, name: 'skills' })

  useEffect(() => {
    if (!open) return
    // Create mode: start clean. Without this the modal would retain the last
    // edited person's values when reopened as "Add Employee".
    if (isCreate) { reset(emptyValues); return }
    if (!employee) return
    reset({
      ...emptyValues, ...employee,
      // detailed records store salary as an object
      salary: typeof employee.salary === 'object' ? employee.salary.ctc : employee.salary,
      // map model field names back onto the flat form fields
      experience: employee.experienceYears || employee.experience || '',
      employeeId: employee.empCode || employee.employeeId || '',
      joiningDate: employee.joiningDate ? String(employee.joiningDate).slice(0, 10) : '',
      role: 'Employee',
      // Guard the shape: a legacy record may have no skills array at all.
      skills: Array.isArray(employee.skills) ? employee.skills : [],
    })
  }, [open, employee, reset, isCreate, emptyValues])

  const submit = (values) => onSubmit(values)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isCreate ? 'Add Employee' : 'Edit Employee'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit(submit)} loading={loading}>{isCreate ? 'Create Employee' : 'Save Changes'}</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium text-muted">Profile Image</label>
          <ProfileImageField value={avatar} onChange={(v) => setValue('avatar', v)} />
        </div>

        <Input label="Full Name" error={errors.name?.message} {...register('name')} />
        <Input label="Email" error={errors.email?.message} {...register('email')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
        <Input label="Role" value="Employee" readOnly disabled className="opacity-70" />
        <Input label="Employee ID" placeholder="Auto-generated if blank" {...register('employeeId')} />
        <Select
          label="Department"
          options={deptOptions}
          loading={deptLoading}
          placeholder={deptLoading ? 'Loading departments\u2026' : 'Select department\u2026'}
          emptyText="No departments found"
          error={errors.department?.message}
          {...register('department')}
        />
        <Select
          label="Designation"
          options={desigOptions}
          loading={desigLoading}
          placeholder={desigLoading ? 'Loading designations\u2026' : 'Select designation\u2026'}
          emptyText="No designations found"
          error={errors.designation?.message}
          {...register('designation')}
        />
        <Select label="Employment Type" options={EMPLOYMENT_TYPES} {...register('employmentType')} />
        {/* PHASE NEXT (TASK 2): Manager does not see Work Location. Every other
            role renders it exactly as before. The zod rule stays `optional()`,
            so omitting the field cannot fail validation. */}
        {!isManager && (
          <Select label="Work Location" options={WORK_LOCATIONS} {...register('workLocation')} />
        )}
        <Input label="Annual CTC (\u20b9)" type="number" error={errors.salary?.message} {...register('salary')} />
        <Input label="Joining Date" type="date" {...register('joiningDate')} />
        <Input label="Experience" placeholder="e.g. 4 yrs" {...register('experience')} />
        <Input label="Emergency Contact" {...register('emergencyContact')} />
        <Select label="Status" options={EMPLOYEE_STATUS} {...register('status')} />

        {/* Phase 5.9.1 - SKILLS EDITOR.
            ROOT CAUSE of "there is no option for skills": Employee.skills has
            always existed in the Mongo model, and the employee DETAIL page
            already rendered skills read-only (features/employees/detailTabs.jsx),
            but this Edit modal exposed no input for them - so they could never
            be created or maintained from the UI. */}
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <label className="block text-sm font-medium text-muted">Skills</label>
            <Button
              type="button"
              variant="ghost"
              onClick={() => addSkill({ name: '', level: 'Intermediate' })}
            >
              + Add Skill
            </Button>
          </div>

          {!skillFields.length && (
            <p className="rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
              No skills recorded yet. Use "Add Skill" to add one.
            </p>
          )}

          <div className="space-y-2">
            {skillFields.map((f, i) => (
              <div key={f.id} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={i === 0 ? 'Skill' : undefined}
                    placeholder="e.g. React"
                    error={errors.skills?.[i]?.name?.message}
                    {...register(`skills.${i}.name`)}
                  />
                </div>
                <div className="w-44">
                  <Select
                    label={i === 0 ? 'Level' : undefined}
                    options={SKILL_LEVELS}
                    {...register(`skills.${i}.level`)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => removeSkill(i)}
                  aria-label="Remove skill"
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Phase 6.2 (Task 5) - CREATE-ONLY account fields.
            These exist because creating an employee provisions a LOGIN (a User
            document) as well as the Employee record - the server's single
            provisioning routine requires gender and a policy-compliant
            password. In edit mode this block is not rendered at all, so the
            edit experience is byte-for-byte what it was before. */}
        {isCreate && (
          <>
            <Select label="Gender" options={GENDERS} placeholder="Select gender" error={errors.gender?.message} {...register('gender')} />
            <div className="hidden sm:block" />
            <PasswordField label="Password" error={errors.password?.message} {...register('password')} />
            <PasswordField label="Confirm Password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
            <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
              This creates the employee record <b>and</b> their login. Password must be 8–64 characters with an uppercase letter, a lowercase letter, a number and a special character.
            </p>
          </>
        )}

        {!isCreate && (
        <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
          Passwords are managed via <b>Reset Password</b> in the Admin \u2192 Users module \u2014 they cannot be edited here.
        </p>
        )}
      </form>
    </Modal>
  )
}
