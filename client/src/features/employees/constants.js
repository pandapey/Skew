// DEPARTMENTS is still used by the employee LIST FILTER (EmployeeFilters.jsx)
// and by features/reports/aggregate.js, so it stays.
export const DEPARTMENTS = ['Engineering', 'Sales', 'Human Resources', 'Finance', 'Marketing', 'Support', 'Operations']
// PHASE NEXT (TASK 1 cleanup): DESIGNATIONS was deleted. Its ONLY consumer was
// EmployeeFormModal, which now reads the real Designation records from
// hrApi.designations, so the constant became dead code. Verified unreferenced
// across client/src and server/src by repository-wide grep.
export const EMPLOYMENT_TYPES = ['Full-time', 'Contract', 'Intern', 'Consultant']
export const EMPLOYEE_STATUS = ['Active', 'On Leave', 'Inactive']
export const WORK_LOCATIONS = ['Bengaluru HQ', 'Mumbai Office', 'Remote']

export const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'empCode', label: 'Employee Code' },
  { value: 'department', label: 'Department' },
  { value: 'salary', label: 'Salary' },
  { value: 'joiningDate', label: 'Joining Date' },
  { value: 'performance', label: 'Performance' },
]
