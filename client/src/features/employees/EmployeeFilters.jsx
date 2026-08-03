import { FiX } from 'react-icons/fi'
import { SearchInput, Select } from '@/components/ui'
import { DEPARTMENTS, EMPLOYEE_STATUS, SORT_OPTIONS } from './constants'

// Advanced filter + sort toolbar for the employee list.
export function EmployeeFilters({ filters, onChange, onReset }) {
  const set = (patch) => onChange({ ...filters, ...patch, page: 1 })
  const active = filters.department || filters.status || filters.search

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <SearchInput
        value={filters.search}
        onChange={(v) => set({ search: v })}
        placeholder="Search name, code, email…"
        className="lg:max-w-xs"
      />
      <Select
        value={filters.department}
        onChange={(e) => set({ department: e.target.value })}
        className="lg:w-52"
        options={[{ value: '', label: 'All Departments' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]}
      />
      <Select
        value={filters.status}
        onChange={(e) => set({ status: e.target.value })}
        className="lg:w-52"
        options={[{ value: '', label: 'All Status' }, ...EMPLOYEE_STATUS.map((s) => ({ value: s, label: s }))]}
      />
      <div className="flex items-center gap-2 lg:ml-auto">
        <span className="text-sm text-muted">Sort</span>
        <Select
          value={filters.sortBy}
          onChange={(e) => set({ sortBy: e.target.value })}
          className="lg:w-52"
          options={SORT_OPTIONS}
        />
        <button
          onClick={() => set({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
          className="btn-ghost px-3"
          title="Toggle sort order"
        >
          {filters.order === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        {active && (
          <button onClick={onReset} className="btn-ghost px-2 text-danger" title="Clear filters">
            <FiX />
          </button>
        )}
      </div>
    </div>
  )
}
