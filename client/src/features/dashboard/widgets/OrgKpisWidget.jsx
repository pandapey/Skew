import { FiUsers, FiTrello, FiTarget, FiUserCheck } from 'react-icons/fi'
import { StatCard, CardSkeleton } from '@/components/ui'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'

// Organization-wide KPI row \u2014 headcount, active projects, clients/leads and
// pending leaves. Registry-gated to ORG_VISIBILITY_ROLES so individual
// employees never see org financum/headcount clutter on their dashboard.
export default function OrgKpisWidget() {
  const { data, isLoading } = useDashboardStats()

  if (isLoading) return <CardSkeleton />

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total Employees" value={data?.employees ?? 0} icon={FiUsers} trend={data?.trends?.employees} />
      <StatCard label="Active Projects" value={data?.projects ?? 0} icon={FiTrello} tone="accent" trend={data?.trends?.projects} />
      <StatCard label="Clients / Leads" value={data?.clients ?? 0} icon={FiTarget} tone="success" trend={data?.trends?.clients} />
      <StatCard label="Pending Leaves" value={data?.pendingLeaves ?? 0} icon={FiUserCheck} tone="warning" trend={data?.trends?.pendingLeaves} />
    </div>
  )
}
