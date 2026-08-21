import { useQuery } from '@tanstack/react-query'
import { projectApi } from '@/api/services'
import { useAuth } from '@/hooks/useAuth'

export function useMyTasks() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['tasks', 'mine', user?._id],
    queryFn: () => projectApi.tasks({ assignee: user.name }),
    enabled: !!user?.name,
  })
}
