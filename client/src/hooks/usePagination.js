import { useState, useMemo } from 'react'

// Client-side pagination helper for tables backed by arrays.
export function usePagination(items = [], perPage = 8) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / perPage))

  const paged = useMemo(() => {
    const start = (page - 1) * perPage
    return items.slice(start, start + perPage)
  }, [items, page, perPage])

  const goTo = (p) => setPage(Math.min(Math.max(1, p), totalPages))

  return { page, totalPages, paged, setPage: goTo, next: () => goTo(page + 1), prev: () => goTo(page - 1) }
}
