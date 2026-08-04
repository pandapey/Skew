import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  FiDollarSign, FiTrendingUp, FiMinusCircle, FiCalendar, FiLogIn, FiClock,
  FiUmbrella, FiZap, FiShield, FiHeart, FiPercent, FiFileText, FiCreditCard, FiInfo, FiClipboard,
} from 'react-icons/fi'
import { hrApi } from '@/api/services'
import {
  PageHeader, Card, StatCard, Loader, EmptyState, Button,
} from '@/components/ui'
import { SalarySummaryCard } from '@/features/hr/SalarySummaryCard'
import { buildSalarySummaryCards } from '@/features/salary/components'

// Phase 6.7 (Issue 6) / Phase 6.8 (TASK 3) — Employee "My Salary" portal.
//
// This is NOT the HR Payroll admin page: it shows ONLY the logged-in
// employee's own salary, served by GET /hr/payroll/me/salary which scopes
// strictly to the session identity. Every figure is real data from MongoDB,
// computed exclusively by server/src/services/payrollEngine.js -> computePayroll().
// This page performs NO calculation and NO field mapping of its own — it reads
// the payload straight from react-query and hands it to the shared
// buildSalarySummaryCards() helper (features/salary/components.jsx), the same
// shared salary mapper/component layer every other salary surface uses.
//
// Phase 6.8 (TASK 3) ROOT CAUSE: the Salary page used to embed a full inline
// "Salary History" table, a "Salary Reports" (Monthly/Quarterly/Yearly) block
// AND a "Salary Slip" filter/export block directly on this page — duplicating
// exactly the information the dedicated /salary/history and /salary/report
// pages already existed to show, and duplicating the month-parsing/rollup
// logic that now lives once in features/salary/salaryDocument.js. FIX: this
// page now only shows the at-a-glance summary (StatCards) and links out to
// the dedicated Salary History and Salary Report pages, which own that
// content exclusively.
export default function MySalary() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['my-salary'], queryFn: () => hrApi.payroll.mySalary() })

  const current = data?.current
  const attendance = data?.attendance
  const meta = data?.meta || {}
  // Phase 6.12 (TASK 10): the server now reports exactly which attendance
  // figures drove the loss-of-pay deduction. Read-only - see the note below.
  const basis = meta.attendanceBasis || {}

  if (isLoading) return <Loader label="Loading your salary\u2026" />

  if (!current) {
    return (
      <div>
        <PageHeader title="Salary" subtitle="Your personal salary portal." />
        <Card>
          <EmptyState title="No salary information found" description="Your salary structure has not been set up yet. Please contact HR." />
        </Card>
      </div>
    )
  }

  // Single shared card-definition source (features/salary/components.jsx) —
  // no card list is redefined per page.
  const cards = buildSalarySummaryCards(current, attendance, {
    FiDollarSign, FiTrendingUp, FiMinusCircle, FiCalendar, FiLogIn, FiClock,
    FiUmbrella, FiZap, FiShield, FiHeart, FiPercent, FiCreditCard,
  })

  return (
    <div>
      {/* Part 5: premium Salary Summary quick-view, pinned top-right. It reuses
          the SAME ['my-salary'] payload already loaded above — no extra request
          and no recalculated figures. */}
      <PageHeader
        title="Salary"
        subtitle={`Your personal salary portal${current.month ? ` \u00b7 ${current.month}` : ''}${current.source === 'computed' ? ' (from your salary structure)' : ''}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Phase 6.8 (TASK 3): the ONLY two entry points from the Salary page
                now are the dedicated Salary History and Salary Report pages.
                There is no separate Salary Slip destination anymore — its
                content was merged into Salary Report (see that page). Both
                navigate to pages that reuse THIS page's ['my-salary']
                react-query cache — no extra request, no recalculated figures,
                no second payroll engine. */}
            <Button variant="ghost" icon={FiClipboard} onClick={() => navigate('/salary/history')}>
              Salary History
            </Button>
            <Button variant="ghost" icon={FiFileText} onClick={() => navigate('/salary/report')}>
              Salary Report
            </Button>
            <SalarySummaryCard current={current} />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} tone={c.tone} />
        ))}
      </div>

      {/* Honesty note. Phase 6.12 (TASK 10): this card now also explains how
          unpaid days reached Net Salary, so the card is shown whenever there is
          something worth explaining - either an unmodelled field OR a real
          loss-of-pay deduction. Every value below is READ from the server
          response (meta.attendanceBasis, produced by attendanceService.mySummary
          and consumed by payrollEngine.computePayroll). Nothing here is
          recomputed in React. */}
      {(!meta.esiTracked || !meta.otherDeductionsTracked || Number(basis.payableAbsentDays) > 0) && (
        <Card>
          <div className="flex items-start gap-3">
            <FiInfo className="mt-0.5 h-5 w-5 flex-none text-accent" />
            <div className="text-sm text-muted">
              <p className="font-medium text-current">About some figures</p>
              {(!meta.esiTracked || !meta.otherDeductionsTracked) && (
                <p className="mt-1">
                  ESI and Other Deductions are not modelled in the current payroll records, so they are shown as
                  <span className="font-medium"> N/A</span> rather than a fabricated value. Total Deductions reflects the
                  real PF + Tax stored for the period. Payment Date is taken from a payroll record&apos;s paid timestamp when
                  its status is <span className="font-medium">Paid</span>. Working / Present / Absent / Leave days and
                  Overtime are computed from your own attendance records.
                </p>
              )}
              {Number(basis.payableAbsentDays) > 0 && (
                <p className="mt-1">
                  Your Net Salary for this period reflects{' '}
                  <span className="font-medium">{basis.payableAbsentDays}</span> unpaid day(s). This period has{' '}
                  <span className="font-medium">{basis.expectedWorkingDays}</span> working day(s) once Sundays and{' '}
                  <span className="font-medium">{basis.companyHolidays}</span> company holiday(s) are excluded, against{' '}
                  <span className="font-medium">{basis.presentDays}</span> present and{' '}
                  <span className="font-medium">{basis.approvedLeaveDays}</span> approved leave day(s). Approved leave is
                  paid; absent and unrecorded working days are not.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
