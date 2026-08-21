import { EntityManager } from '@/features/hr/EntityManager'
import { hrApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { interviewSchema } from '@/features/hr/schemas'
import { INTERVIEW_ROUNDS, INTERVIEW_MODES, INTERVIEW_STATUS, HR_WRITE_ROLES } from '@/features/hr/constants'
import { formatDate } from '@/utils'

export default function Interviews() {
  const columns = [
    { key: 'candidate', header: 'Candidate', render: (r) => <span className="font-medium">{r.candidate}</span> },
    { key: 'position', header: 'Position' },
    { key: 'round', header: 'Round', render: (r) => <Badge tone="accent">{r.round}</Badge> },
    { key: 'interviewer', header: 'Interviewer' },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'time', header: 'Time' },
    { key: 'mode', header: 'Mode' },
    { key: 'status', header: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  ]
  return (
    <EntityManager
      title="Interviews"
      writeRoles={HR_WRITE_ROLES}
      subtitle="Schedule and track interview rounds."
      addLabel="Schedule"
      api={hrApi.interviews}
      queryKey="hr-interviews"
      columns={columns}
      schema={interviewSchema}
      defaultValues={{ candidate: '', position: '', round: 'Technical', interviewer: '', date: '', time: '10:00', mode: 'Video Call', status: 'Scheduled' }}
      filters={[{ name: 'status', label: 'All Status', options: INTERVIEW_STATUS }, { name: 'round', label: 'All Rounds', options: INTERVIEW_ROUNDS }]}
      fields={[
        { name: 'candidate', label: 'Candidate' },
        { name: 'position', label: 'Position' },
        { name: 'round', label: 'Round', type: 'select', options: INTERVIEW_ROUNDS },
        { name: 'interviewer', label: 'Interviewer' },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'time', label: 'Time', type: 'time' },
        { name: 'mode', label: 'Mode', type: 'select', options: INTERVIEW_MODES },
        { name: 'status', label: 'Status', type: 'select', options: INTERVIEW_STATUS },
      ]}
      exportColumns={[
        { header: 'Candidate', accessor: 'candidate' }, { header: 'Position', accessor: 'position' },
        { header: 'Round', accessor: 'round' }, { header: 'Interviewer', accessor: 'interviewer' },
        { header: 'Date', accessor: 'date' }, { header: 'Status', accessor: 'status' },
      ]}
      filename="interviews"
    />
  )
}
