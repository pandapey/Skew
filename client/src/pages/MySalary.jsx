import { useNavigate } from 'react-router-dom'
import {
  FiDollarSign, FiMinusCircle, FiCalendar, FiClock,
  FiShield, FiHeart, FiFileText, FiAlertCircle, FiWatch, FiInfo, FiClipboard,
  FiTrendingUp, FiCreditCard,
} from 'react-icons/fi'
import {
  PageHeader, Card, StatCard, Loader, EmptyState, Button,
} from '@/components/ui'
import { buildSalarySummaryCards, SalarySummaryCard } from '@/features/salary/components'
import { useMySalary } from '@/features/salary/salaryDocument'
import { formatCurrency } from '@/utils'

export default function MySalary() {
  const navigate = useNavigate()
  const { data, isLoading } = useMySalary({ portal: true })

  const current = data?.current
  const attendance = data?.attendance
  const meta = data?.meta || {}
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

  const cards = buildSalarySummaryCards(current, attendance, {
    FiDollarSign, FiMinusCircle, FiCalendar, FiClock,
    FiShield, FiHeart, FiAlertCircle, FiWatch,
    FiTrendingUp, FiCreditCard,
  })

  return (
    <div>
  <PageHeader
    title="Salary"
    subtitle={`Your personal salary portal${current.month ? ` \u00b7 ${current.month}` : ''}${current.source === 'computed' ? ' (from your salary structure)' : ''}.`}
    actions={
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" icon={FiClipboard} onClick={() => navigate('/salary/history')}>
            Salary History
          </Button>
          <Button variant="ghost" icon={FiFileText} onClick={() => navigate('/salary/report')}>
            Salary Report
          </Button>
        <SalarySummaryCard current={current} />
        </div>
      </div>
    }
  />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} format={c.format} icon={c.icon} tone={c.tone} />
        ))}
      </div>

      <Card>
        <div className="flex items-start gap-3">
          <FiInfo className="mt-0.5 h-5 w-5 flex-none text-accent" />
          <div className="text-sm text-muted">
            <p className="font-medium text-current">How your salary is calculated</p>
            <p className="mt-1">
              <span className="font-medium">Current Receivable Salary</span> is what you have earned so far this
              period: <span className="font-medium">{formatCurrency(current.daily_payable_amount || 0)}</span> per
              payable day × <span className="font-medium">{current.payable_days ?? 0}</span> payable day(s) ={' '}
                <span className="font-medium">{formatCurrency(current.receivable ?? current.receivable_total ?? 0)}</span>.
              Every month is treated as a 30-day salary month: your Net Monthly Salary (Gross − PF − ESI) is divided by
              30 to get the daily payable amount, and payable days are your{' '}
              <span className="font-medium">{basis.presentDays ?? 0}</span> present day(s) plus{' '}
              <span className="font-medium">{basis.approvedLeaveDays ?? 0}</span> approved paid leave day(s); absent,
              unrecorded and unpaid-leave days simply do not earn.
            </p>
            {Number(current.lwp_days) > 0 && (
              <p className="mt-1">
                <span className="font-medium">LOP</span>: {current.lwp_days} day(s) this period were unpaid
                (absent or unrecorded working days, and any approved unpaid leave). Each unpaid day is priced at your
                daily payable rate ({formatCurrency(current.daily_payable_rate || 0)}), giving a loss-of-pay
                amount of <span className="font-medium">{formatCurrency(current.lwp_deduction || 0)}</span>, which is
                included in your Total Deduction along with PF and ESI.
              </p>
            )}
            {Array.isArray(meta.removedDeductions) && meta.removedDeductions.length > 0 && (
              <p className="mt-1">
                Professional Tax and TDS/Income Tax are{' '}
                <span className="font-medium">no longer applied</span> to your salary. Total Deductions reflects only
                PF, ESI and any other deduction recorded against you.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}
