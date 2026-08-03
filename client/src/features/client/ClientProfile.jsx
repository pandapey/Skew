import { useQuery } from '@tanstack/react-query'
import { FiBriefcase, FiUser, FiMail, FiPhone, FiMapPin, FiShield, FiCreditCard } from 'react-icons/fi'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { PageHeader, Card, CardHeader, Badge, Loader, EmptyState } from '@/components/ui'
import { ChangePasswordCard } from '@/features/profile/ChangePasswordCard'
// Phase 6.3 (Task 9): the SAME uploader the staff profile renders. `Avatar` is
// no longer imported here because <AvatarUploader/> renders it internally.
import { AvatarUploader } from '@/features/profile/AvatarUploader'
import { fmtDate } from './constants'

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/5 text-muted dark:bg-white/10"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p className="truncate text-sm font-medium">{value || '—'}</p>
      </div>
    </div>
  )
}

export default function ClientProfile() {
  const { user } = useAuth()
  const { data: profile, isLoading } = useQuery({ queryKey: ['client-profile'], queryFn: () => clientService.getProfile(user) })

  if (isLoading) return <Loader label="Loading profile…" />
  if (!profile) return <EmptyState title="Profile unavailable" />

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your organization's account details." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            {/* Phase 6.3 (TASK 9): was a bare read-only <Avatar name={...} size={80} />
                with no input, no handler and no mutation - which is why a Client
                could never set a picture even though POST /auth/me/avatar was
                already open to them (`protect` only, not blockClient). Now the
                shared uploader: upload, change, delete, preview, persistence and
                immediate Navbar refresh, with zero duplicated upload code.

                The picture belongs to the signed-in User account, while the
                surrounding card shows the Client ORGANISATION profile - so the
                contact person's name is passed purely for the initials
                fallback. */}
            <AvatarUploader name={profile.contactPerson} size={80} />
            <p className="mt-3 text-lg font-bold">{profile.contactPerson}</p>
            <p className="text-sm text-muted">{profile.designation}</p>
            <Badge tone={profile.status === 'Active' ? 'success' : 'warning'} className="mt-2">{profile.status}</Badge>
          </div>
          <div className="mt-4 border-t border-app pt-2">
            <Row icon={FiBriefcase} label="Company" value={profile.company} />
            {/* Phase 6.9 (TASK 10): the Account Manager row is removed. FiUser is
                still imported because the "Joined" row below uses it. */}
            <Row icon={FiShield} label="Current Plan" value={profile.plan} />
            <Row icon={FiCreditCard} label="GST Number" value={profile.gst} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Company Details" />
          <Row icon={FiMail} label="Business Email" value={profile.email} />
          <Row icon={FiPhone} label="Phone Number" value={profile.phone} />
          <Row icon={FiMapPin} label="Address" value={profile.address} />
          <Row icon={FiBriefcase} label="Industry" value={profile.industry} />
          <Row icon={FiCreditCard} label="Website" value={profile.website} />
          <Row icon={FiShield} label="Account Status" value={profile.status} />
          <Row icon={FiUser} label="Joined" value={fmtDate(profile.joinedDate)} />
        </Card>
      </div>

      {/* Phase 5.5 (Task 1): Clients can rotate their own password too. This is
          the SAME component the staff profile renders — one implementation,
          reused, rather than a Client-specific copy. */}
      <div className="mt-4">
        <ChangePasswordCard />
      </div>

      {/* Phase 6.9 (TASK 10): no longer names an account manager - the role does
          not exist in the system any more, so pointing at one would be dead
          guidance. */}
      <p className="mt-3 text-xs text-muted">Need to update your company details? Send a message to your project team from the Messages page.</p>
    </div>
  )
}
