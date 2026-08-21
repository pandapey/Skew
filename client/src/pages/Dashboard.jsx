import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import EmployeeWorkspaceDashboard from './EmployeeWorkspaceDashboard'
import ClassicDashboard from './ClassicDashboard'

export default function Dashboard() {
  const { user } = useAuth()
  return user?.role === ROLES.EMPLOYEE ? <EmployeeWorkspaceDashboard /> : <ClassicDashboard />
}
