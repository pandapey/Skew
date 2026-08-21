import { EntityManager } from '@/features/hr/EntityManager'
import { attendanceApi } from '@/api/services'
import { ATTENDANCE_WRITE_ROLES } from '@/features/attendance/constants'
import { Badge } from '@/components/ui'
import { z } from 'zod'

const shiftSchema = z.object({
  name: z.string().min(1, 'Shift name required'),
  code: z.string().min(1, 'Code required'),
  start: z.string().min(1, 'Start time required'),
  end: z.string().min(1, 'End time required'),
  hours: z.coerce.number().min(1).max(24),
  graceMins: z.coerce.number().min(0).max(120),
})

export default function Shifts() {
  const columns = [
    { key: 'name', header: 'Shift', render: (r) => (
      <span className="flex items-center gap-2 font-medium">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color || '#2563EB' }} />{r.name}
      </span>
    ) },
    { key: 'code', header: 'Code', render: (r) => <Badge tone="accent">{r.code}</Badge> },
    { key: 'start', header: 'Start' },
    { key: 'end', header: 'End' },
    { key: 'hours', header: 'Hours', render: (r) => `${r.hours}h` },
    { key: 'graceMins', header: 'Grace', render: (r) => `${r.graceMins}m` },
  ]
  return (
    <EntityManager
      title="Shift Management"
      writeRoles={ATTENDANCE_WRITE_ROLES}
      subtitle="Define work shifts, timings and grace periods."
      addLabel="Add Shift"
      api={attendanceApi.shifts}
      queryKey="attendance-shifts"
      columns={columns}
      schema={shiftSchema}
      defaultValues={{ name: '', code: '', start: '09:00', end: '18:00', hours: 9, graceMins: 15, color: '#2563EB' }}
      fields={[
        { name: 'name', label: 'Shift Name' },
        { name: 'code', label: 'Code' },
        { name: 'start', label: 'Start Time', type: 'time' },
        { name: 'end', label: 'End Time', type: 'time' },
        { name: 'hours', label: 'Working Hours', type: 'number' },
        { name: 'graceMins', label: 'Grace Period (mins)', type: 'number' },
      ]}
      exportColumns={[
        { header: 'Name', accessor: 'name' }, { header: 'Code', accessor: 'code' },
        { header: 'Start', accessor: 'start' }, { header: 'End', accessor: 'end' },
        { header: 'Hours', accessor: 'hours' }, { header: 'Grace', accessor: 'graceMins' },
      ]}
      filename="shifts"
    />
  )
}
