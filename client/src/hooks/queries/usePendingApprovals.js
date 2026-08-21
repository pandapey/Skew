import { useQuery } from '@tanstack/react-query'
import { leaveApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

const APPROVAL_ROLES = [ROLES.ADMIN, ROLES.MANAGER]

export function usePendingApprovals() {
  const { hasRole } = useAuth()
  const enabled = hasRole(APPROVAL_ROLES)
  return useQuery({
    queryKey: ['leave', 'requests', { status: 'Pending' }],
    queryFn: () => leaveApi.query({ status: 'Pending', limit: 5 }),
    enabled,
    staleTime: 30_000,
  })
}
