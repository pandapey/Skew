import { forwardRef, useRef, useEffect } from 'react'
import { FiChevronUp, FiChevronDown, FiChevronsUp } from 'react-icons/fi'
import { cn } from '@/utils'
import { EmptyState } from './EmptyState'
import { TableSkeleton } from './Skeleton'

// Small checkbox that supports the indeterminate (mixed) state.
const RowCheckbox = forwardRef(function RowCheckbox({ checked, indeterminate, ...props }, ref) {
  const innerRef = useRef(null)
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return <input ref={(n) => { innerRef.current = n; if (typeof ref === 'function') ref(n); else if (ref) ref.current = n }} type="checkbox" checked={checked} {...props} />
})

// Generic data table. columns: [{ key, header, render?, className?, sortable?, sortKey? }]
// Rendered inside a glass-friendly solid-surface container with a frosted,
// sticky header (per the "glass container + solid table" requirement).
//
// Optional enterprise features (all additive / backwards-compatible):
//  - selectable: render a leading checkbox column + select-all header.
//  - sortable columns: set `sortable: true` (and optional `sortKey`) on a column,
//    then pass `sort` ({ key, order }) + `onSort(key)` to drive server/client sort.
export function DataTable({
  columns,
  data,
  loading,
  onRowClick,
  empty = 'No records found',
  className,
  selectable = false,
  selectedIds = [],
  onRowSelect,
  onSelectAll,
  getRowId = (r) => r.id,
  sort,
  onSort,
}) {
  if (loading) return <TableSkeleton cols={columns.length + (selectable ? 1 : 0)} />
  if (!data?.length) return <EmptyState title={empty} />

  const selected = new Set(selectedIds)
  const allSelected = data.length > 0 && data.every((r) => selected.has(getRowId(r)))
  const someSelected = data.some((r) => selected.has(getRowId(r)))

  const headerCell = (col) => {
    if (col.sortable) {
      const key = col.sortKey || col.key
      const active = sort?.key === key
      const dir = active ? sort?.order : null
      return (
        <th
          key={col.key}
          scope="col"
          style={{ background: 'var(--glass-bg-strong)' }}
          className={cn('sticky top-0 z-10 whitespace-nowrap bg-clip-padding px-4 py-3.5 font-semibold backdrop-blur', col.className)}
          aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
          <button
            type="button"
            onClick={() => onSort?.(key)}
            className="inline-flex items-center gap-1 font-semibold text-muted transition hover:text-current focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
            aria-label={`Sort by ${col.header}`}
          >
            {col.header}
            {dir === 'asc' ? (
              <FiChevronUp className="h-3.5 w-3.5 text-primary" />
            ) : dir === 'desc' ? (
              <FiChevronDown className="h-3.5 w-3.5 text-primary" />
            ) : (
              <FiChevronsUp className="h-3.5 w-3.5 opacity-40" />
            )}
          </button>
        </th>
      )
    }
    return (
      <th
        key={col.key}
        scope="col"
        style={{ background: 'var(--glass-bg-strong)' }}
        className={cn('sticky top-0 z-10 whitespace-nowrap bg-clip-padding px-4 py-3.5 font-semibold backdrop-blur', col.className)}
      >
        {col.header}
      </th>
    )
  }

  return (
    <div className={cn('overflow-hidden rounded-[20px] border border-app bg-surface', className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-app text-left text-muted">
              {selectable && (
                <th scope="col" className="sticky top-0 z-10 w-10 bg-surface px-3 py-3.5 backdrop-blur">
                  <RowCheckbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={(e) => onSelectAll?.(e.target.checked)}
                    aria-label="Select all rows"
                    className="h-4 w-4 cursor-pointer rounded border-app text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  />
                </th>
              )}
              {columns.map(headerCell)}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const id = getRowId(row)
              const isSelected = selected.has(id)
              return (
                <tr
                  key={id || i}
                  onClick={() => onRowClick?.(row)}
                  aria-selected={selectable ? isSelected : undefined}
                  className={cn(
                    'border-b border-app transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-primary/[0.05]',
                    isSelected && 'bg-primary/[0.06]'
                  )}
                >
                  {selectable && (
                    <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <RowCheckbox
                        checked={isSelected}
                        onChange={() => onRowSelect?.(id, !isSelected)}
                        aria-label={`Select ${row.name || id}`}
                        className="h-4 w-4 cursor-pointer rounded border-app text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={cn('whitespace-nowrap px-4 py-3', col.className)}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
