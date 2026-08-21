import { useState, useEffect, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiMail, FiPhone, FiMapPin, FiCalendar, FiUser, FiUploadCloud,
  FiFileText, FiFile, FiImage, FiDownload, FiTrash2, FiStar, FiAward, FiBriefcase,
  FiPlus, FiEdit2, FiEye, FiDroplet, FiHeart, FiClock, FiUsers, FiCreditCard,
  FiHash, FiActivity, FiTrendingUp, FiBarChart2, FiInbox,
} from 'react-icons/fi'
import {
  Card, CardHeader, Badge, DataTable, Avatar, Button, Modal, Input,
  EmptyState, Loader,
} from '@/components/ui'
import { employeeApi, leaveApi, hrApi } from '@/api/services'
import apiClient from '@/api/client'
import { fileUrl } from '@/features/files/constants'
import { formatCurrency, formatDate, formatBytes } from '@/utils'

const asArray = (v) => (Array.isArray(v) ? v : [])
const rowKey = (x, i) => x?._id || x?.id || i
const filled = (v) => v !== undefined && v !== null && String(v).trim() !== ''
const anyFilled = (...vals) => vals.some(filled)

/** Shared "Add Details" / "Edit" affordance for a section header. */
function SectionAction({ show, hasData, onClick, addLabel = 'Add Details', editLabel = 'Edit' }) {
  if (!show) return null
  return (
    <Button
      size="sm"
      variant={hasData ? 'ghost' : 'primary'}
      icon={hasData ? FiEdit2 : FiPlus}
      onClick={onClick}
    >
      {hasData ? editLabel : addLabel}
    </Button>
  )
}

/** One label/value cell. Never renders a bare empty box. */
function InfoCell({ icon: Icon, label, value }) {
  const has = filled(value)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-app p-3">
      <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${has ? 'bg-primary/10 text-primary' : 'bg-black/5 text-muted dark:bg-white/10'}`}>
        <Icon />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className={`truncate text-sm ${has ? 'font-medium' : 'italic text-muted'}`}>
          {has ? value : 'Not added'}
        </p>
      </div>
    </div>
  )
}

function useEmployeePatch(employeeId, successMessage) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch) => employeeApi.update(employeeId, patch),
    onSuccess: () => {
      toast.success(successMessage)
      qc.invalidateQueries({ queryKey: ['employee', employeeId] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['employee-stats'] })
    },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not save changes'),
  })
}

/**
 * Generic sub-document list editor (certificates / experience / emergency
 * contacts). ONE editor, three call sites - the alternative was three nearly
 * identical modals.
 *
 * @param fields [{ key, label, type?, placeholder?, required?, wide? }]
 * @param items  current array from the employee record
 * @param onSave (rows) => void  - the caller maps it onto its own field name
 */
function ListEditorModal({
  open, onClose, title, description, fields, items, onSave, saving,
  addLabel = 'Add row', emptyHint = 'Nothing added yet.',
}) {
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setRows(asArray(items).map((it) => ({ ...it })))
    setErrors({})
  }, [open, items])

  const blankRow = () => Object.fromEntries(fields.map((f) => [f.key, '']))
  const setCell = (i, key, value) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)))
  const addRow = () => setRows((r) => [...r, blankRow()])
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i))

  const submit = () => {
    const found = {}
    rows.forEach((row, i) => {
      fields.forEach((f) => {
        if (f.required && !String(row[f.key] ?? '').trim()) {
          found[`${i}.${f.key}`] = `${f.label} is required`
        }
      })
    })
    setErrors(found)
    if (Object.keys(found).length) return
    onSave(rows)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>Save</Button>
        </>
      }
    >
      {description && <p className="mb-4 text-sm text-muted">{description}</p>}

      {!rows.length && (
        <p className="rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">{emptyHint}</p>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-app p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <Input
                  key={f.key}
                  label={f.label}
                  type={f.type || 'text'}
                  placeholder={f.placeholder}
                  value={row[f.key] ?? ''}
                  onChange={(e) => setCell(i, f.key, e.target.value)}
                  error={errors[`${i}.${f.key}`]}
                  className={f.wide ? 'sm:col-span-2' : undefined}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-end">
              <Button type="button" variant="ghost" size="sm" icon={FiTrash2} onClick={() => removeRow(i)}>
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button type="button" variant="ghost" icon={FiPlus} onClick={addRow}>{addLabel}</Button>
      </div>
    </Modal>
  )
}

// ---------- Overview ----------
export function OverviewTab({ employee, canEdit, onEdit }) {
  const personal = [
    { icon: FiMail, label: 'Email', value: employee.email },
    { icon: FiPhone, label: 'Phone', value: employee.phone },
    { icon: FiUser, label: 'Gender', value: employee.gender },
    { icon: FiCalendar, label: 'Date of Birth', value: employee.dob ? formatDate(employee.dob) : '' },
    { icon: FiDroplet, label: 'Blood Group', value: employee.bloodGroup },
    { icon: FiHeart, label: 'Marital Status', value: employee.maritalStatus },
    { icon: FiMapPin, label: 'Address', value: employee.address },
  ]
  const professional = [
    { icon: FiHash, label: 'Employee Code', value: employee.empCode },
    { icon: FiBriefcase, label: 'Department', value: employee.department },
    { icon: FiBriefcase, label: 'Designation', value: employee.designation },
    { icon: FiBriefcase, label: 'Employment Type', value: employee.employmentType },
    { icon: FiUser, label: 'Reporting To', value: employee.reportingTo },
    { icon: FiClock, label: 'Shift', value: employee.shift },
    { icon: FiCalendar, label: 'Joining Date', value: employee.joiningDate ? formatDate(employee.joiningDate) : '' },
    { icon: FiTrendingUp, label: 'Experience', value: employee.experienceYears },
    { icon: FiActivity, label: 'Status', value: employee.status },
  ]

  const personalHasData = personal.some((i) => filled(i.value))
  const professionalHasData = professional.some((i) => filled(i.value))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Personal Information"
          subtitle={personalHasData ? undefined : 'No personal information has been added yet'}
          action={<SectionAction show={canEdit} hasData={personalHasData} onClick={onEdit} />}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {personal.map((i) => <InfoCell key={i.label} {...i} />)}
        </div>
      </Card>

      <Card>
        <CardHeader title="Performance Snapshot" />
        <div className="flex flex-col items-center">
          <div className="relative flex h-32 w-32 items-center justify-center">
            <svg className="h-32 w-32 -rotate-90">
              <circle cx="64" cy="64" r="56" className="stroke-black/10 dark:stroke-white/10" strokeWidth="10" fill="none" />
              <circle cx="64" cy="64" r="56" stroke="#2563EB" strokeWidth="10" fill="none"
                strokeDasharray={2 * Math.PI * 56} strokeDashoffset={2 * Math.PI * 56 * (1 - (employee.performance || 0) / 100)} strokeLinecap="round" />
            </svg>
            <span className="absolute text-2xl font-bold">{employee.performance ?? 0}%</span>
          </div>
          <p className="mt-3 text-sm text-muted">Overall rating</p>
        </div>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader
          title="Professional Information"
          subtitle={professionalHasData ? undefined : 'No employment information has been added yet'}
          action={<SectionAction show={canEdit} hasData={professionalHasData} onClick={onEdit} />}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {professional.map((i) => <InfoCell key={i.label} {...i} />)}
        </div>
      </Card>
    </div>
  )
}

// ---------- Salary ----------
export function SalaryTab({ employee, canEditSalary, onEdit }) {
  const s = employee.salary || {}
  const bank = employee.bank || {}
  const hasSalary = Number(s.ctc) > 0
  const hasBank = anyFilled(bank.name, bank.account, bank.ifsc)

  const rows = [
    { label: 'Gross', value: s.monthly }, { label: 'PF (deduction)', value: -s.pf },
    { label: 'ESI (deduction)', value: -s.esi },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Salary Breakdown"
          subtitle={hasSalary ? 'Monthly components' : undefined}
          action={
            <SectionAction
              show={canEditSalary}
              hasData={hasSalary}
              onClick={onEdit}
              addLabel="Add Salary Details"
              editLabel="Edit Salary"
            />
          }
        />
        {hasSalary ? (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between rounded-xl border border-app p-3">
                <span className="text-sm">{r.label}</span>
                <span className={`font-medium ${r.value < 0 ? 'text-danger' : ''}`}>{formatCurrency(r.value)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl bg-primary/10 p-3">
              <span className="font-semibold">Net Monthly</span>
              <span className="text-lg font-bold text-primary">{formatCurrency(s.net)}</span>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={FiBarChart2}
            title="No salary details added"
            description={canEditSalary
              ? 'Add an annual CTC and the server derives basic, PF, ESI and net automatically.'
              : 'Compensation is maintained by Admin and HR.'}
            action={canEditSalary && <Button icon={FiPlus} onClick={onEdit}>Add Salary Details</Button>}
          />
        )}
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Annual CTC" />
          {hasSalary ? (
            <>
              <p className="text-3xl font-bold text-primary">{formatCurrency(s.ctc)}</p>
              <p className="text-sm text-muted">{formatCurrency(s.monthly)} / month</p>
              <p className="mt-2 text-xs text-muted">Basic Salary: <span className="font-medium text-current">{formatCurrency(s.basic)}</span></p>
            </>
          ) : (
            <p className="text-sm italic text-muted">Not added</p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Bank Details"
            action={
              <SectionAction
                show={canEditSalary}
                hasData={hasBank}
                onClick={onEdit}
                addLabel="Add Bank Details"
                editLabel="Edit"
              />
            }
          />
          {hasBank ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">Bank</span><span className="font-medium">{bank.name || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted">Account</span><span className="font-mono">{bank.account || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted">IFSC</span><span className="font-mono">{bank.ifsc || '—'}</span></div>
            </div>
          ) : (
            <EmptyState
              icon={FiCreditCard}
              title="No bank details added"
              description={canEditSalary
                ? 'Bank name, account number and IFSC are captured on the employee edit form.'
                : 'Bank details are maintained by Admin and HR.'}
              action={canEditSalary && <Button icon={FiPlus} onClick={onEdit}>Add Bank Details</Button>}
            />
          )}
        </Card>
      </div>
    </div>
  )
}

// ---------- Skills & Experience ----------
const EXPERIENCE_FIELDS = [
  { key: 'company', label: 'Company', required: true, placeholder: 'e.g. Skew Infotech' },
  { key: 'role', label: 'Role', placeholder: 'e.g. Senior Developer' },
  { key: 'from', label: 'From', placeholder: 'e.g. Jan 2020' },
  { key: 'to', label: 'To', placeholder: 'e.g. Mar 2023 / Present' },
]

export function SkillsTab({ employee, employeeId, canEdit, onEdit }) {
  const levelTone = { Beginner: 'default', Intermediate: 'accent', Advanced: 'primary', Expert: 'success' }
  const skills = asArray(employee.skills)
  const experience = asArray(employee.experience)
  const [editingExp, setEditingExp] = useState(false)

  const expMutation = useEmployeePatch(employeeId, 'Work experience updated')

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Skills"
          action={
            <SectionAction
              show={canEdit}
              hasData={skills.length > 0}
              onClick={onEdit}
              addLabel="Add Skills"
              editLabel="Edit Skills"
            />
          }
        />
        {skills.length ? (
          <div className="space-y-3">
            {skills.map((sk, i) => (
              <div key={rowKey(sk, i) || sk.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{sk.name}</span>
                  <Badge tone={levelTone[sk.level]}>{sk.level}</Badge>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${{ Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 }[sk.level] || 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FiStar}
            title="No skills added"
            description={canEdit
              ? 'Skills are captured on the employee edit form, where they can be added and rated.'
              : 'No skills have been recorded for this employee.'}
            action={canEdit && <Button icon={FiPlus} onClick={onEdit}>Add Skills</Button>}
          />
        )}
      </Card>

      <Card>
        <CardHeader
          title="Work Experience"
          action={
            <SectionAction
              show={canEdit}
              hasData={experience.length > 0}
              onClick={() => setEditingExp(true)}
              addLabel="Add Experience"
              editLabel="Edit Experience"
            />
          }
        />
        {experience.length ? (
          <div className="relative space-y-4 border-l-2 border-app pl-4">
            {experience.map((exp, i) => (
              <div key={rowKey(exp, i)} className="relative">
                <span className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-[var(--surface)]" />
                <p className="text-sm font-semibold">{exp.role || '—'}</p>
                <p className="text-sm text-muted">{exp.company}</p>
                <p className="text-xs text-muted">{[exp.from, exp.to].filter(Boolean).join(' – ') || '—'}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FiBriefcase}
            title="No work experience added"
            description={canEdit
              ? 'Record the previous companies, roles and dates for this employee.'
              : 'No previous experience has been recorded for this employee.'}
            action={canEdit && <Button icon={FiPlus} onClick={() => setEditingExp(true)}>Add Experience</Button>}
          />
        )}
      </Card>

      {canEdit && (
        <ListEditorModal
          open={editingExp}
          onClose={() => setEditingExp(false)}
          title="Work Experience"
          description="Previous employment history. Company is required; every other field is optional."
          fields={EXPERIENCE_FIELDS}
          items={experience}
          saving={expMutation.isPending}
          addLabel="Add another role"
          emptyHint='No experience recorded yet. Use "Add another role" to start.'
          onSave={(rows) =>
            expMutation.mutate({ experience: rows }, { onSuccess: () => setEditingExp(false) })}
        />
      )}
    </div>
  )
}

// ---------- Certificates ----------
const CERTIFICATE_FIELDS = [
  { key: 'name', label: 'Certificate Name', required: true, placeholder: 'e.g. AWS Solutions Architect', wide: true },
  { key: 'issuer', label: 'Issued By', placeholder: 'e.g. Amazon Web Services' },
  { key: 'year', label: 'Year', type: 'number', placeholder: 'e.g. 2024' },
]

export function CertificatesTab({ employee, employeeId, canEdit }) {
  const certificates = asArray(employee.certificates)
  const [editing, setEditing] = useState(false)
  const mutation = useEmployeePatch(employeeId, 'Certificates updated')

  const save = (rows) =>
    mutation.mutate(
      {
        certificates: rows.map((r) => ({
          ...r,
          year: String(r.year ?? '').trim() === '' ? undefined : Number(r.year),
        })),
      },
      { onSuccess: () => setEditing(false) },
    )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Certifications"
          subtitle={certificates.length ? `${certificates.length} recorded` : undefined}
          action={
            <SectionAction
              show={canEdit}
              hasData={certificates.length > 0}
              onClick={() => setEditing(true)}
              addLabel="Add Certificate"
              editLabel="Edit Certificates"
            />
          }
        />
        {certificates.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {certificates.map((c, i) => (
              <div key={rowKey(c, i)} className="rounded-card border border-app p-4 transition hover:shadow-card">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-warning/10 text-warning"><FiAward className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{c.name}</p>
                    <p className="text-sm text-muted">{c.issuer || '—'}</p>
                    {c.year ? <Badge tone="accent" className="mt-2">{c.year}</Badge> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FiAward}
            title="No certificates added"
            description={canEdit
              ? 'Record the certifications this employee holds. Scanned copies can be attached in the Documents tab.'
              : 'No certifications have been recorded for this employee.'}
            action={canEdit && <Button icon={FiPlus} onClick={() => setEditing(true)}>Add Certificate</Button>}
          />
        )}
      </Card>

      {canEdit && (
        <ListEditorModal
          open={editing}
          onClose={() => setEditing(false)}
          title="Certifications"
          description="Certificate name is required. Attach the scanned certificate itself in the Documents tab."
          fields={CERTIFICATE_FIELDS}
          items={certificates}
          saving={mutation.isPending}
          addLabel="Add another certificate"
          emptyHint='No certificates recorded yet. Use "Add another certificate" to start.'
          onSave={save}
        />
      )}
    </div>
  )
}

export function ReviewsTab({ employee, canManageReviews }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['hr-reviews', employee.name],
    queryFn: () => hrApi.reviews.query({ employee: employee.name, limit: 100 }),
  })
  const reviews = data?.data ?? []

  if (isLoading) return <Loader label="Loading reviews…" />

  if (!reviews.length) {
    return (
      <Card>
        <CardHeader title="Performance Reviews" />
        <EmptyState
          icon={FiStar}
          title="No performance reviews recorded"
          description="Performance reviews are managed in the HR → Performance module, which is the single source of truth for review cycles."
          action={canManageReviews && (
            <Button icon={FiTrendingUp} onClick={() => navigate('/hr/performance')}>
              Open HR → Performance
            </Button>
          )}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {reviews.map((r, i) => (
        <Card key={rowKey(r, i)}>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold">{r.period || '—'}</p>
              <p className="text-sm text-muted">Reviewed by {r.reviewer || '—'}</p>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, n) => (
                <FiStar key={n} className={`h-4 w-4 ${n < Math.round(r.rating || 0) ? 'fill-warning text-warning' : 'text-muted'}`} />
              ))}
              <span className="ml-1 text-sm font-medium">{Number(r.rating || 0).toFixed(1)}</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{r.status}</Badge>
            <Badge tone="accent">{r.goalCompletion ?? 0}% goals</Badge>
          </div>
          {r.comments && <p className="mt-2 text-sm text-muted">{r.comments}</p>}
          {r.strengths && <p className="mt-1 text-sm text-muted"><span className="font-medium text-app">Strengths:</span> {r.strengths}</p>}
          {r.areasForImprovement && <p className="mt-1 text-sm text-muted"><span className="font-medium text-app">Areas for improvement:</span> {r.areasForImprovement}</p>}
        </Card>
      ))}
    </div>
  )
}

// ---------- Attendance & Leave history ----------
export function AttendanceTab({ employee }) {
  const navigate = useNavigate()
  const rows = asArray(employee.attendanceHistory)

  const columns = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'checkIn', header: 'Check In' }, { key: 'checkOut', header: 'Check Out' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours}h` },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]

  return (
    <Card>
      <CardHeader title="Attendance History" subtitle="Recent records" />
      {rows.length ? (
        <DataTable columns={columns} data={rows} />
      ) : (
        <EmptyState
          icon={FiClock}
          title="No attendance records on this profile"
          description="Daily attendance is recorded in the Attendance module and reported there per day and per department."
          action={<Button icon={FiBarChart2} onClick={() => navigate('/attendance/reports')}>Open Attendance Reports</Button>}
        />
      )}
    </Card>
  )
}

export function LeaveTab({ employee }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['leave-requests', 'employee', employee.name],
    queryFn: () => leaveApi.query({ employee: employee.name, limit: 100 }),
    enabled: Boolean(employee.name),
  })

  const rows = asArray(data?.data)
  const columns = [
    { key: 'type', header: 'Type' },
    { key: 'from', header: 'From', render: (r) => formatDate(r.from) },
    { key: 'to', header: 'To', render: (r) => formatDate(r.to) },
    { key: 'days', header: 'Days' },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]

  return (
    <Card>
      <CardHeader title="Leave History" subtitle="Requests raised by this employee" />
      {isLoading ? (
        <Loader label="Loading leave history…" />
      ) : isError ? (
        <EmptyState icon={FiInbox} title="Could not load leave history" description="Please try again." />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r._id || r.id}
          empty="No leave requests recorded for this employee"
        />
      )}
    </Card>
  )
}

// ---------- Emergency Contacts ----------
const EMERGENCY_FIELDS = [
  { key: 'name', label: 'Contact Name', required: true, placeholder: 'e.g. Priya Sharma' },
  { key: 'relation', label: 'Relationship', placeholder: 'e.g. Spouse' },
  { key: 'phone', label: 'Phone', placeholder: '+91 …', wide: true },
]

export function EmergencyTab({ employee, employeeId, canEdit, onEdit }) {
  const contacts = asArray(employee.emergencyContacts)
  const [editing, setEditing] = useState(false)
  const mutation = useEmployeePatch(employeeId, 'Emergency contacts updated')
  const hasPrimary = filled(employee.emergencyContact)

  return (
    <div className="space-y-4">
      {/* The FLAT Employee.emergencyContact captured by the create/edit form. */}
      <Card>
        <CardHeader
          title="Primary Emergency Contact"
          subtitle="Captured on the employee record"
          action={
            <SectionAction
              show={canEdit}
              hasData={hasPrimary}
              onClick={onEdit}
              addLabel="Add Contact"
              editLabel="Edit"
            />
          }
        />
        {hasPrimary ? (
          <p className="flex items-center gap-2 text-sm font-medium"><FiPhone className="h-4 w-4 text-primary" />{employee.emergencyContact}</p>
        ) : (
          <EmptyState
            icon={FiPhone}
            title="No primary emergency contact added"
            description={canEdit
              ? 'The primary emergency contact number is part of the employee record.'
              : 'No primary emergency contact has been recorded.'}
            action={canEdit && <Button icon={FiPlus} onClick={onEdit}>Add Contact</Button>}
          />
        )}
      </Card>

      {/* The RICHER Employee.emergencyContacts[] array. */}
      <Card>
        <CardHeader
          title="Emergency Contacts"
          subtitle={contacts.length ? `${contacts.length} recorded` : undefined}
          action={
            <SectionAction
              show={canEdit}
              hasData={contacts.length > 0}
              onClick={() => setEditing(true)}
              addLabel="Add Emergency Contact"
              editLabel="Edit Contacts"
            />
          }
        />
        {contacts.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {contacts.map((c, i) => (
              <div key={rowKey(c, i)} className="rounded-card border border-app p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={c.name} size={44} />
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-muted">{c.relation || '—'}</p>
                    {c.phone && <p className="mt-1 flex items-center gap-1 text-sm text-primary"><FiPhone className="h-3.5 w-3.5" />{c.phone}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FiUsers}
            title="No emergency contacts added"
            description={canEdit
              ? 'Record the people to contact in an emergency, with their relationship and phone number.'
              : 'No emergency contacts have been recorded for this employee.'}
            action={canEdit && <Button icon={FiPlus} onClick={() => setEditing(true)}>Add Emergency Contact</Button>}
          />
        )}
      </Card>

      {canEdit && (
        <ListEditorModal
          open={editing}
          onClose={() => setEditing(false)}
          title="Emergency Contacts"
          description="Contact name is required; relationship and phone are optional."
          fields={EMERGENCY_FIELDS}
          items={contacts}
          saving={mutation.isPending}
          addLabel="Add another contact"
          emptyHint='No contacts recorded yet. Use "Add another contact" to start.'
          onSave={(rows) =>
            mutation.mutate({ emergencyContacts: rows }, { onSuccess: () => setEditing(false) })}
        />
      )}
    </div>
  )
}

// ---------- Documents (with upload) ----------
const DOC_ICON = { pdf: FiFileText, word: FiFile, excel: FiFile, image: FiImage }
const DOC_TONE = { pdf: 'text-danger', word: 'text-primary', excel: 'text-success', image: 'text-accent' }

export function DocumentsTab({ employee, employeeId, canEdit }) {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const docs = asArray(employee.documents)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['employee', employeeId] })
  }, [qc, employeeId])

  const downloadDoc = useCallback(async (d) => {
    if (!d || !d._id) return
    try {
      const blob = await apiClient.get(employeeApi.documentUrl(employeeId, d._id), { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = d.name || 'document'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch {
      toast.error('Could not open this document')
    }
  }, [employeeId])

  const onDrop = useCallback(async (accepted) => {
    if (!accepted?.length) return
    setUploading(true)
    try {
      for (const file of accepted) {
        await employeeApi.uploadDocument(employeeId, file)
      }
      toast.success(`${accepted.length} document(s) uploaded`)
      refresh()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [employeeId, refresh])

  const { getRootProps, getInputProps, open: openFilePicker, isDragActive } =
    useDropzone({ onDrop, noClick: !canEdit, noKeyboard: !canEdit, disabled: !canEdit })

  const deleteMutation = useMutation({
    mutationFn: (index) =>
      employeeApi.update(employeeId, { documents: docs.filter((_, idx) => idx !== index) }),
    onSuccess: () => { toast.success('Document deleted'); refresh() },
    onError: (err) => toast.error(err?.response?.data?.message || 'Could not delete document'),
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Documents"
          subtitle={docs.length ? `${docs.length} file(s) attached` : undefined}
          action={canEdit && (
            <Button size="sm" icon={FiUploadCloud} onClick={openFilePicker} loading={uploading}>
              Upload Document
            </Button>
          )}
        />

        {canEdit && (
          <div {...getRootProps()}
            className={`mb-4 flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed p-8 text-center transition ${
              isDragActive ? 'border-primary bg-primary/5' : 'border-app hover:border-primary/60'}`}>
            <input {...getInputProps()} />
            <FiUploadCloud className="mb-2 h-8 w-8 text-primary" />
            <p className="text-sm font-medium">{uploading ? 'Uploading…' : isDragActive ? 'Drop files…' : 'Drag & drop documents, or click to browse'}</p>
            <p className="text-xs text-muted">PDF, Word, Excel or images · max 10 MB</p>
          </div>
        )}

        {docs.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((d, i) => {
              const Icon = DOC_ICON[d.type] || FiFile
              const isPrivate = Boolean(d.diskName)
              const href = isPrivate ? null : fileUrl(d.url)
              const id = rowKey(d, i)
              return (
                <motion.div key={id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}>
                  <div className="group flex items-center gap-3 rounded-card border border-app p-4 transition hover:shadow-card">
                    <Icon className={`h-8 w-8 flex-none ${DOC_TONE[d.type] || 'text-muted'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={d.name}>{d.name}</p>
                      <p className="text-xs text-muted">{d.category || 'General'} · {formatBytes(d.size)}</p>
                    </div>
                    <div className="flex gap-1 opacity-60 transition group-hover:opacity-100">
                      {href && (
                        <>
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg p-1.5 hover:bg-primary/10 hover:text-primary"
                            aria-label={`Preview ${d.name}`}
                            title="Preview"
                          >
                            <FiEye className="h-4 w-4" />
                          </a>
                          <a
                            href={href}
                            download={d.name}
                            className="rounded-lg p-1.5 hover:bg-primary/10 hover:text-primary"
                            aria-label={`Download ${d.name}`}
                            title="Download"
                          >
                            <FiDownload className="h-4 w-4" />
                          </a>
                        </>
                      )}
                      {isPrivate && (
                        <button
                          onClick={() => downloadDoc(d)}
                          className="rounded-lg p-1.5 hover:bg-primary/10 hover:text-primary"
                          aria-label={`Download ${d.name}`}
                          title="Download"
                        >
                          <FiDownload className="h-4 w-4" />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => deleteMutation.mutate(i)}
                          disabled={deleteMutation.isPending}
                          className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                          aria-label={`Delete ${d.name}`}
                          title="Delete"
                        >
                          <FiTrash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={FiFileText}
            title="No documents uploaded"
            description={canEdit
              ? 'Upload offer letters, ID proofs, certificates or any other employee document.'
              : 'No documents have been attached to this employee.'}
            action={canEdit && <Button icon={FiUploadCloud} onClick={openFilePicker}>Upload Document</Button>}
          />
        )}
      </Card>
    </div>
  )
}
