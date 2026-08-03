// Phase 6.12 (TASK 5): the long salary icon list that used to be imported here
// (FiDollarSign, FiTrendingUp, FiMinusCircle, FiLogIn, FiClock, FiUmbrella,
// FiZap, FiHeart, FiPercent, FiCreditCard) existed ONLY to be handed to
// buildSalarySummaryCards(). The Salary tab now renders through the shared
// <SalaryTab/> viewer, which supplies its own presentation, so those icons have
// zero remaining references in this file and were removed rather than left as
// dead imports.
import {
  FiMail, FiBriefcase, FiCalendar, FiHash, FiShield, FiUser,
  FiExternalLink,
} from 'react-icons/fi'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
// PHASE ADMIN (TASK 5): needed for the role-aware tab configuration below.
import { ROLES } from '@/constants'
import { hrApi } from '@/api/services'
// Phase 6.12 (TASK 5): the Salary tab now renders the EXACT component
// Admin / HR / Manager already use to view an employee's salary - <SalaryTab/>
// from the Employee Detail page. It is imported, not copied, so the Salary
// Breakdown / Annual CTC / Bank Details layout can never drift between the
// staff-facing view and the employee's own view.
import { SalaryTab } from '@/features/employees/detailTabs'
// Phase 6.12 (TASK 5): `StatCard` was dropped from this import - the salary
// StatCard grid it rendered is gone, and no other block on this page uses it.
import { PageHeader, Card, CardHeader, Badge, Tabs, Loader, EmptyState, Button } from '@/components/ui'
import { useState } from 'react'
import { ChangePasswordCard } from '@/features/profile/ChangePasswordCard'
// Phase 6.3 (Task 9): the profile-picture uploader that used to be written out
// inline in this file now lives in ONE shared component, so the Client profile
// can render the identical flow instead of duplicating the upload code.
import { AvatarUploader } from '@/features/profile/AvatarUploader'
import { formatDate } from '@/utils'

// Phase 6.3 (Task 11): `ACCEPTED`, `MAX_BYTES` and the `toast`, `authService`,
// `Button`, `Avatar`, `useRef`, FiCamera / FiUpload / FiX imports were removed
// from this file - they moved into features/profile/AvatarUploader.jsx together
// with the logic they existed to serve, and have zero remaining references here.

export default function Profile() {
  const { user } = useAuth()
  // Phase 6.4 (TASK 8): the Attendance and Leave History tabs (and their
  // ['profile-attendance']/['profile-leave'] queries) were removed - that
  // history is fully owned by the dedicated Attendance and Leave modules, so
  // this page no longer keeps a second, partial copy of it. Overview,
  // Avatar, Password Change and Personal Details are unchanged.
  const [tab, setTab] = useState('overview')

  // PHASE ADMIN (TASK 5) ROOT CAUSE: the <Tabs> `items` array below was STATIC.
  // `{ key: 'salary', label: 'Salary' }` was hardcoded for every role, so the
  // Admin profile rendered a Salary tab (and its SalaryPanel, which fires a
  // /hr/payroll/me/salary request and offers an "Open Full Salary" button) even
  // though an Admin has no payroll record of their own.
  //
  // Profile.jsx is a SHARED page used by all staff roles, so the fix is
  // role-aware configuration rather than deleting the salary UI globally:
  // SalaryPanel, SalaryTab, the /salary route and the whole payroll module are
  // untouched and continue to work exactly as before for Employee, HR and
  // Manager. Only the Admin's view of this page loses the tab.
  //
  // RBAC is deliberately NOT touched. `/salary` keeps its existing STAFF_ROLES
  // guard - tightening it here would change salary permissions, which the brief
  // forbids. Admin simply has no link to it from this page any more, so there
  // is no broken navigation.
  const showSalary = user?.role !== ROLES.ADMIN

  // Phase 6.3 (Task 9): pickFile / cancelPreview / savePicture were moved
  // verbatim into <AvatarUploader/>. The behaviour is unchanged - same guards,
  // same authService.uploadAvatar call, same patchUser() so the Navbar updates
  // instantly - it is simply no longer duplicated per profile page.

  // Only real, authenticated user fields — no placeholder data. Empty fields are
  // hidden rather than faked.
  const joined = user?.joinDate || user?.dateOfJoining || user?.createdAt
  const info = [
    { icon: FiMail, label: 'Email', value: user?.email },
    { icon: FiBriefcase, label: 'Department', value: user?.department },
    { icon: FiUser, label: 'Designation', value: user?.designation },
    { icon: FiShield, label: 'Role', value: user?.role },
    // Phase 5 (Task 1): gender is shown on the profile. The trailing
    // `.filter((i) => i.value)` means a legacy account with no gender simply
    // omits the row rather than rendering an empty field.
    { icon: FiUser, label: 'Gender', value: user?.gender },
    { icon: FiHash, label: 'Employee ID', value: user?.employeeId || user?.empId },
    { icon: FiCalendar, label: 'Joined', value: joined ? formatDate(joined) : null },
  ].filter((i) => i.value)

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your personal and work information." />

      <Card className="mb-4 overflow-hidden p-0">
        <div className="h-28 bg-gradient-to-r from-primary to-accent" />
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
          {/* Phase 6.3 (Task 9): shared uploader - preview, save, remove and the
              allowed-formats hint all live inside it now. */}
          <div className="-mt-16">
            <AvatarUploader name={user?.name} size={96} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{user?.name}</h2>
            <p className="text-muted">{user?.designation} · <Badge tone="primary">{user?.role}</Badge></p>
          </div>
        </div>
      </Card>

      <Tabs className="mb-4" value={tab} onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview' },
          // Phase 5.5 (Task 1): password change lives as a tab on the EXISTING
          // profile page rather than a new route, per "no duplicate profile pages".
          // Phase 6.4 (TASK 8): Attendance and Leave History tabs removed.
          { key: 'security', label: 'Security' },
          // Phase 6.9 (TASK 7): Salary is now a tab on My Profile instead of a
          // separate sidebar destination.
          // PHASE ADMIN (TASK 5): hidden for Admin via role-aware config. The
          // entry is filtered OUT of the array rather than hidden with CSS, so
          // the tab genuinely does not exist for an Admin. Tabs lays itself out
          // from this array, so the remaining two tabs close up naturally with
          // no gap and no fixed sizing.
          ...(showSalary ? [{ key: 'salary', label: 'Salary' }] : []),
        ]} />

      {tab === 'overview' && (
        <Card>
          <CardHeader title="Personal Information" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {info.map((i) => (
              <div key={i.label} className="flex items-center gap-3 rounded-xl border border-app p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><i.icon /></div>
                <div><p className="text-xs text-muted">{i.label}</p><p className="text-sm font-medium">{i.value}</p></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'security' && <ChangePasswordCard />}

      {/* Phase 6.9 (TASK 7): rendered only when the tab is active, so visiting
          My Profile does not fire a payroll request for everyone. */}
      {/* PHASE ADMIN (TASK 5): `showSalary` guards the panel as well as the tab.
          Belt and braces - without it, any future path that sets tab='salary'
          (a restored state, a deep link) could still mount SalaryPanel for an
          Admin and fire the payroll query. */}
      {tab === 'salary' && showSalary && <SalaryPanel />}
    </div>
  )
}

// Phase 6.9 (TASK 7) — Salary merged into My Profile.
//
// This reuses the EXISTING self-service payroll endpoint
// (hrApi.payroll.mySalary -> GET /hr/payroll/me/salary) and the EXISTING
// ['my-salary'] react-query key, so it shares one cache with pages/MySalary.jsx
// and the Salary History / Salary Report pages - no second request, no second
// payroll engine, no recalculated figures.
//
// RBAC: the endpoint is scoped server-side to the session identity and returns
// ONLY the caller's own salary, so this tab can never expose another person's
// pay. A staff member with no payroll record simply gets the existing empty
// state rather than a fabricated figure.
function SalaryPanel() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['my-salary'], queryFn: () => hrApi.payroll.mySalary() })

  const current = data?.current
  const identity = data?.identity

  if (isLoading) return <Loader label="Loading your salary…" />

  if (!current) {
    return (
      <Card>
        <EmptyState
          title="No salary information found"
          description="Your salary structure has not been set up yet. Please contact HR."
        />
      </Card>
    )
  }

  // Phase 6.12 (TASK 5): adapt the self-service payroll payload to the shape
  // <SalaryTab/> already expects ({ salary, bank }). This is a field MAPPING
  // only - every figure is passed straight through from the server response
  // produced by payrollEngine.computePayroll(); nothing is recomputed here and
  // no salary component is redefined. The per-component values come from
  // `current` (the live, attendance-aware current-period figures) while `ctc`,
  // `monthly` and `bank` come from `identity`, which now carries them (see
  // GET /hr/payroll/me/salary in server/src/routes/hrRoutes.js).
  const employeeView = {
    salary: {
      basic: current.basic,
      hra: current.hra,
      allowances: current.allowances,
      pf: current.pf,
      tax: current.tax,
      net: current.net,
      ctc: identity?.ctc || 0,
      monthly: identity?.monthly || 0,
    },
    bank: identity?.bank || null,
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Phase 6.12 (TASK 6): one action button that opens the full Salary
            module. It reuses the EXISTING '/salary' route (registered in
            routes/index.jsx and already reachable by this role) - no new route,
            no new page and no duplicated salary screen. */}
        <Button icon={FiExternalLink} onClick={() => navigate('/salary')}>Open Full Salary</Button>
        {/* Phase 6.19 (TASK 4) ROOT CAUSE FIX: the "Salary History" / "Salary
            Report" buttons that used to sit here duplicated entry points the
            dedicated Salary module already owns (routes '/salary/history' and
            '/salary/report' are untouched and still reachable directly, e.g.
            from the Salary module itself) \u2014 My Profile only needs the ONE
            existing hand-off into that module, which "Open Full Salary"
            already provides. Removed rather than left as duplicate salary
            navigation; the summary view below (<SalaryTab/>) is unchanged. */}
      </div>
      {/* The SAME viewer Admin/HR/Manager see on the Employee Detail page. */}
      <SalaryTab employee={employeeView} />
    </div>
  )
}
