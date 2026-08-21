import { useQuery } from '@tanstack/react-query'
import { FiDownload, FiFileText, FiCreditCard, FiCheckCircle } from 'react-icons/fi'
import toast from 'react-hot-toast'
import { formatCurrency } from '@/utils'
import { useAuth } from '@/hooks/useAuth'
import { clientService } from './clientService'
import { PageHeader, Card, CardHeader, StatCard, Badge, Loader, EmptyState, Button } from '@/components/ui'
import { fmtDate, PAYMENT_STATUS_TONE, downloadTextFile, summarizeBilling } from './constants'

// =============================================================================
// Phase 6.10 (TASK 3) — "payments.reduce is not a function" / Unexpected
// Application Error.
//
// REAL ROOT CAUSE (a broken backend<->frontend contract, not a bad guard):
//   Phase 6.9 (Task 18) changed clientController.buildBillingRows() — the single
//   assembler behind GET /client/payments — from returning a bare ARRAY to
//   returning an OBJECT: { rows, advancePayment, monthlyDue }. It had to: the
//   client's stored advancePayment / monthlyDue terms cannot ride along on an
//   array (JSON.stringify drops properties set on arrays), which is exactly why
//   those two figures had never reached the portal.
//
//   getAllPayments() res.json()s that object straight through, but NO consumer
//   was migrated. This component did:
//       const { data: payments = [] } = useQuery(...)   // data === the OBJECT
//       payments.reduce(...)                            // objects have no reduce
//   The default `= []` only applies while data is undefined, so the very first
//   render after the fetch resolved threw TypeError, and because the throw
//   happened inside a route element with no errorElement, React Router replaced
//   the whole screen with its default crash page.
//
//   `payments` is therefore not "sometimes" a non-array — it is ALWAYS an
//   object. Array.isArray() would have suppressed the crash and left every card
//   reading ₹0 forever, i.e. it would have hidden the schema mismatch instead of
//   fixing it. The fix is to consume the documented schema.
//
// FIX: rows/advancePayment/monthlyDue are read from the normalised shape
// returned by clientService.getPayments() (one place, shared with
// ClientDashboard through the SAME ['client-payments'] query key — no second
// query, no second fetch, realtime invalidation on 'client:invoice' unchanged).
// =============================================================================

// Phase 6.3 (Task 8) - see buildBillingRows() in server/src/controllers/
// clientController.js for the full three-part root cause. Frontend share of it:
//   * `budget` was summed from `p.budget` on PAYMENT rows, a field that does not
//     exist on paymentSchema (budget lives on the parent project) -> always 0.
//     The variable was then never even rendered, so it was dead code computing a
//     guaranteed zero. Removed; the real per-row budget now arrives from the
//     server for callers that need it.
//   * `p.amount` / `p.paid` were used unguarded (`p.amount.toLocaleString()`),
//     which throws on any row missing the field. Now defaulted.
//   * The `client-invoices` query was fetched and never referenced anywhere in
//     this component - a dead query on every mount. Removed (Task 11).
export default function ClientBilling() {
  const { user } = useAuth()
  const { data: billing, isLoading, isError } = useQuery({ queryKey: ['client-payments'], queryFn: () => clientService.getPayments(user) })

  if (isLoading) return <Loader label="Loading billing…" />

  if (isError) {
    return (
      <div>
        <PageHeader title="Billing & Payments" subtitle="Invoices, receipts and balances for your projects." />
        <EmptyState icon={FiFileText} title="Couldn't load billing" description="Something went wrong fetching your billing data. Please refresh, or contact support if this keeps happening." />
      </div>
    )
  }

  // PHASE 6.11 (TASK 3): every figure now comes from the ONE shared
  // summariser in ./constants, which ClientDashboard imports as well. The
  // arithmetic that used to live inline here is gone - see summarizeBilling()
  // for the three defects it repairs (receipts counted as billings, the total
  // -level rather than per-row floor on the balance, and "Next Due" sorting on
  // the ISSUE date instead of the due date).
  // PHASE CLIENT PAY/BALANCE (TASK 5): the summariser is now ALSO computed
  // server-side (services/clientBillingService.js on the server) and returned
  // as `billing.summary` by GET /client/payments — the SAME routine the
  // Admin/HR "Client Pay/Balance" module reads. The portal consumes that
  // server summary; the client-side summarizeBilling() is kept ONLY as a
  // read-compat fallback for a stale cached response that predates the field.
  const summary = billing.summary ?? summarizeBilling(billing)
  const {
    rows: payments, advancePayment, monthlyDue, totalAmount,
    billed, paid, pending, balance, next, nextDueDate, overdue,
  } = summary

  // Builds a statement from the REAL invoice values already loaded - it is not a
  // placeholder file. No PDF renderer exists anywhere in this architecture, so a
  // plain-text statement is the honest ceiling here rather than a fake .pdf.
  const downloadInvoice = (inv) => {
    downloadTextFile(
      `${inv.invoice || 'invoice'}.txt`,
      `INVOICE ${inv.invoice}\nProject: ${inv.projectName || '—'}\nAmount: ₹${inv.amount || 0}\nPaid: ₹${inv.paid || 0}\nStatus: ${inv.status}\nDate: ${fmtDate(inv.date)}`,
    )
    toast.success(`Downloading ${inv.invoice}`)
  }

  return (
    <div>
      <PageHeader title="Billing & Payments" subtitle="Invoices, receipts and balances for your projects." />

      {/* Every figure below is derived from stored documents only — invoice /
          payment / transaction rows for the first four, and the Client record's
          own onboarding terms for Advance Payment and Monthly Due. Nothing is
          synthesised, and nothing is a placeholder. Advance Payment and Monthly
          Due are rendered here for the first time: the server has returned them
          since Phase 6.9 (Task 18), but the crash above meant no consumer ever
          read them. */}
      {/* Phase 6.11 (TASK 3): "Pending Amount" is added - the brief lists it as
          a value the client must see, and it was the one figure the page never
          showed. It is NOT a restatement of Outstanding: Pending is the sum of
          the unpaid portions of still-open invoices, while Outstanding is what
          the account owes net of every payment received, including advances not
          yet applied to a specific invoice. With an unapplied advance on file
          the two legitimately differ, which is precisely why both are shown.
          Seven cards in a 4-column grid: the last card spans the remainder so
          the final row stays flush. */}
      {/* Phase 6.23 (TASK 3) - SECOND ROOT CAUSE, in the rendering layer.
          Every card passed a PRE-FORMATTED string (`₹${n.toLocaleString()}`) into
          StatCard, which renders it through the shared <AnimatedNumber />.
          AnimatedNumber deliberately parses its value with
          String(value).replace(/[^\d.-]/g, '') so it can count up to it, then
          re-renders the parsed NUMBER - so the ₹ and the grouping were stripped
          and thrown away on every one of these cards, and "1,20,000" was even
          re-parsed as 1 (parseFloat stops at the first comma) on locales where
          toLocaleString() inserted separators before the parse. The component
          already exposes the correct escape hatch for this - the `format` prop -
          which no billing card was using. Values are now passed as raw numbers
          with format={formatCurrency}, the project's existing shared
          Intl en-IN INR formatter from '@/utils'. No new formatter, no change to
          StatCard or AnimatedNumber, so the other ~40 call sites are untouched.
          Eight cards now fill the 4-column grid exactly, so the `col-span-2`
          filler that kept the last row flush at seven cards is no longer needed. */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* PHASE SALARY/BILLING (TASK 1): relabelled "Total Amount" -> "Total
            Budget". Same figure and same source (the contracted value the
            server returns as `totalAmount`); the brief's vocabulary is
            "Total Budget", and "Total Amount" next to "Total Billed" read as if
            one of them were an invoice total. */}
        <StatCard label="Total Budget" value={totalAmount} format={formatCurrency} icon={FiFileText} tone="primary" />
        <StatCard label="Total Billed" value={billed} format={formatCurrency} icon={FiFileText} tone="accent" />
        <StatCard label="Paid Amount" value={paid} format={formatCurrency} icon={FiCheckCircle} tone="success" />
        <StatCard label="Pending Amount" value={pending} format={formatCurrency} icon={FiFileText} tone={pending > 0 ? 'warning' : 'success'} />
        <StatCard label="Outstanding Balance" value={balance} format={formatCurrency} icon={FiCreditCard} tone={overdue ? 'danger' : balance > 0 ? 'warning' : 'success'} />
        <StatCard label="Advance Payment" value={advancePayment} format={formatCurrency} icon={FiCheckCircle} tone="accent" />
        <StatCard label="Monthly Due" value={monthlyDue} format={formatCurrency} icon={FiCreditCard} tone="primary" />
        <StatCard label="Next Due" value={next ? fmtDate(nextDueDate) : '—'} icon={FiDownload} tone="accent" />
      </div>

      {overdue && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <FiCreditCard /> You have an overdue invoice. Please clear the balance to avoid delays.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Invoice list */}
        <Card className="lg:col-span-2">
          <CardHeader title="Invoices & Payment History" />
          {payments.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-app p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{p.invoice} · {p.projectName}</p>
                    <p className="text-xs text-muted">{formatCurrency(p.amount || 0)} · {fmtDate(p.date)}{p.method ? ` · ${p.method}` : ''}</p>
                  </div>
                  <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{p.status}</Badge>
                  <div className="flex items-center gap-1">
                    {/* Phase 6.3 (Task 8): the "Pay Now" button was removed. It
                        only fired toast.success('Redirecting to secure payment…
                        (demo)') - there is no payment gateway, no checkout
                        route and no payment intent anywhere in the codebase, so
                        it could never do anything. Per the brief, a
                        fundamentally broken control is removed rather than left
                        in place pretending to work. Balances remain visible
                        above; settlement stays an offline/Finance-module action. */}
                    <button onClick={() => downloadInvoice(p)} className="rounded-lg p-2 text-muted transition hover:text-primary" title="Download invoice"><FiDownload /></button>
                    <Button variant="ghost" size="sm" onClick={() => downloadInvoice(p)}>View</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Receipts / summary */}
        <Card>
          <CardHeader title="Receipts" subtitle="Paid amounts" />
          {payments.filter((p) => p.status === 'Paid').length === 0 ? (
            <EmptyState title="No receipts yet" />
          ) : (
            <div className="space-y-2">
              {payments.filter((p) => p.status === 'Paid').map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-app p-3">
                  <div>
                    <p className="text-sm font-medium">{p.invoice}</p>
                    <p className="text-xs text-muted">{formatCurrency(p.paid || 0)}</p>
                  </div>
                  <button onClick={() => { downloadTextFile(`${p.invoice || 'receipt'}-receipt.txt`, `RECEIPT ${p.invoice}\nPaid: ₹${p.paid || 0}\nDate: ${fmtDate(p.date)}`); toast.success('Receipt downloaded') }}
                    className="flex items-center gap-1 rounded-lg bg-success/10 px-3 py-1.5 text-sm font-medium text-success transition hover:bg-success/20"><FiDownload /> Receipt</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
