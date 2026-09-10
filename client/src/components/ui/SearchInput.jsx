import { FiSearch } from 'react-icons/fi'
import { cn } from '@/utils'

export function SearchInput({ value, onChange, placeholder = 'Search…', className, id = 'search', name = 'search' }) {
  return (
    <div className={cn('relative', className)}>
      <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        id={id}
        name={name}
        type="search"
        autoComplete="off"
        className="input pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  )
}
