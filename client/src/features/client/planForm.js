import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/adminApi'
import { ROLES } from '@/constants'

export const PLAN_WRITE_ROLES = [ROLES.ADMIN]

export const PLAN_QUERY_KEY = 'admin-plans'

export const PLAN_STATUSES = ['Active', 'Inactive']

export const planSchema = z.object({
  name: z.string().min(2, 'Plan name required'),
  code: z.string().optional(),
  description: z.string().optional(),
  price: z.coerce.number().min(0, 'Price cannot be negative').optional(),
  status: z.string().optional(),
})

export const PLAN_FORM_FIELDS = [
  { name: 'name', label: 'Plan Name', placeholder: 'Premium' },
  { name: 'code', label: 'Code', placeholder: 'PREM' },
  { name: 'price', label: 'Monthly Price (₹)', type: 'number', placeholder: '0' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: PLAN_STATUSES.map((s) => ({ value: s, label: s })),
  },
  { name: 'description', label: 'Description', type: 'textarea', full: true },
]

export const PLAN_FORM_DEFAULTS = {
  name: '', code: '', description: '', price: 0, status: 'Active',
}

export function usePlanOptions(currentValue, { enabled = true } = {}) {
  const { data = [], isLoading } = useQuery({
    queryKey: [PLAN_QUERY_KEY, 'options'],
    queryFn: () => adminApi.plans.all(),
    staleTime: 60_000,
    enabled,
    select: (res) => (Array.isArray(res) ? res : res?.data || []),
  })

  const options = data
    .filter((p) => p && p.name && (!p.status || p.status === 'Active'))
    .map((p) => ({ value: p.name, label: p.name }))

  const current = String(currentValue || '').trim()
  if (current && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: `${current} (no longer offered)` })
  }

  return { options, loading: isLoading }
}
