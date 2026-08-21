import {
  FiMail, FiBriefcase, FiCalendar, FiHash, FiShield, FiUser,
  FiExternalLink, FiPhone, FiMapPin, FiHeart, FiClock, FiUserPlus, FiUserCheck,
  FiEdit2, FiUpload, FiDownload, FiTrash2, FiFile, FiX, FiPlus,
} from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import { useMySalary } from '@/features/salary/salaryDocument'
import { SalaryTab } from '@/features/employees/detailTabs'
import { PageHeader, Card, CardHeader, Badge, Tabs, Loader, EmptyState, Button, Input, Select, Textarea, Modal } from '@/components/ui'
import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { employeeApi } from '@/api/services'
import { ChangePasswordCard } from '@/features/profile/ChangePasswordCard'
import { AvatarUploader } from '@/features/profile/AvatarUploader'
import { formatDate, cn } from '@/utils'
import toast from 'react-hot-toast'
import apiClient from '@/api/client'

const shown = (value) => (value === undefined || value === null || value === '' ? null : value)

export default function Profile() {
  const { user } = useAuth()
  const hasEmployeeRecord = user?.role !== ROLES.ADMIN
  const queryClient = useQueryClient()
  const { data: empData } = useQuery({
    queryKey: ['my-employee-profile'],
    queryFn: employeeApi.myProfile,
    retry: false,
    enabled: hasEmployeeRecord,
  })
  const emp = empData || {}
  const [tab, setTab] = useState('overview')
  const [editOpen, setEditOpen] = useState(false)
  // Employees AND Managers may maintain their own Education/Bank details (the
  // "My Profile self-service" surface); document uploads stay Employee-only.
  const canSelfEdit = user?.role === ROLES.EMPLOYEE || user?.role === ROLES.MANAGER
  const isEmployee = user?.role === ROLES.EMPLOYEE

  const showSalary = user?.role !== ROLES.ADMIN
  const name = shown(emp.name || user?.name)
  const email = shown(emp.email || user?.email)
  const phone = shown(emp.phone || user?.phone)
  const designation = shown(emp.designation || user?.designation)
  const department = shown(emp.department || user?.department)
  const empCode = shown(emp.empCode || user?.empCode)
  const role = shown(user?.role)
  const gender = shown(emp.gender ?? user?.gender)
  const dob = shown(emp.dob)
  const address = shown(emp.address)
  const bloodGroup = shown(emp.bloodGroup)
  const maritalStatus = shown(emp.maritalStatus)
  const employmentType = shown(emp.employmentType || user?.employmentType)
  const employmentStatus = shown(emp.status)
  const joined = emp.joiningDate || user?.joiningDate || user?.createdAt
  const reportingManager = shown(emp.reportingTo || user?.reportingManager)
  const shift = shown(emp.shift || user?.shift)
  const emergencyContacts = Array.isArray(emp.emergencyContacts) && emp.emergencyContacts.length
    ? emp.emergencyContacts
    : null
  const flatEmergencyContact = !emergencyContacts ? shown(emp.emergencyContact) : null
  const profileDocuments = Array.isArray(emp.documents) ? emp.documents : []

  const personal = [
    { icon: FiMail, label: 'Email', value: email },
    { icon: FiPhone, label: 'Phone', value: phone },
    { icon: FiCalendar, label: 'Date of Birth', value: dob ? formatDate(dob) : null },
    { icon: FiUser, label: 'Gender', value: gender },
    { icon: FiHeart, label: 'Blood Group', value: bloodGroup },
    { icon: FiUserCheck, label: 'Marital Status', value: maritalStatus },
    { icon: FiMapPin, label: 'Address', value: address },
  ].filter((i) => i.value)

  const employment = [
    { icon: FiHash, label: 'Employee ID', value: empCode },
    { icon: FiBriefcase, label: 'Department', value: department },
    { icon: FiUser, label: 'Designation', value: designation },
    { icon: FiShield, label: 'Role', value: role },
    { icon: FiUserCheck, label: 'Employee Type', value: employmentType },
    { icon: FiUserCheck, label: 'Employment Status', value: employmentStatus },
    { icon: FiCalendar, label: 'Joining Date', value: joined ? formatDate(joined) : null },
    { icon: FiUserPlus, label: 'Reporting Manager', value: reportingManager },
    { icon: FiClock, label: 'Shift', value: shift },
  ].filter((i) => i.value)

  const infoCard = (title, rows) => (
    <Card>
      <CardHeader title={title} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((i) => (
          <div key={i.label} className="flex items-center gap-3 rounded-xl border border-app p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><i.icon /></div>
            <div className="min-w-0"><p className="text-xs text-muted">{i.label}</p><p className="truncate text-sm font-medium">{i.value}</p></div>
          </div>
        ))}
      </div>
    </Card>
  )

  const openDocument = useCallback(async (docId, name) => {
    try {
      const blob = await apiClient.get(employeeApi.selfDocumentUrl(docId), { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name || 'document'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch {
      toast.error('Could not open this document')
    }
  }, [])

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your personal and work information." />

      {canSelfEdit && (
        <div className="mb-4 flex justify-end">
          <Button icon={FiEdit2} onClick={() => setEditOpen(true)}>Edit Profile</Button>
        </div>
      )}

      <Card className="mb-4 overflow-hidden p-0">
        <div className="flex flex-col gap-4 bg-gradient-to-r from-primary to-accent p-5 sm:flex-row sm:items-center">
          <AvatarUploader name={name} size={88} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white">{name}</h2>
            <p className="text-sm text-white/85">
              {designation || (user?.role === ROLES.ADMIN ? 'Administrator' : 'Employee')} · <Badge tone="primary">{role}</Badge>
            </p>
            {empCode && <p className="mt-1 text-xs font-medium text-white/70">Employee ID: {empCode}</p>}
          </div>
        </div>
      </Card>

      <Tabs className="mb-4" value={tab} onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'security', label: 'Security' },
          ...(showSalary ? [{ key: 'salary', label: 'Salary' }] : []),
        ]} />

      {tab === 'overview' && (
        <div className="space-y-4">
          {infoCard('Personal Information', personal)}
          {infoCard('Employment Information', employment)}
          <EditableEducationCard
            education={Array.isArray(emp.education) ? emp.education : []}
            canEdit={canSelfEdit}
            invalidate={() => queryClient.invalidateQueries({ queryKey: ['my-employee-profile'] })}
          />
          <EditableBankCard
            bank={emp.bank || null}
            canEdit={canSelfEdit}
            invalidate={() => queryClient.invalidateQueries({ queryKey: ['my-employee-profile'] })}
          />

          {(emergencyContacts || flatEmergencyContact) && (
            <Card>
              <CardHeader title="Emergency Contact" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {emergencyContacts ? emergencyContacts.map((c, idx) => (
                  <div key={`${c.name}-${idx}`} className="flex items-center gap-3 rounded-xl border border-app p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FiUser /></div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{shown(c.name) || 'Contact'}</p>
                      {shown(c.relation) && <p className="text-xs text-muted">Relationship: {c.relation}</p>}
                      {shown(c.phone) && <p className="text-xs text-muted">Phone: {c.phone}</p>}
                    </div>
                  </div>
                )) : (
                  <div className="flex items-center gap-3 rounded-xl border border-app p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FiUser /></div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{flatEmergencyContact}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {isEmployee && (
            <DocumentsSection
              documents={profileDocuments}
              onOpen={openDocument}
              invalidate={() => queryClient.invalidateQueries({ queryKey: ['my-employee-profile'] })}
            />
          )}

          {!personal.length && !employment.length && (
            <Card>
              <EmptyState title="No profile information yet" description="Your profile details are not set up yet. Please contact HR." />
            </Card>
          )}
        </div>
      )}

      {tab === 'security' && <ChangePasswordCard />}

      {tab === 'salary' && showSalary && <SalaryPanel />}

      {canSelfEdit && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          emp={emp}
          invalidate={() => queryClient.invalidateQueries({ queryKey: ['my-employee-profile'] })}
        />
      )}
    </div>
  )
}

// EDUCATION + BANK self-service (Employee & Manager): these are the only
// professional fields a profile owner maintains themselves. Both cards render
// read-only for everyone, and an [Edit]/[Save]/[Cancel] flow appears for
// Employee and Manager accounts. The save payload goes through the server's
// updateSelf allowlist (education/bank), which sanitises the shape — rows
// without qualification + institution are dropped, bank is reduced to its
// three known keys.
function EditableEducationCard({ education, canEdit, invalidate }) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState(null)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setRows(education.map((e) => ({
      qualification: e.qualification ?? '',
      institution: e.institution ?? '',
      fieldOfStudy: e.fieldOfStudy ?? '',
      startYear: e.startYear ?? '',
      endYear: e.endYear ?? '',
      grade: e.grade ?? '',
    })))
    setEditing(true)
  }

  const save = async () => {
    if (!rows) return
    const kept = rows.filter((r) => r.qualification.trim() && r.institution.trim())
    if (kept.length !== rows.length) {
      toast.error('Qualification and institution are required for each entry')
      return
    }
    setSaving(true)
    try {
      await employeeApi.updateSelf({ education: kept })
      toast.success('Education updated')
      invalidate?.()
      setEditing(false)
    } catch {
      // apiClient already toasts the server message
    } finally {
      setSaving(false)
    }
  }

  const setRow = (idx, key, value) => setRows((r) => r && r.map((row, i) => (i === idx ? { ...row, [key]: value } : row)))

  return (
    <Card>
      <CardHeader
        title="Education"
        action={canEdit && !editing && (
          <Button variant="ghost" icon={FiEdit2} onClick={startEdit}>Edit</Button>
        )}
      />
      {!editing ? (
        education.length === 0 ? (
          <p className="text-sm text-muted">No education details recorded.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {education.map((ed, idx) => (
              <div key={`${ed.qualification}-${idx}`} className="rounded-xl border border-app p-3">
                <p className="truncate text-sm font-medium">{shown(ed.qualification) || 'Qualification'}</p>
                {shown(ed.institution) && <p className="mt-0.5 truncate text-xs text-muted">Institution: {ed.institution}</p>}
                {shown(ed.fieldOfStudy) && <p className="truncate text-xs text-muted">Field of study: {ed.fieldOfStudy}</p>}
                {ed.startYear && (
                  <p className="text-xs text-muted">Years: {ed.startYear}{ed.endYear ? ` \u2013 ${ed.endYear}` : ''}</p>
                )}
                {shown(ed.grade) && <p className="text-xs text-muted">Grade: {ed.grade}</p>}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-4">
          {rows.map((r, idx) => (
            <div key={idx} className="rounded-xl border border-app p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-muted">Entry {idx + 1}</p>
                <button
                  type="button"
                  onClick={() => setRows((x) => x && x.filter((_, i) => i !== idx))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-app text-muted transition hover:border-danger hover:text-danger"
                  aria-label="Remove entry"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Qualification" value={r.qualification} onChange={(e) => setRow(idx, 'qualification', e.target.value)} placeholder="e.g. B.E. Computer Science" />
                <Input label="Institution" value={r.institution} onChange={(e) => setRow(idx, 'institution', e.target.value)} placeholder="e.g. Anna University" />
                <Input label="Field of Study" value={r.fieldOfStudy} onChange={(e) => setRow(idx, 'fieldOfStudy', e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Start Year" value={r.startYear} onChange={(e) => setRow(idx, 'startYear', e.target.value)} placeholder="2019" />
                  <Input label="End Year" value={r.endYear} onChange={(e) => setRow(idx, 'endYear', e.target.value)} placeholder="2023" />
                </div>
                <Input label="Grade" value={r.grade} onChange={(e) => setRow(idx, 'grade', e.target.value)} placeholder="e.g. 8.5 CGPA" />
              </div>
            </div>
          ))}
          <Button variant="ghost" icon={FiPlus} onClick={() => setRows((r) => r && [...r, { qualification: '', institution: '', fieldOfStudy: '', startYear: '', endYear: '', grade: '' }])}>
            Add Entry
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={save} loading={saving}>Save</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function EditableBankCard({ bank, canEdit, invalidate }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const startEdit = () => {
    setForm({
      name: bank?.name ?? '',
      account: bank?.account ?? '',
      ifsc: bank?.ifsc ?? '',
    })
    setEditing(true)
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      await employeeApi.updateSelf({ bank: form })
      toast.success('Bank details updated')
      invalidate?.()
      setEditing(false)
    } catch {
      // apiClient already toasts the server message
    } finally {
      setSaving(false)
    }
  }

  const hasBank = shown(bank?.name) || shown(bank?.account) || shown(bank?.ifsc)

  return (
    <Card>
      <CardHeader
        title="Bank Details"
        action={canEdit && !editing && (
          <Button variant="ghost" icon={FiEdit2} onClick={startEdit}>Edit</Button>
        )}
      />
      {!editing ? (
        hasBank ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-center gap-3 rounded-xl border border-app p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FiUser /></div>
              <div className="min-w-0"><p className="text-xs text-muted">Bank Name</p><p className="truncate text-sm font-medium">{bank.name}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-app p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FiHash /></div>
              <div className="min-w-0"><p className="text-xs text-muted">Account Number</p><p className="truncate text-sm font-medium">{bank.account}</p></div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-app p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><FiHash /></div>
              <div className="min-w-0"><p className="text-xs text-muted">IFSC Code</p><p className="truncate text-sm font-medium">{bank.ifsc}</p></div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No bank details recorded.</p>
        )
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Bank Name" value={form.name} onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })} placeholder="e.g. HDFC Bank" />
            <Input label="Account Number" value={form.account} onChange={(e) => setForm((f) => f && { ...f, account: e.target.value })} />
            <Input label="IFSC Code" value={form.ifsc} onChange={(e) => setForm((f) => f && { ...f, ifsc: e.target.value })} placeholder="e.g. HDFC0001234" />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={save} loading={saving}>Save</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3) — self-edit of personal fields
// ONLY. The editable set mirrors the server's SELF_EDITABLE_FIELDS allowlist
// (phone, address, dob, bloodGroup, maritalStatus, emergencyContact(s)): the
// form never offers, and the server never accepts, anything that determines
// employment (salary, department, designation, reporting, status, role).
// Education + Bank are edited through their own sections below (shared by
// Employee and Manager).
function EditProfileModal({ open, onClose, emp, invalidate }) {
  const { user, patchUser } = useAuth()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  // Preload from the employee record the first time the modal opens (the record
  // is re-fetched by react-query anyway after a save, so we never need to
  // re-seed while open).
  if (open && form === null) {
    setForm({
      phone: emp.phone ?? user?.phone ?? '',
      address: emp.address ?? '',
      dob: emp.dob ? String(emp.dob).slice(0, 10) : '',
      bloodGroup: emp.bloodGroup ?? '',
      maritalStatus: emp.maritalStatus ?? '',
      emergencyContacts: Array.isArray(emp.emergencyContacts) && emp.emergencyContacts.length
        ? emp.emergencyContacts.map((c) => ({ name: c.name ?? '', relation: c.relation ?? '', phone: c.phone ?? '' }))
        : emp.emergencyContact
          ? [{ name: emp.emergencyContact, relation: '', phone: '' }]
          : [{ name: '', relation: '', phone: '' }],
    })
  }

  const set = (key, value) => setForm((f) => (f ? { ...f, [key]: value } : f))
  const setContact = (idx, key, value) => setForm((f) => f && {
    ...f,
    emergencyContacts: f.emergencyContacts.map((c, i) => (i === idx ? { ...c, [key]: value } : c)),
  })

  const submit = async () => {
    if (!form) return
    setSaving(true)
    const contacts = form.emergencyContacts.filter((c) => c.name?.trim() || c.phone?.trim())
    try {
      const updated = await employeeApi.updateSelf({
        phone: form.phone.trim(),
        address: form.address.trim(),
        dob: form.dob || null,
        bloodGroup: form.bloodGroup,
        maritalStatus: form.maritalStatus,
        emergencyContact: contacts.length === 1 ? contacts[0].name : (contacts.length ? undefined : null),
        emergencyContacts: contacts.length > 1 ? contacts : (contacts.length ? undefined : null),
      })
      // Keep the Redux auth copy in sync so the header/profile fallbacks agree.
      if (updated) {
        patchUser({ phone: updated.phone ?? form.phone.trim() })
      }
      toast.success('Profile updated')
      invalidate?.()
      onClose()
    } catch {
      // apiClient already toasts the server message
    } finally {
      setSaving(false)
    }
  }

  const setValue = (e) => set(e.target.name, e.target.value)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Profile"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
        </>
      }
    >
      {form && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Phone" name="phone" value={form.phone} onChange={setValue} icon={FiPhone} />
            <Select label="Blood Group" name="bloodGroup" value={form.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)} options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']} />
            <Input label="Date of Birth" name="dob" type="date" value={form.dob} onChange={setValue} icon={FiCalendar} />
            <Select label="Marital Status" name="maritalStatus" value={form.maritalStatus} onChange={(e) => set('maritalStatus', e.target.value)} options={['Single', 'Married', 'Other']} />
          </div>
          <Textarea label="Address" name="address" value={form.address} onChange={setValue} placeholder="Current residential address" />

          <div>
            <p className="mb-2 text-sm font-medium text-muted">Emergency Contacts</p>
            {form.emergencyContacts.map((c, idx) => (
              <div key={idx} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input placeholder="Name" value={c.name} onChange={(e) => setContact(idx, 'name', e.target.value)} />
                <Input placeholder="Relationship" value={c.relation} onChange={(e) => setContact(idx, 'relation', e.target.value)} />
                <Input placeholder="Phone" value={c.phone} onChange={(e) => setContact(idx, 'phone', e.target.value)} />
                <button
                  type="button"
                  onClick={() => setForm((f) => f && { ...f, emergencyContacts: f.emergencyContacts.filter((_, i) => i !== idx) })}
                  className="flex h-10 w-10 items-center justify-center self-center rounded-xl border border-app text-muted transition hover:border-danger hover:text-danger"
                  aria-label="Remove contact"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              icon={FiPlus}
              onClick={() => setForm((f) => f && { ...f, emergencyContacts: [...f.emergencyContacts, { name: '', relation: '', phone: '' }] })}
            >
              Add Contact
            </Button>
          </div>

          <p className="text-xs text-muted">
            Employment details (department, designation, salary, reporting) are managed by HR and cannot be changed here.
            Education and Bank details are edited from their own sections on this page.
          </p>
        </div>
      )}
    </Modal>
  )
}

// PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3) — the logged-in Employee's own
// private documents (ID / address proof, certificates…). Uploaded to the
// private profile-uploads/ store and served only through the authorized
// /employees/me/documents routes — never through a public URL.
function DocumentsSection({ documents, onOpen, invalidate }) {
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(null)

  const upload = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      await employeeApi.uploadSelfDocument(file, 'General')
      toast.success('Document uploaded')
      invalidate?.()
    } catch {
      // apiClient already toasts the server message
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"?`)) return
    setDeleting(String(doc._id))
    try {
      await employeeApi.deleteSelfDocument(doc._id)
      toast.success('Document deleted')
      invalidate?.()
    } catch {
      // apiClient already toasts the server message
    } finally {
      setDeleting(null)
    }
  }

  const hasDocs = documents.length > 0

  return (
    <Card>
      <CardHeader
        title="My Documents"
        action={
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button variant="ghost" icon={FiUpload} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload Document'}
            </Button>
          </div>
        }
      />
      {!hasDocs ? (
        <EmptyState
          title="No documents yet"
          description="Upload identity or address proof, certificates, or other documents you want on file."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => (
            <div key={String(d._id)} className="flex items-center gap-3 rounded-xl border border-app p-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FiFile className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={d.name}>{d.name}</p>
                <p className="text-xs text-muted">
                  {shown(d.category) || 'General'}
                  {d.size ? ` · ${(d.size / 1024).toFixed(1)} KB` : ''}
                </p>
              </div>
              <div className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  onClick={() => onOpen(String(d._id), d.name)}
                  className="rounded-lg p-2 text-muted transition hover:bg-primary/10 hover:text-primary"
                  aria-label={`Download ${d.name}`}
                >
                  <FiDownload className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(d)}
                  disabled={deleting === String(d._id)}
                  className="rounded-lg p-2 text-muted transition hover:bg-danger/10 hover:text-danger"
                  aria-label={`Delete ${d.name}`}
                >
                  <FiTrash2 className={cn('h-4 w-4', deleting === String(d._id) && 'animate-pulse')} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function SalaryPanel() {
  const navigate = useNavigate()
  const { data, isLoading } = useMySalary()

  const current = data?.current
  const identity = data?.identity

  if (isLoading) return <Loader label="Loading your salary…" />

  if (!current) {
    return (
      <Card>
        <EmptyState
          title="No salary information found"
          description="Your salary structure has not been set up yet. Please contact HR."
        />
      </Card>
    )
  }

  const employeeView = {
    salary: {
      basic: current.basic,
      pf: current.pf,
      esi: current.esi,
      net: current.net_monthly_salary ?? current.net,
      ctc: identity?.ctc || 0,
      monthly: identity?.monthly || 0,
    },
    bank: identity?.bank || null,
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button icon={FiExternalLink} onClick={() => navigate('/profile/salary')}>Open Full Salary</Button>
      </div>
      <SalaryTab employee={employeeView} />
    </div>
  )
}
