import { EntityManager } from '@/features/hr/EntityManager'
import { attendanceApi } from '@/api/services'
import { Badge } from '@/components/ui'
import { HOLIDAY_TYPES, ATTENDANCE_WRITE_ROLES } from '@/features/attendance/constants'
import { formatDate } from '@/utils'
import { z } from 'zod'

const holidaySchema = z.object({
  name: z.string().min(1, 'Holiday name required'),
  date: z.string().min(1, 'Date required'),
  type: z.string().optional(),
  day: z.string().optional(),
})

export default function Holidays() {
  const columns = [
    { key: 'name', header: 'Holiday', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
    { key: 'day', header: 'Day' },
    { key: 'type', header: 'Type', render: (r) => <Badge tone="primary">{r.type}</Badge> },
  ]
  return (
    <EntityManager
      title="Holiday Calendar"
      // Phase 5.9 (Task 7): was inheriting EntityManager's HR_WRITE_ROLES
      // default (['Admin','HR']), which hid the Edit/Delete buttons from
      // Managers even though holidays are attendance data that
      // ATTENDANCE_WRITE_ROLES already authorises them to write.
      writeRoles={ATTENDANCE_WRITE_ROLES}
      subtitle="Company holidays and observances for the year."
      addLabel="Add Holiday"
      api={attendanceApi.holidays}
      queryKey="attendance-holidays"
      columns={columns}
      schema={holidaySchema}
      defaultValues={{ name: '', date: '', type: 'Public', day: '' }}
      filters={[{ name: 'type', label: 'All Types', options: HOLIDAY_TYPES }]}
      fields={[
        { name: 'name', label: 'Holiday Name' },
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'day', label: 'Day (e.g. Monday)' },
        { name: 'type', label: 'Type', type: 'select', options: HOLIDAY_TYPES },
      ]}
      exportColumns={[
        { header: 'Name', accessor: 'name' }, { header: 'Date', accessor: 'date' },
        { header: 'Day', accessor: 'day' }, { header: 'Type', accessor: 'type' },
      ]}
      filename="holidays"
    />
  )
}
