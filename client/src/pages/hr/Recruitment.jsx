import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { FiUserPlus, FiBriefcase, FiUsers } from 'react-icons/fi'
import { hrApi } from '@/api/services'
import { PageHeader, Card, CardHeader, Tabs, Badge, Avatar, StatCard, Loader } from '@/components/ui'
import { EntityManager } from '@/features/hr/EntityManager'
import { jobSchema, candidateSchema } from '@/features/hr/schemas'
import { JOB_TYPES, JOB_STATUS, CANDIDATE_STAGES, HR_WRITE_ROLES } from '@/features/hr/constants'
import { formatDate } from '@/utils'

// --- Job Openings tab (full CRUD via EntityManager) ---
function JobOpenings() {
  const { data: deptData = [], isLoading: deptLoading } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
  })
  const deptOptions = (Array.isArray(deptData) ? deptData : [])
    .map((d) => d?.name)
    .filter(Boolean)

  const columns = [
    { key: 'title', header: 'Position', render: (r) => <span className="font-medium">{r.title}</span> },
    { key: 'department', header: 'Department' },
    { key: 'location', header: 'Location' },
    { key: 'type', header: 'Type', render: (r) => <Badge tone="accent">{r.type}</Badge> },
    { key: 'openings', header: 'Openings' },
    { key: 'applicants', header: 'Applicants' },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  return (
    <EntityManager
      title="Job Openings"
      writeRoles={HR_WRITE_ROLES}
      subtitle="Open positions and requisitions."
      api={hrApi.jobs}
      queryKey="hr-jobs"
      columns={columns}
      schema={jobSchema}
      defaultValues={{ title: '', department: '', location: '', type: 'Full-time', openings: 1, experience: '', status: 'Open' }}
      filters={[{ name: 'department', label: 'All Departments', options: deptOptions }, { name: 'status', label: 'All Status', options: JOB_STATUS }]}
      fields={[
        { name: 'title', label: 'Job Title' },
        { name: 'department', label: 'Department', type: 'select', placeholder: deptLoading ? 'Loading…' : 'Select department', emptyText: 'No departments yet' },
        { name: 'location', label: 'Location' },
        { name: 'type', label: 'Type', type: 'select', options: JOB_TYPES },
        { name: 'openings', label: 'No. of Openings', type: 'number' },
        { name: 'experience', label: 'Experience (e.g. 3+ yrs)' },
        { name: 'status', label: 'Status', type: 'select', options: JOB_STATUS },
      ]}
      fieldOptions={{ department: { options: deptOptions.map((n) => ({ value: n, label: n })), loading: deptLoading } }}
      exportColumns={[
        { header: 'Title', accessor: 'title' }, { header: 'Department', accessor: 'department' },
        { header: 'Openings', accessor: 'openings' }, { header: 'Applicants', accessor: 'applicants' }, { header: 'Status', accessor: 'status' },
      ]}
      filename="job-openings"
    />
  )
}

// --- Candidates tab (CRUD) ---
function Candidates() {
  const columns = [
    { key: 'name', header: 'Candidate', render: (r) => (
      <div className="flex items-center gap-3"><Avatar name={r.name} size={34} /><div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.email}</p></div></div>
    ) },
    { key: 'position', header: 'Position' },
    { key: 'experience', header: 'Experience' },
    { key: 'source', header: 'Source', render: (r) => <Badge tone="accent">{r.source}</Badge> },
    { key: 'rating', header: 'Rating', render: (r) => <Badge tone={r.rating >= 4 ? 'success' : 'warning'}>{r.rating} ★</Badge> },
    { key: 'stage', header: 'Stage', render: (r) => <Badge>{r.stage}</Badge> },
  ]
  return (
    <EntityManager
      title="Candidates"
      writeRoles={HR_WRITE_ROLES}
      subtitle="Applicant tracking across all openings."
      api={hrApi.candidates}
      queryKey="hr-candidates"
      columns={columns}
      schema={candidateSchema}
      defaultValues={{ name: '', email: '', phone: '', position: '', experience: '', source: 'LinkedIn', stage: 'Applied' }}
      filters={[{ name: 'stage', label: 'All Stages', options: CANDIDATE_STAGES }, { name: 'source', label: 'All Sources', options: ['LinkedIn', 'Referral', 'Naukri', 'Website', 'Indeed'] }]}
      fields={[
        { name: 'name', label: 'Full Name' },
        { name: 'email', label: 'Email' },
        { name: 'phone', label: 'Phone' },
        { name: 'position', label: 'Position Applied' },
        { name: 'experience', label: 'Experience' },
        { name: 'source', label: 'Source', type: 'select', options: ['LinkedIn', 'Referral', 'Naukri', 'Website', 'Indeed'] },
        { name: 'stage', label: 'Stage', type: 'select', options: CANDIDATE_STAGES },
      ]}
      exportColumns={[
        { header: 'Name', accessor: 'name' }, { header: 'Position', accessor: 'position' },
        { header: 'Source', accessor: 'source' }, { header: 'Stage', accessor: 'stage' },
      ]}
      filename="candidates"
    />
  )
}

// --- Interview Pipeline board ---
const STAGE_TONE = {
  Applied: 'border-t-slate-400', Screening: 'border-t-accent', Interview: 'border-t-primary',
  Offer: 'border-t-warning', Hired: 'border-t-success', Rejected: 'border-t-danger',
}

function Pipeline() {
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: ['hr-candidates-all'], queryFn: hrApi.candidates.all })

  const move = useMutation({
    mutationFn: ({ id, stage }) => hrApi.moveCandidate(id, stage),
    onSuccess: (_r, v) => { toast.success(`Moved to ${v.stage}`); qc.invalidateQueries({ queryKey: ['hr-candidates-all'] }); qc.invalidateQueries({ queryKey: ['hr-candidates'] }) },
  })

  if (isLoading) return <Loader label="Loading pipeline…" />

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {CANDIDATE_STAGES.map((stage) => {
        const items = data.filter((c) => c.stage === stage)
        const idx = CANDIDATE_STAGES.indexOf(stage)
        return (
          <div key={stage} className={`rounded-card border border-app border-t-4 surface p-3 ${STAGE_TONE[stage]}`}>
            <div className="mb-3 flex items-center justify-between px-1">
              <h4 className="text-sm font-semibold">{stage}</h4>
              <Badge tone="default">{items.length}</Badge>
            </div>
            <div className="space-y-2">
              {items.map((c) => (
                <motion.div key={c.id} layout className="rounded-xl border border-app bg-[var(--bg)] p-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={c.name} size={28} />
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{c.name}</p><p className="truncate text-xs text-muted">{c.position}</p></div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge tone="accent">{c.rating} ★</Badge>
                    <div className="flex gap-1">
                      {idx > 0 && <button onClick={() => move.mutate({ id: c.id, stage: CANDIDATE_STAGES[idx - 1] })} className="rounded p-1 text-xs hover:bg-black/5 dark:hover:bg-white/10">←</button>}
                      {idx < CANDIDATE_STAGES.length - 1 && <button onClick={() => move.mutate({ id: c.id, stage: CANDIDATE_STAGES[idx + 1] })} className="rounded p-1 text-xs hover:bg-black/5 dark:hover:bg-white/10">→</button>}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Recruitment() {
  const [tab, setTab] = useState('jobs')
  const { data: stats } = useQuery({ queryKey: ['hr-stats'], queryFn: hrApi.stats })

  return (
    <div>
      <PageHeader title="Recruitment" subtitle="Job openings, candidates and the hiring pipeline." />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open Jobs" value={stats?.openJobs ?? '—'} icon={FiBriefcase} tone="success" />
        <StatCard label="Candidates" value={stats?.totalCandidates ?? '—'} icon={FiUsers} />
        <StatCard label="Interviews" value={stats?.interviewsScheduled ?? '—'} icon={FiUserPlus} tone="warning" />
        <StatCard label="Pending Offers" value={stats?.pendingOffers ?? '—'} icon={FiBriefcase} tone="accent" />
      </div>

      <Tabs className="mb-4" value={tab} onChange={setTab}
        items={[{ key: 'jobs', label: 'Job Openings' }, { key: 'candidates', label: 'Candidates' }, { key: 'pipeline', label: 'Interview Pipeline' }]} />

      {tab === 'jobs' && <JobOpenings />}
      {tab === 'candidates' && <Candidates />}
      {tab === 'pipeline' && <Pipeline />}
    </div>
  )
}
