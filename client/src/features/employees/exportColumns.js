// Shared column spec for employee exports (CSV/Excel/PDF).
import { formatCurrency } from '@/utils'

// Handles both flat mock records and detailed records (salary as object).
const ctcOf = (e) => (typeof e.salary === 'object' ? e.salary.ctc : e.salary)

export const employeeExportColumns = [
  { header: 'Emp Code', accessor: 'empCode' },
  { header: 'Name', accessor: 'name' },
  { header: 'Email', accessor: 'email' },
  { header: 'Phone', accessor: 'phone' },
  { header: 'Department', accessor: 'department' },
  { header: 'Designation', accessor: 'designation' },
  { header: 'CTC', accessor: (e) => formatCurrency(ctcOf(e)) },
  { header: 'Joined', accessor: 'joiningDate' },
  { header: 'Status', accessor: 'status' },
]
