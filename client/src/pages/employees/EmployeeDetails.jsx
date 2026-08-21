import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { FiArrowLeft, FiEdit2, FiCamera, FiMail, FiPhone } from 'react-icons/fi'
import { employeeApi } from '@/api/services'
import { PageHeader, Card, Button, Badge, Avatar, Tabs, Loader } from '@/components/ui'
import { EmptyState } from '@/components/ui'
import { ExportMenu } from '@/components/ExportMenu'
import { employeeExportColumns } from '@/features/employees/exportColumns'
import {
  EMPLOYEE_EDIT_ROLES, employeeFieldPermissions,
} from '@/features/employees/permissions'
import { ROLES } from '@/constants'
import { useAuth } from '@/hooks/useAuth'
import {
  OverviewTab, SalaryTab, SkillsTab, CertificatesTab, ReviewsTab,
  AttendanceTab, LeaveTab, EmergencyTab, DocumentsTab,
} from '@/features/employees/detailTabs'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'salary', label: 'Salary' },
  { key: 'skills', label: 'Skills & Experience' },
  { key: 'certificates', label: 'Certificates' },
  { key: 'reviews', label: 'Performance' },
  { key: 'documents', label: 'Documents' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leave', label: 'Leave' },
  { key: 'emergency', label: 'Emergency' },
]

export default function EmployeeDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef(null)
  const { user, hasRole } = useAuth()
  const canEdit = hasRole(EMPLOYEE_EDIT_ROLES)
  const canEditSalary = canEdit && employeeFieldPermissions(user?.role).canEditSalary
  const canManageReviews = hasRole([ROLES.ADMIN, ROLES.MANAGER])
  const [tab, setTab] = useState('overview')

  const { data: employee, isLoading, isError } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => employeeApi.get(id),
  })

  // The URL carries the human-readable Employee ID (EMP001); the sub-resources
  // (documents, skills, photo…) key on the Mongo ObjectId, so they use the
  // resolved `id` once the record is loaded.
  const employeeId = employee?.id || employee?._id

  const photoMutation = useMutation({
    mutationFn: (file) => employeeApi.uploadPhoto(employeeId, file),
    onSuccess: () => { toast.success('Photo updated'); qc.invalidateQueries({ queryKey: ['employee', id] }) },
    onError: () => toast.error('Photo upload failed'),
  })

  if (isLoading) return <Loader label="Loading employee…" />
  if (isError || !employee) {
    return (
      <div>
        <PageHeader title="Employee" />
        <Card><EmptyState title="Employee not found" description="This record may have been removed." action={<Button className="mt-3" onClick={() => navigate('/employees')}>Back to List</Button>} /></Card>
      </div>
    )
  }

  const onPhotoPick = (e) => { const f = e.target.files?.[0]; if (f) photoMutation.mutate(f) }

  const openEditPage = () => navigate(`/employees/${id}/edit`)

  const tabContent = {
    overview: <OverviewTab employee={employee} canEdit={canEdit} onEdit={openEditPage} />,
    salary: <SalaryTab employee={employee} canEditSalary={canEditSalary} onEdit={openEditPage} />,
    skills: <SkillsTab employee={employee} employeeId={employeeId} canEdit={canEdit} onEdit={openEditPage} />,
    certificates: <CertificatesTab employee={employee} employeeId={employeeId} canEdit={canEdit} />,
    reviews: <ReviewsTab employee={employee} canManageReviews={canManageReviews} />,
    documents: <DocumentsTab employee={employee} employeeId={employeeId} canEdit={canEdit} />,
    attendance: <AttendanceTab employee={employee} />,
    leave: <LeaveTab employee={employee} />,
    emergency: <EmergencyTab employee={employee} employeeId={employeeId} canEdit={canEdit} onEdit={openEditPage} />,
  }

  return (
    <div>
      <PageHeader
        title="Employee Details"
        subtitle={employee.name}
        actions={
          <>
            <Button variant="ghost" icon={FiArrowLeft} onClick={() => navigate('/employees')}>Back</Button>
            <ExportMenu rows={[employee]} columns={employeeExportColumns} filename={`employee-${employee.empCode}`} title="Employee Profile" subtitle={employee.name} />
            {canEdit && <Button icon={FiEdit2} onClick={() => navigate(`/employees/${id}/edit`)}>Edit</Button>}
          </>
        }
      />

      {/* Profile header */}
      <Card className="mb-4 overflow-hidden p-0">
        <div className="h-28 bg-gradient-to-r from-primary to-accent" />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
          <div className="-mt-16 flex-none">
            <div className="relative w-fit">
              <Avatar name={employee.name} src={employee.avatar} size={96} className="ring-4 ring-[var(--surface)]" />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white ring-2 ring-[var(--surface)] hover:bg-primary-600"
                aria-label="Change photo"
              >
                {photoMutation.isPending ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <FiCamera className="h-4 w-4" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhotoPick} />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{employee.name}</h2>
              <span title={`Account status: ${employee.status}`}>
                <Badge>{employee.attendanceStatus || employee.status}</Badge>
              </span>
            </div>
            <p className="text-muted">{employee.designation} · {employee.department}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="flex items-center gap-1"><FiMail className="h-3.5 w-3.5" />{employee.email}</span>
              <span className="flex items-center gap-1"><FiPhone className="h-3.5 w-3.5" />{employee.phone}</span>
              <span>Code: {employee.empCode}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4 overflow-x-auto">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tabContent[tab]}
    </div>
  )
}
