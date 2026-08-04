import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  FiMail, FiPhone, FiMapPin, FiCalendar, FiUser, FiHome, FiUploadCloud,
  FiFileText, FiFile, FiImage, FiDownload, FiTrash2, FiStar, FiAward, FiBriefcase,
} from 'react-icons/fi'
import { Card, CardHeader, Badge, DataTable, Avatar } from '@/components/ui'
import { employeeApi } from '@/api/services'
import { formatCurrency, formatDate, formatBytes } from '@/utils'

// ---------- Overview ----------
export function OverviewTab({ employee }) {
  const info = [
    { icon: FiMail, label: 'Email', value: employee.email },
    { icon: FiPhone, label: 'Phone', value: employee.phone },
    { icon: FiUser, label: 'Gender', value: employee.gender },
    { icon: FiCalendar, label: 'Date of Birth', value: formatDate(employee.dob) },
    { icon: FiMapPin, label: 'Address', value: employee.address },
    { icon: FiHome, label: 'Work Location', value: employee.workLocation },
    { icon: FiBriefcase, label: 'Employment Type', value: employee.employmentType },
    { icon: FiUser, label: 'Reporting To', value: employee.reportingTo },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Personal Information" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {info.map((i) => (
            <div key={i.label} className="flex items-center gap-3 rounded-xl border border-app p-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary"><i.icon /></div>
              <div className="min-w-0"><p className="text-xs text-muted">{i.label}</p><p className="truncate text-sm font-medium">{i.value || '—'}</p></div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Performance Snapshot" />
        <div className="flex flex-col items-center">
          <div className="relative flex h-32 w-32 items-center justify-center">
            <svg className="h-32 w-32 -rotate-90">
              <circle cx="64" cy="64" r="56" className="stroke-black/10 dark:stroke-white/10" strokeWidth="10" fill="none" />
              <circle cx="64" cy="64" r="56" stroke="#2563EB" strokeWidth="10" fill="none"
                strokeDasharray={2 * Math.PI * 56} strokeDashoffset={2 * Math.PI * 56 * (1 - employee.performance / 100)} strokeLinecap="round" />
            </svg>
            <span className="absolute text-2xl font-bold">{employee.performance}%</span>
          </div>
          <p className="mt-3 text-sm text-muted">Overall rating</p>
        </div>
      </Card>
    </div>
  )
}

// ---------- Salary ----------
export function SalaryTab({ employee }) {
  // Phase 5.4 (Task 2): defensive default — a never-set salary subdocument can
  // be `{}` or missing, in which case every field below was `undefined` and
  // rendered as ₹0 regardless of the backend fix.
  const s = employee.salary || {}
  const rows = [
    { label: 'Basic', value: s.basic }, { label: 'HRA', value: s.hra },
    { label: 'Allowances', value: s.allowances }, { label: 'PF (deduction)', value: -s.pf },
    { label: 'Tax (deduction)', value: -s.tax },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Salary Breakdown" subtitle="Monthly components" />
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
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Annual CTC" />
          <p className="text-3xl font-bold text-primary">{formatCurrency(s.ctc)}</p>
          <p className="text-sm text-muted">{formatCurrency(s.monthly)} / month</p>
        </Card>
        <Card>
          <CardHeader title="Bank Details" />
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Bank</span><span className="font-medium">{employee.bank?.name || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted">Account</span><span className="font-mono">{employee.bank?.account || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted">IFSC</span><span className="font-mono">{employee.bank?.ifsc || '—'}</span></div>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ---------- Skills & Experience ----------
export function SkillsTab({ employee }) {
  const levelTone = { Beginner: 'default', Intermediate: 'accent', Advanced: 'primary', Expert: 'success' }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Skills" />
        <div className="space-y-3">
          {employee.skills.map((sk) => (
            <div key={sk.name}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{sk.name}</span>
                <Badge tone={levelTone[sk.level]}>{sk.level}</Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full rounded-full bg-primary" style={{ width: `${{ Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 }[sk.level]}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Work Experience" />
        <div className="relative space-y-4 border-l-2 border-app pl-4">
          {employee.experience.map((exp) => (
            <div key={exp.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-primary ring-4 ring-[var(--surface)]" />
              <p className="text-sm font-semibold">{exp.role}</p>
              <p className="text-sm text-muted">{exp.company}</p>
              <p className="text-xs text-muted">{exp.from} – {exp.to}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ---------- Certificates ----------
export function CertificatesTab({ employee }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {employee.certificates.map((c) => (
        <Card key={c.id} className="transition hover:shadow-card">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-warning/10 text-warning"><FiAward className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="font-medium leading-tight">{c.name}</p>
              <p className="text-sm text-muted">{c.issuer}</p>
              <Badge tone="accent" className="mt-2">{c.year}</Badge>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---------- Performance Reviews ----------
export function ReviewsTab({ employee }) {
  return (
    <div className="space-y-3">
      {employee.reviews.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold">{r.period}</p>
              <p className="text-sm text-muted">Reviewed by {r.reviewer}</p>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <FiStar key={i} className={`h-4 w-4 ${i < Math.round(r.rating) ? 'fill-warning text-warning' : 'text-muted'}`} />
              ))}
              <span className="ml-1 text-sm font-medium">{r.rating.toFixed(1)}</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted">{r.comment}</p>
        </Card>
      ))}
    </div>
  )
}

// ---------- Attendance & Leave history ----------
export function AttendanceTab({ employee }) {
  const columns = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'checkIn', header: 'Check In' }, { key: 'checkOut', header: 'Check Out' },
    { key: 'workingHours', header: 'Hours', render: (r) => `${r.workingHours}h` },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  return <Card><CardHeader title="Attendance History" subtitle="Recent records" /><DataTable columns={columns} data={employee.attendanceHistory} /></Card>
}

export function LeaveTab({ employee }) {
  const columns = [
    { key: 'type', header: 'Type' },
    { key: 'from', header: 'From', render: (r) => formatDate(r.from) },
    { key: 'to', header: 'To', render: (r) => formatDate(r.to) },
    { key: 'days', header: 'Days' },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  return <Card><CardHeader title="Leave History" /><DataTable columns={columns} data={employee.leaveHistory} /></Card>
}

// ---------- Emergency Contacts ----------
export function EmergencyTab({ employee }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {employee.emergencyContacts.map((c) => (
        <Card key={c.id}>
          <div className="flex items-center gap-3">
            <Avatar name={c.name} size={44} />
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-muted">{c.relation}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-primary"><FiPhone className="h-3.5 w-3.5" />{c.phone}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ---------- Documents (with upload) ----------
const DOC_ICON = { pdf: FiFileText, word: FiFile, excel: FiFile, image: FiImage }
const DOC_TONE = { pdf: 'text-danger', word: 'text-primary', excel: 'text-success', image: 'text-accent' }

export function DocumentsTab({ employee }) {
  const [docs, setDocs] = useState(employee.documents)
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (accepted) => {
    setUploading(true)
    try {
      const uploaded = []
      for (const file of accepted) {
        const doc = await employeeApi.uploadDocument(employee.id, file)
        uploaded.push(doc)
      }
      setDocs((d) => [...uploaded, ...d])
      toast.success(`${accepted.length} document(s) uploaded`)
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }, [employee.id])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop })

  const remove = (id) => { setDocs((d) => d.filter((x) => x.id !== id)); toast.success('Document deleted') }

  return (
    <div className="space-y-4">
      <div {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed p-8 text-center transition ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-app hover:border-primary/60'}`}>
        <input {...getInputProps()} />
        <FiUploadCloud className="mb-2 h-8 w-8 text-primary" />
        <p className="text-sm font-medium">{uploading ? 'Uploading…' : isDragActive ? 'Drop files…' : 'Drag & drop documents, or click to browse'}</p>
        <p className="text-xs text-muted">PDF, Word, Excel or images</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {docs.map((d, i) => {
          const Icon = DOC_ICON[d.type] || FiFile
          return (
            <motion.div key={d.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}>
              <Card className="group flex items-center gap-3">
                <Icon className={`h-8 w-8 flex-none ${DOC_TONE[d.type]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={d.name}>{d.name}</p>
                  <p className="text-xs text-muted">{d.category} · {formatBytes(d.size)}</p>
                </div>
                <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button className="rounded-lg p-1.5 hover:bg-primary/10 hover:text-primary" aria-label="Download"><FiDownload className="h-4 w-4" /></button>
                  <button onClick={() => remove(d.id)} className="rounded-lg p-1.5 hover:bg-danger/10 hover:text-danger" aria-label="Delete"><FiTrash2 className="h-4 w-4" /></button>
                </div>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
