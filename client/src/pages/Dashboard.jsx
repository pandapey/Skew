import { useAuth } from '@/hooks/useAuth'
import { ROLES } from '@/constants'
import EmployeeWorkspaceDashboard from './EmployeeWorkspaceDashboard'
import ClassicDashboard from './ClassicDashboard'

// Role-aware /dashboard entry point.
//
// Only the Employee role sees the upgraded, personalized workspace dashboard
// (widgets, quick actions, profile summary). Every other role — Admin, HR,
// Manager, Client — keeps the original
// organization dashboard exactly as it was before the upgrade.
export default function Dashboard() {
  const { user } = useAuth()
  return user?.role === ROLES.EMPLOYEE ? <EmployeeWorkspaceDashboard /> : <ClassicDashboard />
}
