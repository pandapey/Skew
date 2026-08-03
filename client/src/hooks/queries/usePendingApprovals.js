import { useQuery } from '@tanstack/react-query'
import { leaveApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'

// Only Admin / HR / Manager can see the org-wide approvals
// inbox server-side (server/src/routes/leaveRoutes.js `canApprove` guard).
// Mirrored here so the query is only fired for roles that can actually read
// it — avoids a guaranteed 403 for everyone else.
const APPROVAL_ROLES = [ROLES.ADMIN, ROLES.HR, ROLES.MANAGER]

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
