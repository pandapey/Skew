import { useNavigate } from 'react-router-dom'
// Phase 6.12 (TASK 7): FiChevronRight dropped along with the "View salary
// details" affordance it decorated - it has no other use in this file, so
// keeping the import would have left a dead import behind.
import { FiCreditCard } from 'react-icons/fi'
import { Badge } from '@/components/ui'
import { formatCurrency } from '@/utils'

// Part 5 — Employee Salary Summary (quick view).
//
// Premium compact card pinned to the top-right of the Salary page. It performs
// NO calculation of its own: every figure comes from the SAME payload the page
// already fetches from GET /hr/payroll/me/salary (react-query key ['my-salary']),
// so there is no duplicated math and no extra API call.
//
// Clicking it navigates to the full Salary page.
// Phase 6.7 (TASK 3) ROOT CAUSE: the default target was '/my-salary', a route
// that DOES NOT EXIST anywhere in client/src/routes/index.jsx - the Salary module
// is registered as route('/salary', MySalary, [ROLES.EMPLOYEE]). Neither caller
// (dashboard SalaryWidget, MySalary PageHeader) passes a `to`, so every click on
// the Salary Summary card body navigated to a dead path instead of the Salary
// module. Fixed by defaulting to the EXISTING '/salary' route - no new page and
// no new route is introduced for this.
export function SalarySummaryCard({ current, to = '/salary' }) {
  const navigate = useNavigate()
  if (!current) return null

  const isPaid = current.status === 'Paid'

  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      aria-label={`Salary summary for ${current.month || 'the current month'}. Open the salary page.`}
      className="group relative w-full overflow-hidden rounded-card border border-app bg-gradient-to-br from-primary/10 via-transparent to-accent/10 p-4 text-left shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-floating focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:w-[300px]"
    >
      {/* Header: current month + payment status */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FiCreditCard className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-xs text-muted">Salary Summary</p>
            <p className="text-sm font-semibold">{current.month || '\u2014'}</p>
          </div>
        </div>
        <Badge tone={isPaid ? 'success' : 'warning'}>{current.status || 'Pending'}</Badge>
      </div>

      {/* Figures */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-muted">Net Salary</p>
          <p className="truncate text-base font-bold text-primary">{formatCurrency(current.net)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Receivable</p>
          <p className="truncate text-base font-bold">{formatCurrency(current.receivable)}</p>
        </div>
      </div>
      {/* Phase 6.12 (TASK 7): the "View salary details" footer line was REMOVED
          from the Salary Summary. The whole card is still a <button> that
          navigates to `to` (default '/salary'), and its aria-label already
          states that, so removing the redundant caption costs no affordance and
          no accessibility - it only removes duplicated wording. */}
    </button>
  )
}
