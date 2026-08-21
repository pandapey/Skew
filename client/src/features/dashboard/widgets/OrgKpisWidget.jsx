import { useNavigate } from 'react-router-dom'
import { FiUsers, FiTrello, FiTarget, FiUserCheck } from 'react-icons/fi'
import { StatCard, CardSkeleton } from '@/components/ui'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

export default function OrgKpisWidget() {
  const navigate = useNavigate()
  const { data, isLoading } = useDashboardStats()

  if (isLoading) return <CardSkeleton />

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total Employees" value={data?.employees ?? 0} icon={FiUsers} trend={data?.trends?.employees} onClick={() => navigate('/employees')} />
      <StatCard label="Active Projects" value={data?.projects ?? 0} icon={FiTrello} tone="accent" trend={data?.trends?.projects} onClick={() => navigate('/projects')} />
      <StatCard label="Clients / Leads" value={data?.clients ?? 0} icon={FiTarget} tone="success" trend={data?.trends?.clients} onClick={() => navigate('/clients')} />
      <StatCard label="Pending Leaves" value={data?.pendingLeaves ?? 0} icon={FiUserCheck} tone="warning" trend={data?.trends?.pendingLeaves} onClick={() => navigate('/attendance/leave')} />
    </div>
  )
}
