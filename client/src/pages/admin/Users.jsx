import { useState, useEffect, useMemo, useCallback } from 'react'
import { useViewState } from '@/hooks/useViewState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FiPlus, FiEdit2, FiTrash2, FiKey, FiShield, FiRefreshCw, FiCheckCircle,
  FiEye, FiColumns, FiCopy, FiUserCheck, FiUserX, FiLock, FiXCircle,
} from 'react-icons/fi'
import {
  PageHeader, Card, Button, DataTable, Pagination, SearchInput, Select,
  Modal, Input, Textarea, Badge, Avatar, ConfirmDialog, Dropdown, DropdownItem, MultiSelect,
} from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { ProfileImageField } from '@/features/employees/ProfileImageField'
import { EMPLOYMENT_TYPES, WORK_LOCATIONS } from '@/features/employees/constants'
import { useDebounce } from '@/hooks/useDebounce'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/features/notifications/NotificationContext'
import { adminApi } from '@/api/adminApi'
import { hrApi } from '@/api/services'
// Phase 6.3 (Task 11): `projectApi`, `PROJECT_STATUSES` and `PRIORITIES` imports
// removed. They existed only to serve the duplicate project form deleted in
// Task 1 and now have zero references in this file.
import { ALL_ROLES } from '@/constants'
import { USER_STATUSES, USER_DEPARTMENTS, ADMIN_WRITE_ROLES } from '@/features/admin/constants'
import { validatePassword } from '@/features/admin/password'
import { PasswordField } from '@/features/admin/PasswordField'
import { PasswordStrength } from '@/features/admin/PasswordStrength'
import { formatDate, formatDateTime, cn } from '@/utils'

const STATUS_TONE = {
  Active: 'success', Inactive: 'default', Suspended: 'warning', Pending: 'primary', Blocked: 'danger',
}

const emptyForm = {
  name: '', email: '', phone: '', department: '', designation: '', employeeId: '',
  role: 'Employee', status: 'Active',
  // Phase 5 (Task 1): empty means "not chosen yet" and fails validation on
  // create. It is NOT defaulted to Male/Female, because guessing a person's
  // gender is exactly the bug Task 2's leave filtering depends on avoiding.
  gender: '',
  password: '', confirmPassword: '',
  employmentType: 'Full-time', workLocation: '', joiningDate: '',
  reportingManager: '', shift: '',
  experienceYears: '', emergencyContact: '', salaryCtc: '',
  // Phase 6.9 (TASK 10 + TASK 11): `accountManager` and `clientStatus` removed
  // from the blank form - both fields are gone from the UI and the API.
  clientMode: 'new', clientId: '', clientCompany: '',
  // Phase 5.9 (Task 1): client commercial / profile fields captured directly on
  // the unified Create User form, so creating a Client no longer needs a second
  // page. Every one of these already exists on the Client Mongo model except
  // `projectType`, which is added additively in models/clientModels.js.
  address: '', gst: '', advancePayment: '', monthlyDue: '', budget: '', projectType: '',
  // Phase 5.9 (Task 1): Manager-only "Reporting Team" (additive User field).
  reportingTeam: [],
  // Phase 5.7 (Task 4): admin-typed employee code. Blank means "let the server
  // allocate the next sequential code" - it is never silently overwritten.
  empCode: '',
  avatar: '',
  // Phase 6.3 (TASK 1): the nine `proj*` fields that used to live here
  // (projName / projCode / projDescription / projLead / projPriority /
  // projStatus / projBudget / projStartDate / projDeadline) are DELETED. They
  // backed a second, weaker project-creation form embedded in this page. All
  // project creation now goes through the single shared <ProjectModal/>.
  //
  // Phase 6.3 (TASK 2): project members assigned at client-creation time.
  projectMembers: [],
  // Phase 6.4 (TASK 2): project-level fields captured at client creation.
  projectName: ''  , projectCode: '', projectDescription: '',
}

// Roles that own an Employee HR profile — the extended HR fields only show for
// these. Phase 5: the 'Inventory' role was retired and merged into HR.
const STAFF_FORM_ROLES = ['Employee', 'HR', 'Manager']

// Phase 5 (Task 1): gender options offered in the form. Mirrors GENDERS in
// server/src/models/User.js — the server rejects anything outside this set.
const GENDER_OPTIONS = ['Male', 'Female']

// Shift options offered for staff roles (role-driven field).
const SHIFT_OPTIONS = ['General (9–6)', 'Morning (6–3)', 'Evening (2–11)', 'Night (10–7)', 'Flexible']

// Phase 5.9 (Task 1) — optional project type offered for a new Client.
const PROJECT_TYPES = ['Web Development', 'Mobile App', 'UI/UX Design', 'Digital Marketing', 'Maintenance', 'Consulting', 'Other']

// ---------------------------------------------------------------------------
// Phase 5.9 (Task 1) — ROLE-BASED FIELD VISIBILITY MAP
//
// ROOT CAUSE of the "every field for every role" form: visibility was driven by
// just two coarse booleans (`isClient` and `isStaff`). Name / Email / Phone /
// Employee ID / Department / Designation rendered UNCONDITIONALLY, so an Admin
// was shown Department, Designation and Employee ID (none of which apply to an
// oversight account) and a Client was shown Employee ID (merely `disabled`)
// plus Department and Designation. There was no per-role description of the
// form anywhere in the codebase.
//
// This map is now the SINGLE source of truth. Each role declares which field
// GROUPS it owns; the JSX reads only from here, so adding or retiring a role
// never again means hunting through render conditions.
//   hr               → Employee ID, Department, Designation, Joining Date,
//                      Salary (CTC), Employment Type, Work Location, Shift,
//                      Experience, Emergency Contact, Employee Code
//   reportingManager → Employee only
//   reportingTeam    → Manager only
//   client           → Company, Client ID, Address, GST, Advance Payment,
//                      Monthly Due, Project Type
//   gender           → every role that owns an Employee HR profile. Clients are
//                      external portal accounts and the SERVER already refuses
//                      to store gender for them (userController.assertGender),
//                      so showing the field would be a guaranteed dead input.
const ROLE_FIELDS = {
  Admin: { hr: false, client: false, gender: true, reportingManager: false, reportingTeam: false },
  HR: { hr: true, client: false, gender: true, reportingManager: false, reportingTeam: false },
  Manager: { hr: true, client: false, gender: true, reportingManager: false, reportingTeam: true },
  Employee: { hr: true, client: false, gender: true, reportingManager: true, reportingTeam: false },
  Client: { hr: false, client: true, gender: false, reportingManager: false, reportingTeam: false },
}

// Full set of toggleable columns. Order = display order.
const MASTER_COLUMNS = [
  {
    key: 'name', header: 'User', sortable: true, sortKey: 'name',
    render: (r) => (
      <div className="flex items-center gap-3">
        <Avatar name={r.name} src={r.avatar} size={36} />
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          <p className="truncate text-xs text-muted">{r.email}</p>
        </div>
      </div>
    ),
  },
  {
    key: 'employeeId', header: 'ID / Code', sortable: true, sortKey: 'employeeId',
    render: (r) => {
      const code = r.employeeId || r.clientCode
      return code ? <span className="font-mono text-xs">{code}</span> : <span className="text-muted">—</span>
    },
  },
  {
    key: 'role', header: 'Role', sortable: true, sortKey: 'role',
    render: (r) => (
      <span className="inline-flex items-center gap-1"><FiShield className="text-muted" aria-hidden="true" />{r.role}</span>
    ),
  },
  {
    key: 'department', header: 'Department', sortable: true, sortKey: 'department',
    render: (r) => r.department || <span className="text-muted">—</span>,
  },
  {
    key: 'designation', header: 'Designation', sortable: true, sortKey: 'designation',
    render: (r) => r.designation || <span className="text-muted">—</span>,
  },
  {
    key: 'status', header: 'Status', sortable: true, sortKey: 'status',
    render: (r) => <Badge tone={STATUS_TONE[r.status] || 'default'}>{r.status}</Badge>,
  },
  {
    key: 'lastLogin', header: 'Last Login', sortable: true, sortKey: 'lastLogin',
    render: (r) => <span className="text-muted">{r.lastLogin ? formatDateTime(r.lastLogin) : 'Never'}</span>,
  },
  {
    key: 'createdAt', header: 'Created', sortable: true, sortKey: 'createdAt',
    render: (r) => <span className="text-muted">{formatDate(r.createdAt)}</span>,
  },
]

const exportColumns = [
  { header: 'Name', accessor: 'name' },
  { header: 'Email', accessor: 'email' },
  { header: 'ID / Code', accessor: (r) => r.employeeId || r.clientCode || '' },
  { header: 'Role', accessor: 'role' },
  { header: 'Department', accessor: 'department' },
  { header: 'Designation', accessor: 'designation' },
  { header: 'Status', accessor: 'status' },
  { header: 'Last Login', accessor: (r) => r.lastLogin || '' },
  { header: 'Created', accessor: (r) => r.createdAt || '' },
]

// ---------------------------------------------------------------------------
// Profile image uploader is shared with the Employee form
// (see features/employees/ProfileImageField).
// ---------------------------------------------------------------------------

export default function Users() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const { notify } = useNotifications()
  const canWrite = hasRole(ADMIN_WRITE_ROLES)
  const [searchParams, setSearchParams] = useSearchParams()
  const [returnTo, setReturnTo] = useState(null)
  // Phase 6.3 (Task 1): `withProject` state removed - there is no longer a
  // merged Client+Project mode in this page, because the duplicate project form
  // it toggled has been deleted.

  // Phase 5.7 (Task 7): persist search/filter/sort/page so Back restores the list.
  const [params, , , setParams] = useViewState('params', { search: '', role: '', status: '', department: '', sortBy: 'createdAt', order: 'desc', page: 1, limit: 8 })
  const [modal, setModal] = useState(null) // 'add' | 'edit' | 'reset' | null
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [resetMode, setResetMode] = useState('generate') // 'generate' | 'manual'
  const [resetPw, setResetPw] = useState('')
  const [resetErrors, setResetErrors] = useState({})
  const [resetResult, setResetResult] = useState('') // generated temp password (kept in modal)
  // Selection + column visibility
  const [selected, setSelected] = useState(() => new Set())
  const [selectedRows, setSelectedRows] = useState(() => new Map())
  const [hidden, setHidden] = useState(() => new Set())

  const debounced = useDebounce(params.search)
  const queryParams = { ...params, search: debounced }
  const isClient = form.role === 'Client'
  const isStaff = STAFF_FORM_ROLES.includes(form.role)
  // Phase 5.9 (Task 1): the ONLY thing the form reads to decide visibility.
  const fields = ROLE_FIELDS[form.role] || ROLE_FIELDS.Employee
  // Phase 5.9 (Task 2): live matching indicator. Computed during render (not on
  // submit) so the user gets feedback while typing.
  const passwordsMatch = form.password.length > 0 && form.password === form.confirmPassword

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-users', queryParams],
    queryFn: () => adminApi.users.query(queryParams),
    placeholderData: keepPreviousData,
  })
  const rows = data?.data ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  
  // Task 1: Department and Designation loaded dynamically from MongoDB
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
  const deptOptions = (Array.isArray(deptData) ? deptData : []).map((d) => ({
    value: d.name || d,
    label: d.name || String(d),
  }))
  // Filter designations by selected department; show all when no dept chosen
  const desigOptions = (Array.isArray(desigData) ? desigData : []).filter(
    (d) => !form.department || d.department === form.department
  ).map((d) => ({ value: d.title || d, label: d.title || String(d) }))

const { data: clients = [] } = useQuery({
    queryKey: ['admin-clients', 'all'],
    queryFn: () => adminApi.clients.all(),
    enabled: isClient && modal !== null,
  })

  // Phase 5.9 (Task 1): Manager "Reporting Team" picker. Reuses the EXISTING
  // /users endpoint (adminApi.users.query) rather than adding an API - it is
  // only fetched while a Manager form is actually open.
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['admin-users', 'reporting-team'],
    queryFn: () => adminApi.users.query({ role: 'Employee', limit: 200 }),
    // Phase 6.3 (Task 2): also fetched for the Client form, which now has a
    // Project Members picker backed by this same list.
    enabled: (fields.reportingTeam || fields.client) && modal !== null,
    staleTime: 60_000,
  })
  const teamOptions = (teamData?.data || []).map((u) => ({
    value: u.name,
    label: u.name,
    meta: [u.employeeId, u.department, u.designation].filter(Boolean).join(' \u00b7 '),
  }))

  // Phase 6.5 (TASK 2) ROOT CAUSE: "Reporting Manager" was a free-text Input
  // while every other relationship field (Department, Designation, Reporting
  // Team) already used the shared searchable dropdown — that inconsistency is
  // exactly what Task 2 flags. Fixed by reusing the SAME adminApi.users.query
  // service already powering teamOptions above, just filtered to Manager
  // role, and rendering it through the existing MultiSelect (singleSelect)
  // component instead of a plain text field.
  const { data: managerData, isLoading: managerLoading } = useQuery({
    queryKey: ['admin-users', 'reporting-manager'],
    queryFn: () => adminApi.users.query({ role: 'Manager', limit: 200 }),
    enabled: fields.reportingManager && modal !== null,
    staleTime: 60_000,
  })
  const managerOptions = (managerData?.data || []).map((u) => ({
    value: u.name,
    label: u.name,
    meta: [u.department, u.designation].filter(Boolean).join(' \u00b7 '),
  }))

  // Phase 5.7 (Task 4): the client code is NO LONGER auto-filled here.
  // Previously this effect stamped `cl-<timestamp>` into the field the moment
  // Client mode was selected, the input was readOnly, and the controller
  // regenerated its own code anyway - so an admin could never choose a code and
  // any typed value was discarded. The field is now editable and left blank by
  // default; the server allocates a code only when it receives an empty value.

  const setParam = (patch) => setParams((p) => ({ ...p, ...patch, page: 1 }))
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openAdd = () => { setReturnTo(null); setForm(emptyForm); setErrors({}); setModal('add') }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      ...emptyForm,
      name: r.name, email: r.email, phone: r.phone || '', department: r.department || '',
      designation: r.designation || '', employeeId: r.employeeId || '', role: r.role, status: r.status || 'Active',
      password: '', confirmPassword: '', avatar: r.avatar || '',
      employmentType: r.employmentType || 'Full-time', workLocation: r.workLocation || '',
      reportingManager: r.reportingManager || '', shift: r.shift || '',
      joiningDate: r.joiningDate ? String(r.joiningDate).slice(0, 10) : '',
      experienceYears: r.experienceYears || '', emergencyContact: r.emergencyContact || '',
      salaryCtc: r.salaryCtc || '',
      clientMode: r.clientId ? 'existing' : 'new', clientId: r.clientId || '',
      clientCompany: '',
    })
    setErrors({}); setModal('edit')
  }
  const openReset = (r) => { setEditing(r); setResetMode('generate'); setResetPw(''); setResetErrors({}); setResetResult(''); setModal('reset') }

  const closeReset = () => { setModal(null); setResetResult('') }

  // Deep-link from Employees → Add Employee: open Add User with Role=Employee
  // preselected and remember to return to the Employees directory afterwards.
  useEffect(() => {
    const add = searchParams.get('add')
    if (!add) return
    const role = add === 'employee' ? 'Employee' : (searchParams.get('role') || 'Employee')
    setForm({ ...emptyForm, role })
    setErrors({})
    setModal('add')
    // Phase 5.9 (Tasks 3 & 4): the caller declares where to go back to.
    //   ?add=employee              -> Employees directory (existing behaviour)
    //   ?add=client                -> Clients module (Task 3)
    //   ?returnTo=project          -> back into the Project form (Task 4)
    // An explicit ?returnTo always wins so Task 4 can override Task 3's default.
    // Phase 6.3 (Task 1): ?withProject=1 is no longer honoured - the merged
    // form it opened is gone. A stale bookmark simply opens the normal Add
    // Client form, which is the correct graceful degradation.
    const explicitReturn = searchParams.get('returnTo')
    setReturnTo(explicitReturn || (add === 'employee' ? 'employees' : (add === 'client' ? 'clients' : null)))
    // Phase 6.4 (TASK 3): if ProjectModal sent us here to create a client,
    // restore any project draft it saved so we can bounce back after creation.
    const draft = sessionStorage.getItem('skew_project_draft')
    if (draft) {
      // Draft is kept; ProjectModal will read it on return. Nothing to restore
      // on this form — the draft is for the PROJECT form on the way back.
    }
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  const validate = () => {
    const e = {}
    if (!form.name || form.name.trim().length < 2) e.name = 'Full name is required'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email'
    // Phase 6.3 (Task 1): the `linkingExistingClient` password exemption existed
    // only for the merged Client+Project mode, which is gone. Every create path
    // provisions a login, so a password is once again always required.
    if (modal === 'add') {
      const { valid } = validatePassword(form.password)
      if (!valid) e.password = 'Password must be 8–64 chars with upper, lower, number & special'
      if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match'
    }
    // Phase 5 (Task 1): gender is required for staff accounts, which are the
    // ones that own an Employee HR profile and apply for leave. Clients are
    // external portal accounts with no HR record, so it is not collected.
    //
    // Required on CREATE only. On edit it is merely validated if present, so a
    // legacy user with no gender can still have their status or department
    // changed without being blocked — matching the server-side rule in
    // userController.updateUser.
    if (!isClient && modal === 'add' && !form.gender) e.gender = 'Gender is required'
    if (isClient) {
      if (form.clientMode === 'existing' && !form.clientId) e.clientId = 'Select a client profile to link'
      if (form.clientMode === 'new' && !form.clientCompany.trim()) e.clientCompany = 'Client company is required'
      // Phase 5.9 (Task 1): money fields are free-text inputs so an admin can
      // leave them blank; when filled they must be a non-negative number or the
      // Mongo cast would silently store NaN.
      if (form.advancePayment !== '' && (Number.isNaN(Number(form.advancePayment)) || Number(form.advancePayment) < 0)) {
        e.advancePayment = 'Enter a valid amount'
      }
      if (form.monthlyDue !== '' && (Number.isNaN(Number(form.monthlyDue)) || Number(form.monthlyDue) < 0)) {
        e.monthlyDue = 'Enter a valid amount'
      }
      // Phase 6.16 (TASK 1): Budget follows the exact same validation pattern
      // as Advance Payment / Monthly Due - a free-text number that may be left
      // blank but must be non-negative when filled.
      if (form.budget !== '' && (Number.isNaN(Number(form.budget)) || Number(form.budget) < 0)) {
        e.budget = 'Enter a valid amount'
      }
      // Phase 6.16 (TASK 1) ROOT CAUSE of the "inconsistent" Project Members
      // control: it rendered the same shared <MultiSelect/> as every other
      // picker on this form, but - unlike Members in ProjectModal.jsx and
      // Clients.jsx, which both require at least one member - nothing ever
      // validated it here, so the control looked functional but behaved like
      // an optional field. Adding the same "at least one" rule those two
      // forms already enforce, not a new component.
      if (!form.projectMembers || form.projectMembers.length === 0) {
        e.projectMembers = 'Select at least one project member'
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(), email: form.email.trim(), phone: form.phone,
        role: form.role, status: form.status, avatar: form.avatar || undefined,
      }
      // Phase 5.9 (Task 1): department / designation / employeeId are HR profile
      // fields and are now sent ONLY for roles that actually own them. Before,
      // they were always in the payload, so creating an Admin or a Client wrote
      // empty strings over those columns. They are still ALWAYS sent for the hr
      // roles (including empty strings) so clearing a value keeps working.
      if (fields.hr) {
        payload.department = form.department
        payload.designation = form.designation
        payload.employeeId = form.employeeId
      }
      // Phase 5 (Task 1): send gender for staff accounts. `null` explicitly
      // clears it, which is how an admin can undo a wrong value; `undefined`
      // would be dropped from the JSON body and leave the old value in place.
      if (!isClient) payload.gender = form.gender || null
      // Extended HR fields — only relevant for staff roles that own an Employee profile.
      if (isStaff) {
        payload.employmentType = form.employmentType
        payload.workLocation = form.workLocation
        payload.joiningDate = form.joiningDate || undefined
        payload.reportingManager = form.reportingManager
        payload.shift = form.shift
        payload.experienceYears = form.experienceYears
        payload.emergencyContact = form.emergencyContact
        payload.salaryCtc = form.salaryCtc === '' ? 0 : Number(form.salaryCtc)
        // Phase 5.7 (Task 4): forward the typed employee code. Sent only when
        // non-empty so the server keeps auto-allocating for blank input.
        if (String(form.empCode || '').trim()) payload.empCode = String(form.empCode).trim()
        // Phase 5.9 (Task 1): Manager-only reporting team (additive User field).
        if (fields.reportingTeam) payload.reportingTeam = form.reportingTeam
      }
      if (modal === 'add') {
        payload.password = form.password
        if (isClient) {
          if (form.clientMode === 'existing') payload.clientId = form.clientId
          else {
            payload.clientCompany = form.clientCompany.trim()
            // Phase 6.9 (TASK 10 + TASK 11): `accountManager` and `clientStatus`
            // are no longer sent. The server ignores them now, and not sending
            // them keeps the payload honest about what the form collects.
            // Phase 5.7 (Task 4): honour a typed client code; blank = server-generated.
            if (String(form.clientId || '').trim()) payload.clientCode = String(form.clientId).trim()
            // Phase 5.9 (Task 1 & 3): the full client profile is now captured on
            // this one form, so the separate "Add Client" page is redundant.
            // These map 1:1 onto existing Client schema fields (projectType is
            // added additively in models/clientModels.js).
            payload.address = form.address.trim()
            payload.gst = form.gst.trim()
            payload.projectType = form.projectType
            payload.advancePayment = form.advancePayment === '' ? 0 : Number(form.advancePayment)
            payload.monthlyDue = form.monthlyDue === '' ? 0 : Number(form.monthlyDue)
            // Phase 6.16 (TASK 1): Budget reuses the Client model's existing
            // `budget` field (server/src/models/clientModels.js) - the column
            // already existed, it was simply never collected by this form.
            payload.budget = form.budget === '' ? 0 : Number(form.budget)
            // Phase 6.4 (TASK 2): project details captured at client creation.
            payload.projectName = form.projectName.trim()
            payload.projectCode = form.projectCode.trim()
            payload.projectDescription = form.projectDescription.trim()
          }
          // Phase 6.3 (TASK 2): assigned project members. Sent for BOTH client
          // modes (new profile and linked existing profile) so an admin can
          // staff the engagement at the moment the client is created. Names
          // only - the same `{ name, role }` shape the Project/ClientProject
          // team arrays already use, so no schema translation is needed.
          payload.projectMembers = (form.projectMembers || [])
            .map((n) => String(n).trim())
            .filter(Boolean)
        }
      }
      // Phase 6.3 (TASK 1): the merged Client+Project submit branch that used to
      // sit here (projectApi.createWithClient with the nine proj* fields) has
      // been REMOVED. It was the second project-creation path. Project creation
      // now happens only via the shared <ProjectModal/> on the Projects page,
      // which calls the very same createWithClient endpoint - so no capability
      // and no API surface was lost, only the duplicate form.
      return modal === 'add' ? adminApi.users.create(payload) : adminApi.users.update(editing.id, payload)
    },
    onSuccess: () => {
      const wasAdd = modal === 'add'
      const statusChanged = !wasAdd && editing && editing.status !== form.status
      const roleChanged = !wasAdd && editing && editing.role !== form.role
      const backToEmployees = wasAdd && returnTo === 'employees'
      if (wasAdd) notify({ type: 'admin', title: 'User created', body: `${form.name.trim()} was added as ${form.role}.` })
      if (statusChanged) notify({ type: 'admin', title: 'Status changed', body: `${form.name.trim()} is now ${form.status}.` })
      if (roleChanged) notify({ type: 'admin', title: 'Role changed', body: `${form.name.trim()} is now ${form.role}.` })
      setModal(null); invalidate()
      if (backToEmployees) {
        // Hand control back to the Employees directory, which refreshes the list,
        // highlights the new person and shows the success toast.
        setReturnTo(null)
        navigate(`/employees?new=${encodeURIComponent(form.email.trim())}`)
      // Phase 6.4 (TASK 3): restored returnTo='projects' — ProjectModal's
      // Admin redirect saves a draft and navigates here, then we bounce back.
      } else if (wasAdd && returnTo === 'projects') {
        setReturnTo(null)
        qc.invalidateQueries({ queryKey: ['admin-clients'] })
        toast.success('Client created')
        navigate('/projects?newProject=1&client=' + encodeURIComponent(form.clientCompany.trim()))
      } else if (wasAdd && returnTo === 'clients') {
        // Phase 5.9 (Task 3): "Add Client" started on the Clients module, so
        // send the admin straight back there with a refreshed list.
        setReturnTo(null)
        qc.invalidateQueries({ queryKey: ['admin-clients'] })
        toast.success('Client created')
        navigate('/clients')
      } else {
        toast.success(wasAdd ? 'User created — they can log in now' : 'User updated')
      }
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || 'Could not save user'
      if (/already registered/i.test(msg)) { setErrors((s) => ({ ...s, email: msg })); toast.error(msg) }
      else toast.error(msg)
    },
  })

  const resetMutation = useMutation({
    mutationFn: () => adminApi.users.resetPassword(editing.id, resetMode === 'generate' ? { generateTemp: true } : { newPassword: resetPw }),
    onSuccess: (res) => {
      const temp = res?.temporaryPassword
      if (temp) {
        setResetResult(temp)
        toast.success('Temporary password generated')
      } else {
        toast.success('Password updated')
        closeReset()
      }
      if (editing) notify({ type: 'admin', title: 'Password reset', body: `Password for ${editing.name} was reset.` })
      invalidate()
    },
    onError: (err) => {
      const msg = err?.response?.data?.message || 'Reset failed'
      setResetErrors({ password: msg }); toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => adminApi.users.remove(id),
    onSuccess: () => { toast.success('User deleted'); setDeleting(null); invalidate() },
    onError: () => toast.error('Delete failed'),
  })

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }) => adminApi.users.bulkUpdate(ids, { status }),
    onSuccess: (_, v) => {
      toast.success(`${v.ids.length} user${v.ids.length > 1 ? 's' : ''} set to ${v.status}`)
      notify({ type: 'admin', title: 'Bulk status update', body: `${v.ids.length} users set to ${v.status}.` })
      setSelected(new Set()); setSelectedRows(new Map()); invalidate()
    },
    onError: () => toast.error('Bulk update failed'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => adminApi.users.bulkRemove(ids),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} user${ids.length > 1 ? 's' : ''} deleted`)
      notify({ type: 'admin', title: 'Bulk delete', body: `${ids.length} users were removed.` })
      setSelected(new Set()); setSelectedRows(new Map()); setBulkDeleting(false); invalidate()
    },
    onError: () => { toast.error('Bulk delete failed'); setBulkDeleting(false) },
  })

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------
  const submit = (ev) => { ev.preventDefault(); if (validate()) saveMutation.mutate() }
  const submitReset = (ev) => {
    ev.preventDefault()
    if (resetMode === 'manual') {
      const { valid } = validatePassword(resetPw)
      if (!valid) { setResetErrors({ password: 'Password must be 8–64 chars with upper, lower, number & special' }); return }
    }
    setResetErrors({}); resetMutation.mutate()
  }
  const copyReset = async () => {
    try { await navigator.clipboard.writeText(resetResult); toast.success('Copied to clipboard') }
    catch { toast.error('Copy failed') }
  }

  const onSort = useCallback((key) => {
    setParams((p) => {
      if (p.sortBy !== key) return { ...p, sortBy: key, order: 'asc', page: 1 }
      return { ...p, order: p.order === 'asc' ? 'desc' : 'asc', page: 1 }
    })
  }, [])

  const onRowSelect = useCallback((id, checked, row) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
    setSelectedRows((prev) => {
      const next = new Map(prev)
      if (checked && row) next.set(id, row); else next.delete(id)
      return next
    })
  }, [])

  const onSelectAll = useCallback((checked) => {
    if (checked) {
      const ids = new Set(selected)
      const map = new Map(selectedRows)
      rows.forEach((r) => { ids.add(r.id); map.set(r.id, r) })
      setSelected(ids); setSelectedRows(map)
    } else {
      setSelected(new Set()); setSelectedRows(new Map())
    }
  }, [rows, selected, selectedRows])

  const clearSelection = () => { setSelected(new Set()); setSelectedRows(new Map()) }

  const toggleHidden = (key) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const onView = useCallback((r) => navigate(`/admin/users/${r.id}`), [navigate])
  const onReset = useCallback((r) => openReset(r), [])
  const onEdit = useCallback((r) => openEdit(r), [])
  const onDelete = useCallback((r) => setDeleting(r), [])

  // Build the visible columns (+ always-on actions column).
  const columns = useMemo(() => {
    const visible = MASTER_COLUMNS.filter((c) => !hidden.has(c.key))
    const actions = canWrite
      ? [{
          key: '_actions', header: 'Actions', className: 'text-right',
          render: (r) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => onView(r)} title="View profile" aria-label={`View ${r.name}`}><FiEye /></button>
              <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => onReset(r)} title="Reset password" aria-label={`Reset password for ${r.name}`}><FiKey /></button>
              <button className="rounded-lg p-2 hover:bg-primary/10 hover:text-primary" onClick={() => onEdit(r)} title="Edit" aria-label={`Edit ${r.name}`}><FiEdit2 /></button>
              <button className="rounded-lg p-2 hover:bg-danger/10 hover:text-danger" onClick={() => onDelete(r)} title="Delete" aria-label={`Delete ${r.name}`}><FiTrash2 /></button>
            </div>
          ),
        }]
      : []
    return [...visible, ...actions]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, canWrite, onView, onReset, onEdit, onDelete])

  const selectedRowsArray = useMemo(() => Array.from(selectedRows.values()), [selectedRows])
  const selectedCount = selected.size

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Manage accounts, roles, and secure access."
        actions={
          <>
            <Dropdown
              align="right"
              trigger={<span className={`btn-ghost ${!rows.length ? 'pointer-events-none opacity-50' : ''}`}><FiColumns className="h-4 w-4" /> Columns</span>}
            >
              {MASTER_COLUMNS.map((c) => (
                <DropdownItem key={c.key} onClick={() => toggleHidden(c.key)} active={!hidden.has(c.key)}>
                  <span className="flex items-center gap-2">
                    <span className={cn('flex h-4 w-4 items-center justify-center rounded border', hidden.has(c.key) ? 'border-app' : 'border-primary bg-primary text-white')}>
                      {!hidden.has(c.key) && <FiCheckCircle className="h-3 w-3" />}
                    </span>
                    {c.header}
                  </span>
                </DropdownItem>
              ))}
            </Dropdown>
            <ExportMenu rows={rows} columns={exportColumns} filename="users" title="Users" subtitle="Skew Enterprise Hub" />
            {canWrite && <Button icon={FiPlus} onClick={openAdd}>Add User</Button>}
          </>
        }
      />

      <Card>
        {/* Bulk action bar */}
        {canWrite && selectedCount > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-card border border-primary/30 bg-primary/[0.05] p-3 sm:flex-row sm:items-center">
            <span className="text-sm font-medium text-primary">{selectedCount} selected</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={FiUserCheck} onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: 'Active' })}>Activate</Button>
              <Button size="sm" variant="ghost" icon={FiUserX} onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: 'Inactive' })}>Deactivate</Button>
              <Button size="sm" variant="ghost" icon={FiLock} onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: 'Suspended' })}>Suspend</Button>
              {selectedRowsArray.length > 0 && (
                <ExportMenu rows={selectedRowsArray} columns={exportColumns} filename="users-selected" title="Selected Users" subtitle="Skew Enterprise Hub" />
              )}
              <Button size="sm" variant="danger" icon={FiTrash2} onClick={() => setBulkDeleting(true)}>Delete</Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <SearchInput value={params.search} onChange={(v) => setParam({ search: v })} className="lg:max-w-xs" />
          <Select value={params.role} onChange={(e) => setParam({ role: e.target.value })} className="lg:w-44"
            options={[{ value: '', label: 'All Roles' }, ...ALL_ROLES.map((r) => ({ value: r, label: r }))]} />
          <Select value={params.status} onChange={(e) => setParam({ status: e.target.value })} className="lg:w-44"
            options={[{ value: '', label: 'All Status' }, ...USER_STATUSES.map((s) => ({ value: s, label: s }))]} />
          <Select value={params.department} onChange={(e) => setParam({ department: e.target.value })} className="lg:w-44"
            options={[{ value: '', label: 'All Departments' }, ...USER_DEPARTMENTS.map((d) => ({ value: d, label: d }))]} />
          <span className="text-sm text-muted lg:ml-auto">{data?.total || 0} records</span>
        </div>

        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-2 top-2 z-10">
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" aria-hidden="true" />
            </div>
          )}
          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            empty="No users found"
            selectable={canWrite}
            selectedIds={Array.from(selected)}
            onRowSelect={(id, checked) => {
              const row = rows.find((r) => r.id === id)
              onRowSelect(id, checked, row)
            }}
            onSelectAll={onSelectAll}
            getRowId={(r) => r.id}
            sort={{ key: params.sortBy, order: params.order }}
            onSort={onSort}
            onRowClick={canWrite ? onView : undefined}
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">Page {data?.page || 1} of {data?.totalPages || 1}</p>
          <Pagination page={params.page} totalPages={data?.totalPages || 1} onChange={(p) => setParams((prev) => ({ ...prev, page: p }))} />
        </div>
      </Card>

      {/* Add / Edit modal */}
      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={`${modal === 'edit' ? 'Edit' : 'Add'} User`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button loading={saveMutation.isPending} onClick={submit}>{modal === 'edit' ? 'Save Changes' : 'Create User'}</Button>
          </>
        }
      >
        {modal === 'add' || modal === 'edit' ? (
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Phase 6.9 (TASK 12): Role is the FIRST field for every user type.
                ROOT CAUSE of the old ordering: Role sat BELOW the identity and HR
                fields, yet Role is what drives ROLE_FIELDS and therefore which
                fields render at all. Filling the form top-to-bottom meant typing
                into HR inputs and then watching them disappear when Role was
                finally set. Role now leads the form, so the dynamic role-based
                fields below always reflect a choice the user has already made.
                Rendered full-width because it governs everything beneath it. */}
            <Select label="Role" value={form.role} onChange={(e) => setField('role', e.target.value)}
              options={ALL_ROLES.map((r) => ({ value: r, label: r }))} className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-muted">Profile Image</label>
              <ProfileImageField value={form.avatar} onChange={(v) => setField('avatar', v)} />
            </div>
            <Input label={fields.client ? 'Client Name' : 'Full Name'} placeholder=" " value={form.name} onChange={(e) => setField('name', e.target.value)} error={errors.name} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} error={errors.email} placeholder="jane@skew.com" />
            <Input label="Phone Number" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+91 …" />
            {/* Phase 5.9 (Task 1): Employee ID / Department / Designation are HR
                profile fields. They used to render for EVERY role (Employee ID was
                merely `disabled` for Clients, and Admin saw all three). They are
                now gated on the role's `hr` group. */}
            {fields.hr && (
            <>
            <Input label="Employee ID" value={form.employeeId} onChange={(e) => setField('employeeId', e.target.value)} placeholder="EMP-1042" />
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
            {/* Phase 6.16 (TASK 1) ROOT CAUSE: this Select rendered for EVERY
                role, including Client, even though the Client half of this form
                already treats status as system-managed (a new Client is always
                created Active - see the "Client Status" removal note below). It
                was never gated on `fields.client` the way every other
                role-specific field on this form is. Hidden for Client only;
                every staff role keeps it exactly as before. */}
            {!fields.client && (
              <Select label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}
                options={USER_STATUSES.map((s) => ({ value: s, label: s }))} />
            )}
            {/* Phase 5 (Task 1): Gender. Hidden for Client accounts, which have
                no Employee HR profile. Drives the gender-based leave-type
                filtering in Task 2. */}
            {fields.gender && (
              <Select label="Gender" value={form.gender} onChange={(e) => setField('gender', e.target.value)}
                options={GENDER_OPTIONS.map((g) => ({ value: g, label: g }))}
                placeholder="Select gender" error={errors.gender} required aria-required="true" />
            )}

            {/* Extended HR fields — shown only for staff roles that own an Employee profile */}
            {fields.hr && (
              <>
                <Select label="Employment Type" value={form.employmentType} onChange={(e) => setField('employmentType', e.target.value)}
                  options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))} />
                <Select label="Work Location" value={form.workLocation} onChange={(e) => setField('workLocation', e.target.value)}
                  options={WORK_LOCATIONS.map((w) => ({ value: w, label: w }))} placeholder="Select work location…" />
                {/* Phase 5.9 (Task 1): Employee reports UP to one manager;
                    a Manager owns a team DOWNWARD. Showing both to both roles
                    was meaningless, so each role now sees only its own field. */}
                {fields.reportingManager && (
                  <MultiSelect
                    label="Reporting Manager"
                    singleSelect
                    value={form.reportingManager ? [form.reportingManager] : []}
                    onChange={(arr) => setField('reportingManager', arr[0] || '')}
                    options={managerOptions}
                    loading={managerLoading}
                    emptyText="No managers found"
                    placeholder="Select reporting manager\u2026"
                  />
                )}
                {fields.reportingTeam && (
                  <MultiSelect
                    label="Reporting Team"
                    value={form.reportingTeam}
                    onChange={(next) => setField('reportingTeam', next)}
                    options={teamOptions}
                    loading={teamLoading}
                    placeholder="Select team members…"
                  />
                )}
                <Select label="Shift" value={form.shift} onChange={(e) => setField('shift', e.target.value)}
                  options={SHIFT_OPTIONS.map((sft) => ({ value: sft, label: sft }))} placeholder="Select shift…" />
                {/* Phase 5.7 (Task 4): admin-chosen employee code. Left blank the
                    server allocates the next sequential EMP code; typed values are
                    now preserved verbatim instead of being overwritten. */}
                <Input label="Employee Code" value={form.empCode} onChange={(e) => setField('empCode', e.target.value)}
                  placeholder="Auto-generated if blank (e.g. EMP001)" error={errors.empCode} />
                <Input label="Annual CTC (₹)" type="number" value={form.salaryCtc} onChange={(e) => setField('salaryCtc', e.target.value)} placeholder="e.g. 1200000" />
                <Input label="Joining Date" type="date" value={form.joiningDate} onChange={(e) => setField('joiningDate', e.target.value)} />
                <Input label="Experience" value={form.experienceYears} onChange={(e) => setField('experienceYears', e.target.value)} placeholder="e.g. 4 yrs" />
                <Input label="Emergency Contact" value={form.emergencyContact} onChange={(e) => setField('emergencyContact', e.target.value)} placeholder="+91 …" />
              </>
            )}

            {/* Password — only on create */}
            {/* ---------------------------------------------------------------
                Phase 5.9 (Task 2) — PASSWORD BLOCK

                ROOT CAUSE of the misalignment: the two password inputs were
                direct children of the parent 2-column grid, but only the FIRST
                one was wrapped in a <div> that also contained <PasswordStrength>.
                A CSS grid stretches every cell in a row to the tallest cell, so
                the strength meter made the left cell taller than the right one
                and the two inputs no longer shared a baseline. The gap also grew
                the moment a password was typed, making the form visibly jump.

                FIX: both inputs now live in a dedicated full-width sub-grid with
                `items-start`, and the strength meter is moved to its own
                full-width row BELOW both inputs, so neither cell can be inflated.
                A live match indicator sits under Confirm Password.
                Reuses the EXISTING PasswordField (which already ships the
                FiEye/FiEyeOff show-hide toggle) and PasswordStrength — no new
                password component is introduced.
            --------------------------------------------------------------- */}
            {modal === 'add' && (
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

            {modal === 'edit' && (
              <p className="sm:col-span-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-muted">
                Passwords are managed via <b>Reset Password</b> — they cannot be edited here.
              </p>
            )}

            {/* Client-only profile linking */}
            {fields.client && (
              <>
                <Select label="Client Profile" value={form.clientMode} onChange={(e) => setField('clientMode', e.target.value)}
                  options={[{ value: 'new', label: 'Create new client' }, { value: 'existing', label: 'Link existing client' }]} className="sm:col-span-2" />
                {form.clientMode === 'existing' ? (
                  <Select label="Assigned Client" value={form.clientId} onChange={(e) => setField('clientId', e.target.value)} error={errors.clientId}
                    options={[{ value: '', label: 'Select client…' }, ...clients.map((c) => ({ value: c.id || c.clientId, label: c.company || c.name }))]} className="sm:col-span-2" />
                ) : (
                  <>
                    <Input label="Company Name" value={form.clientCompany} onChange={(e) => setField('clientCompany', e.target.value)} error={errors.clientCompany} placeholder="Acme Corp" />
                    {/* Phase 6.9 (TASK 10): the Account Manager input is removed. */}
                    <Input label="Client Code" value={form.clientId} onChange={(e) => setField('clientId', e.target.value)}
                      placeholder="Auto-generated if blank" error={errors.clientId} />
                    {/* Phase 6.9 (TASK 11): the Client Status select is removed. A
                        newly created client is always Active; status is managed
                        afterwards from the client record itself. */}
                    {/* Phase 5.9 (Task 1 & 3): the remaining client profile /
                        commercial fields. Capturing them here is what makes the
                        standalone "Add Client" page redundant (Task 3) — every
                        one already exists on the Client Mongo model. */}
                    <Textarea label="Address" value={form.address} onChange={(e) => setField('address', e.target.value)}
                      placeholder="Street, city, state, PIN" rows={2} className="sm:col-span-2" />
                    <Input label="GST Number" value={form.gst} onChange={(e) => setField('gst', e.target.value)} placeholder="22AAAAA0000A1Z5" />
                    <Select label="Project Type" value={form.projectType} onChange={(e) => setField('projectType', e.target.value)}
                      options={[{ value: '', label: 'Optional…' }, ...PROJECT_TYPES.map((p) => ({ value: p, label: p }))]} />
                    <Input label="Advance Payment" type="number" min="0" value={form.advancePayment}
                      onChange={(e) => setField('advancePayment', e.target.value)} error={errors.advancePayment} placeholder="0" />
                    <Input label="Monthly Due" type="number" min="0" value={form.monthlyDue}
                      onChange={(e) => setField('monthlyDue', e.target.value)} error={errors.monthlyDue} placeholder="0" />
                    {/* Phase 6.16 (TASK 1): Budget. Reuses the Client model's
                        existing `budget` field - no new schema field, no new
                        endpoint, same commercial-terms row as Advance Payment
                        and Monthly Due. */}
                    <Input label="Budget (₹)" type="number" min="0" value={form.budget}
                      onChange={(e) => setField('budget', e.target.value)} error={errors.budget} placeholder="0" />
                    {/* Phase 6.4 (TASK 2): project details captured at client creation. */}
                    <Input label="Project Name" value={form.projectName} onChange={(e) => setField('projectName', e.target.value)} placeholder="Website Redesign" className="sm:col-span-2" />
                    <Input label="Project Code" value={form.projectCode} onChange={(e) => setField('projectCode', e.target.value)} placeholder="PRJ-001" />
                    <Input label="Project Description" value={form.projectDescription} onChange={(e) => setField('projectDescription', e.target.value)} placeholder="Brief project description" />
                  </>
                )}

                {/* ---------------------------------------------------------
                    Phase 6.3 (TASK 1): the "Project Details" section that used
                    to render here in merged mode is DELETED. It was the second
                    project creation form (Project Name / Code / Priority /
                    Project Status / Budget / Project Lead / Start Date /
                    Deadline / Project Description) with its own hand-rolled
                    validation, no members MultiSelect and no colour picker.
                    Projects are now created only through the shared
                    <ProjectModal/>.
                --------------------------------------------------------- */}

                {/* ---------------------------------------------------------
                    Phase 6.3 (TASK 2) - PROJECT MEMBERS

                    ROOT CAUSE: the Admin client form simply had no members
                    field. `ClientProject.team[]` existed in the schema and the
                    portal already rendered it (ClientTeam / the Team tab), but
                    the only way it was ever populated was syncClientProject()
                    copying `Project.members` across - so a client created here
                    always started with an empty team.

                    REUSE: this is the SAME shared <MultiSelect/> component and
                    the SAME `teamOptions` employee list already used by the
                    Manager "Reporting Team" field directly above - which is
                    itself backed by the existing adminApi.users.query({ role:
                    'Employee' }) call. No new component, no new endpoint, and
                    no new employee query were introduced. MultiSelect ships
                    searchable filtering already.

                    RBAC: `role: 'Employee'` is enforced server-side by the
                    existing /users query, so only Employees are listed - never
                    Admins, HR, Managers or other Clients. The whole page is
                    behind `protect, authorize('Admin')`.
                --------------------------------------------------------- */}
                <div className="sm:col-span-2">
                  {/* Phase 6.16 (TASK 1) ROOT CAUSE of the reported "inconsistent"
                      dropdown: this already used the shared <MultiSelect/> -
                      the SAME component as Department / Reporting Manager /
                      Reporting Team above and the Members field in
                      ProjectModal.jsx / Clients.jsx - so it was never a second
                      dropdown implementation. The inconsistency was missing
                      configuration: no `emptyText` (fell back to the generic
                      "No results") and no validation error ever surfaced on
                      the control, even though every other Project Members
                      picker in the app treats Members as required. Fixed by
                      completing the same props those pickers already pass -
                      not by introducing another dropdown component. */}
                  <MultiSelect
                    label="Project Members"
                    value={form.projectMembers}
                    onChange={(next) => setField('projectMembers', next)}
                    options={teamOptions}
                    loading={teamLoading}
                    emptyText="No employees found"
                    placeholder="Search and select employees…"
                    error={errors.projectMembers}
                  />
                  {!errors.projectMembers && (
                    <p className="mt-1.5 text-xs text-muted">
                      Employees assigned to this client. They are attached to the
                      client&apos;s project team automatically.
                    </p>
                  )}
                </div>
              </>
            )}
          </form>
        ) : null}
      </Modal>

      {/* Reset password modal */}
      <Modal
        open={modal === 'reset'}
        onClose={closeReset}
        title={`Reset Password — ${editing?.name || ''}`}
        footer={
          resetResult ? null : (
            <>
              <Button variant="ghost" onClick={closeReset}>Cancel</Button>
              <Button loading={resetMutation.isPending} onClick={submitReset}>{resetMode === 'generate' ? 'Generate & Reset' : 'Set Password'}</Button>
            </>
          )
        }
      >
        {resetResult ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">A temporary password was generated. Share it with the user securely, then ask them to change it on next login.</p>
            <div className="flex items-center gap-2 rounded-xl border border-app bg-black/[0.02] px-3 py-2.5 dark:bg-white/[0.03]">
              <code className="flex-1 select-all font-mono text-sm">{resetResult}</code>
              <Button variant="ghost" size="sm" icon={FiCopy} onClick={copyReset}>Copy</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" icon={FiRefreshCw} onClick={submitReset} loading={resetMutation.isPending}>Regenerate</Button>
              <Button onClick={closeReset}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button variant={resetMode === 'generate' ? 'primary' : 'ghost'} onClick={() => setResetMode('generate')} icon={FiRefreshCw}>Generate temporary</Button>
              <Button variant={resetMode === 'manual' ? 'primary' : 'ghost'} onClick={() => setResetMode('manual')}>Enter manually</Button>
            </div>
            {resetMode === 'generate' ? (
              <p className="text-sm text-muted">A strong temporary password will be generated and shown to you. Share it with the user securely.</p>
            ) : (
              <>
                <PasswordField label="New Password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} error={resetErrors.password} />
                <PasswordStrength value={resetPw} />
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        title="Delete user?"
        message={`Remove ${deleting?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={bulkDeleting}
        onClose={() => setBulkDeleting(false)}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selected))}
        title="Delete selected users?"
        message={`Remove ${selectedCount} user${selectedCount > 1 ? 's' : ''}? This cannot be undone.`}
        confirmLabel="Delete"
        loading={bulkDeleteMutation.isPending}
      />
    </div>
  )
}
