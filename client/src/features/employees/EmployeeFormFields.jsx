import { useMemo } from 'react'
import { useFieldArray } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { hrApi, attendanceApi } from '@/api/services'
import { PasswordField } from '@/features/admin/PasswordField'
import { ProfileImageField } from '@/features/employees/ProfileImageField'
import { EMPLOYMENT_TYPES, EMPLOYEE_STATUS } from './constants'

const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

const GENDERS = ['Male', 'Female']

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const MARITAL_STATUSES = ['Single', 'Married', 'Other']

export const EMPLOYEE_FORM_DEFAULTS = {
  name: '', email: '', phone: '', department: '', designation: '',
  employmentType: 'Full-time', salary: 0,
  joiningDate: '', experience: '', emergencyContact: '', status: 'Active',
  role: 'Employee', avatar: '',
  skills: [],
  gender: '', shift: '', reportingTo: '', dob: '', bloodGroup: '',
  maritalStatus: 'Single', address: '',
  bankName: '', bankAccount: '', bankIfsc: '',
  // create-only account fields
  password: '', confirmPassword: '',
}

export function toEmployeeFormValues(employee, base = EMPLOYEE_FORM_DEFAULTS) {
  if (!employee) return { ...base }
  return {
    ...base,
    ...employee,
    // detailed records store salary as an object
    salary: typeof employee.salary === 'object' ? (employee.salary?.ctc ?? 0) : (employee.salary ?? 0),
    // map model field names back onto the flat form fields
    experience: employee.experienceYears || '',
    joiningDate: employee.joiningDate ? String(employee.joiningDate).slice(0, 10) : '',
    dob: employee.dob ? String(employee.dob).slice(0, 10) : '',
    gender: employee.gender || '',
    shift: employee.shift || '',
    reportingTo: employee.reportingTo || '',
    bloodGroup: employee.bloodGroup || '',
    maritalStatus: employee.maritalStatus || 'Single',
    address: employee.address || '',
    bankName: employee.bank?.name || '',
    bankAccount: employee.bank?.account || '',
    bankIfsc: employee.bank?.ifsc || '',
    role: 'Employee',
    // Guard the shape: a legacy record may have no skills array at all.
    skills: Array.isArray(employee.skills) ? employee.skills : [],
    password: '', confirmPassword: '',
  }
}

/**
 * Shared employee form body.
 *
 * @param form        react-hook-form instance owned by the caller
 * @param mode        'create' | 'edit'
 * @param enabled     gate the async option queries
 * @param permissions { canEditSalary, canEditEmail, canEditStatus } - see
 *                    features/employees/permissions.js. The SERVER re-enforces
 *                    every one of these; hiding an input is never the only gate.
 * @param empCode     server-allocated employee code, rendered read-only on edit
 */
export function EmployeeFormFields({
  form, mode = 'edit', enabled = true, permissions = {}, empCode = '',
}) {
  const isCreate = mode === 'create'
  const {
    canEditSalary = true,
    canEditEmail = true,
    canEditStatus = true,
  } = permissions

  const { register, watch, setValue, control, formState: { errors } } = form
  const avatar = watch('avatar')
  const department = watch('department')
  const designation = watch('designation')

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
  const { data: shiftData = [], isLoading: shiftLoading } = useQuery({
    queryKey: ['attendance-shifts'],
    queryFn: () => attendanceApi.shifts.all(),
    staleTime: 60_000,
    enabled,
  })

  const deptOptions = useMemo(() => {
    const rows = Array.isArray(deptData) ? deptData : []
    const opts = rows
      .map((d) => d?.name)
      .filter(Boolean)
      .map((name) => ({ value: name, label: name }))
    if (department && !opts.some((o) => o.value === department)) {
      opts.unshift({ value: department, label: department })
    }
    return opts
  }, [deptData, department])

  const desigOptions = useMemo(() => {
    const rows = Array.isArray(desigData) ? desigData : []
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

  const shift = watch('shift')
  const shiftOptions = useMemo(() => {
    const rows = Array.isArray(shiftData) ? shiftData : []
    const opts = rows
      .filter((s) => s?.name)
      .map((s) => ({ value: s.name, label: s.start && s.end ? `${s.name} (${s.start}–${s.end})` : s.name }))
    if (shift && !opts.some((o) => o.value === shift)) opts.unshift({ value: shift, label: shift })
    return opts
  }, [shiftData, shift])

  // Reuses react-hook-form's own useFieldArray (already a project dependency).
  const { fields: skillFields, append: addSkill, remove: removeSkill } =
    useFieldArray({ control, name: 'skills' })

  const section = (label) => (
    <h3 className="mt-2 border-t border-app pt-4 text-sm font-semibold text-muted sm:col-span-2">{label}</h3>
  )

  return (
    <>
      {/* --- Personal information ------------------------------------------ */}
      <div className="sm:col-span-2">
        <label className="mb-1.5 block text-sm font-medium text-muted">Profile Image</label>
        <ProfileImageField value={avatar} onChange={(v) => setValue('avatar', v)} />
      </div>

      <Input label="Full Name" error={errors.name?.message} {...register('name')} />
      <Input
        label="Email"
        error={errors.email?.message}
        readOnly={!canEditEmail}
        disabled={!canEditEmail}
        {...register('email')}
      />
      <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
      <Select
        label="Gender"
        options={GENDERS}
        placeholder="Select gender"
        error={errors.gender?.message}
        {...register('gender')}
      />
      <Input label="Emergency Contact" {...register('emergencyContact')} />
      {!isCreate && (
        <>
          <Input label="Date of Birth" type="date" {...register('dob')} />
          <Select label="Blood Group" options={BLOOD_GROUPS} placeholder="Select blood group" {...register('bloodGroup')} />
          <Select label="Marital Status" options={MARITAL_STATUSES} {...register('maritalStatus')} />
          <div className="hidden sm:block" />
          <div className="sm:col-span-2">
            <Textarea label="Address" rows={2} {...register('address')} />
          </div>
        </>
      )}

      {/* --- Employment ----------------------------------------------------- */}
      {section('Employment')}

      <Input label="Role" value="Employee" readOnly disabled />
      {!isCreate && (
        <Input label="Employee Code" value={empCode || '—'} readOnly disabled />
      )}
      <Select
        label="Department"
        options={deptOptions}
        loading={deptLoading}
        placeholder={deptLoading ? 'Loading departments…' : 'Select department…'}
        emptyText="No departments found"
        error={errors.department?.message}
        {...register('department')}
      />
      <Select
        label="Designation"
        options={desigOptions}
        loading={desigLoading}
        placeholder={desigLoading ? 'Loading designations…' : 'Select designation…'}
        emptyText="No designations found"
        error={errors.designation?.message}
        {...register('designation')}
      />
      <Select label="Employment Type" options={EMPLOYMENT_TYPES} {...register('employmentType')} />
      <Select
        label="Shift"
        options={shiftOptions}
        loading={shiftLoading}
        emptyText="No shifts available"
        placeholder={shiftLoading ? 'Loading shifts…' : 'Select shift…'}
        {...register('shift')}
      />
      <Input label="Reporting To" placeholder="Manager name" {...register('reportingTo')} />
      <Input label="Joining Date" type="date" {...register('joiningDate')} />
      <Input label="Experience" placeholder="e.g. 4 yrs" {...register('experience')} />
      {canEditStatus && (
        <Select label="Status" options={EMPLOYEE_STATUS} {...register('status')} />
      )}

      {/* --- Compensation (Admin / HR only) --------------------------------- */}
      {canEditSalary && (
        <>
          {section('Compensation')}
          <Input label="Annual CTC (₹)" type="number" error={errors.salary?.message} {...register('salary')} />
          <div className="hidden sm:block" />
          {!isCreate && (
            <>
              <Input label="Bank Name" {...register('bankName')} />
              <Input label="Account Number" {...register('bankAccount')} />
              <Input label="IFSC Code" {...register('bankIfsc')} />
            </>
          )}
          <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
            The salary breakdown (basic, HRA, PF, tax, net) is derived from the CTC by the
            server and is never typed here.
          </p>
        </>
      )}

      {/* --- Skills (edit only: not part of the provisioning payload) -------- */}
      {!isCreate && (
        <>
          {section('Skills')}
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
        </>
      )}

      {isCreate && (
        <>
          {section('Login credentials')}
          <PasswordField label="Password" error={errors.password?.message} {...register('password')} />
          <PasswordField label="Confirm Password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
          <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
            This creates the employee record <b>and</b> their login. Password must be 8&ndash;64 characters
            with an uppercase letter, a lowercase letter, a number and a special character.
          </p>
        </>
      )}

      {!isCreate && (
        <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
          Passwords are managed via <b>Reset Password</b> in the Admin &rarr; Users module &mdash; they cannot be edited here.
        </p>
      )}
    </>
  )
}
