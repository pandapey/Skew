import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FiX } from 'react-icons/fi'
import { SearchInput, Select } from '@/components/ui'
import { hrApi } from '@/api/services'
import { DEPARTMENTS, EMPLOYEE_STATUS, SORT_OPTIONS } from './constants'

export function EmployeeFilters({ filters, onChange, onReset }) {
  const set = (patch) => onChange({ ...filters, ...patch, page: 1 })
  const active = filters.department || filters.status || filters.search

  // Fix: department filter must reflect departments added in HR > Departments,
  // not the hardcoded DEPARTMENTS list. Fall back to hardcoded when API is empty.
  const { data: deptData = [] } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => hrApi.departments.all(),
    staleTime: 60_000,
  })
  const departmentOptions = useMemo(() => {
    const rows = Array.isArray(deptData) ? deptData : []
    const names = rows.map((d) => d?.name).filter(Boolean)
    const list = names.length ? names : DEPARTMENTS
    return [{ value: '', label: 'All Departments' }, ...list.map((d) => ({ value: d, label: d }))]
  }, [deptData])

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
        options={departmentOptions}
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
