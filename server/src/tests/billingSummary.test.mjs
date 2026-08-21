// Deterministic CLIENT BILLING verification harness.
//
// PHASE SALARY/BILLING (TASK 1). Exercises the REAL shared summariser —
//   client/src/features/client/constants.js -> summarizeBilling()
// which is the single place the Client Portal derives its billing figures
// (ClientBilling.jsx and ClientDashboard.jsx both consume it). Nothing is
// re-implemented here.
//
// WHY THE SOURCE IS REWRITTEN BEFORE IMPORT: that module's first line is
// `export { cn } from '@/utils'`. `@` is a Vite path alias that plain Node
// cannot resolve, and `cn` is a className helper with no bearing on billing.
// The alias line is swapped for an inert stub and the file is imported from a
// temp copy, so the summarizeBilling BODY that runs below is byte-for-byte the
// application's own. No other line is touched — asserted before the copy is
// written, so a future refactor cannot silently change what is under test.
//
// Run: node src/tests/billingSummary.test.mjs   (from server/)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '../../../client/src/features/client/constants.js')

const ALIAS_LINE = "export { cn } from '@/utils'"
const original = fs.readFileSync(SRC, 'utf8')
if (!original.includes(ALIAS_LINE)) {
  console.error(`FATAL: expected alias line not found in ${SRC}. Refusing to guess.`)
  process.exit(1)
}
const patched = original.replace(ALIAS_LINE, 'export const cn = (...a) => a.filter(Boolean).join(" ")')
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skew-billing-')), 'constants.mjs')
fs.writeFileSync(tmp, patched, 'utf8')

const { summarizeBilling } = await import(pathToFileURL(tmp).href)

let pass = 0
let fail = 0
const results = []
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(expected === undefined ? actual : actual)}`}`)
}
function checkTrue(name, cond, detail = '') {
  cond ? pass++ : fail++
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// Row shapes mirror clientController.buildBillingRows() exactly:
//   source 'project'     - an invoice row embedded on ClientProject.payments
//   source 'finance'     - a real Invoice document
//   source 'transaction' - an Income Transaction (money RECEIVED, e.g. the advance)
const invoice = (amount, paid, status = 'Pending', extra = {}) =>
  ({ id: String(Math.random()), source: 'finance', amount, paid, status, date: '2026-08-01', ...extra })
const receipt = (amount, extra = {}) =>
  ({ id: String(Math.random()), source: 'transaction', amount, paid: amount, status: 'Paid', date: '2026-08-01', ...extra })

// ===========================================================================
// THE BRIEF'S SCENARIO
//   Total Budget  = 100,000
//   Advance       =  20,000
//   Monthly Due   =  10,000
// ===========================================================================
{
  // The advance is recorded once, as an Income transaction, exactly as both
  // creation paths now post it (projectService.createProjectWithClient and
  // userController.recordAdvancePayment).
  const billing = {
    rows: [receipt(20000, { projectName: 'Advance Payment' })],
    advancePayment: 20000,
    monthlyDue: 10000,
    totalAmount: 100000,
    totalBilled: 0,
  }
  const s = summarizeBilling(billing)
  check('T1 Total Budget is reported from the contracted value', s.totalAmount, 100000)
  check('T1 Advance Payment is reported', s.advancePayment, 20000)
  check('T1 Monthly Due is reported', s.monthlyDue, 10000)
  check('T1 Paid comes from the real payment record', s.paid, 20000)
  check('T1 a receipt is NOT counted as billed', s.billed, 0)
  check('T1 Outstanding = budget - received', s.balance, 80000)
  checkTrue('T1 the advance is counted exactly once',
    s.paid === 20000, `paid=${s.paid}`)
}

// ===========================================================================
// THE REGRESSION THIS PHASE FIXES: before the fix `totalAmount` never survived
// clientService.getPayments(), so it arrived undefined and the card fell back
// to `billed` (0). Assert the fallback only fires when there is genuinely no
// contract value.
// ===========================================================================
{
  const noContract = summarizeBilling({ rows: [invoice(50000, 0)], advancePayment: 0, monthlyDue: 0, totalAmount: 0 })
  check('T1 with no stored budget, Total falls back to invoiced', noContract.totalAmount, 50000)
  check('T1 outstanding then equals the unpaid invoice', noContract.balance, 50000)

  const missingKey = summarizeBilling({ rows: [invoice(50000, 0)] })
  check('T1 a legacy payload without totalAmount still degrades safely', missingKey.totalAmount, 50000)
}

// ===========================================================================
// NO DOUBLE COUNTING of the advance across the two ways it can surface.
// ===========================================================================
{
  // Advance receipt + a later invoice partially settled by it.
  const s = summarizeBilling({
    rows: [receipt(20000), invoice(60000, 0, 'Pending')],
    advancePayment: 20000, monthlyDue: 10000, totalAmount: 100000,
  })
  check('T1 billed excludes the receipt', s.billed, 60000)
  check('T1 paid includes the receipt once', s.paid, 20000)
  check('T1 pending is the unpaid invoice portion', s.pending, 60000)
  check('T1 outstanding is against the contract, not billed+advance', s.balance, 80000)
  checkTrue('T1 advancePayment is displayed but NOT re-added to paid',
    s.paid === 20000 && s.advancePayment === 20000)
}

// ===========================================================================
// MULTIPLE PROJECTS for one client. buildBillingRows sums ClientProject.budget
// server-side, so the summariser simply consumes it — assert it is not
// re-derived or double counted from the rows.
// ===========================================================================
{
  const s = summarizeBilling({
    rows: [invoice(40000, 40000, 'Paid'), invoice(30000, 10000, 'Partial Payment')],
    advancePayment: 0, monthlyDue: 5000,
    totalAmount: 250000,   // project A 100k + project B 150k
  })
  check('T1 multi-project total is consumed, not recomputed', s.totalAmount, 250000)
  check('T1 billed across projects', s.billed, 70000)
  check('T1 paid across projects', s.paid, 50000)
  check('T1 pending excludes fully-paid invoices', s.pending, 20000)
  check('T1 outstanding across projects', s.balance, 200000)
}

// ===========================================================================
// Invariants / edge cases.
// ===========================================================================
{
  const empty = summarizeBilling(undefined)
  check('T1 undefined payload yields zeroes, not NaN',
    [empty.totalAmount, empty.billed, empty.paid, empty.pending, empty.balance], [0, 0, 0, 0, 0])

  // Over-payment must not create a negative balance.
  const credit = summarizeBilling({ rows: [invoice(10000, 15000, 'Paid')], totalAmount: 10000 })
  checkTrue('T1 a credit balance is not reported as a debt', credit.balance === 0, `balance=${credit.balance}`)

  // An overpaid invoice must not cancel out a genuinely unpaid one (per-row floor).
  const mixed = summarizeBilling({ rows: [invoice(10000, 15000, 'Paid'), invoice(8000, 0, 'Pending')], totalAmount: 18000 })
  check('T1 per-row floor keeps a real debt visible', mixed.pending, 8000)

  // Billing beyond the agreed budget must not be hidden by the contract basis.
  const over = summarizeBilling({ rows: [invoice(150000, 0, 'Pending')], totalAmount: 100000 })
  check('T1 over-billing is not masked by the budget', over.balance, 150000)

  // Overdue detection drives the banner.
  const od = summarizeBilling({ rows: [invoice(5000, 0, 'Overdue')], totalAmount: 5000 })
  checkTrue('T1 overdue is detected', od.overdue === true)

  // Next Due prefers the real due date over the issue date.
  const next = summarizeBilling({
    rows: [
      invoice(1000, 0, 'Pending', { date: '2026-08-01', dueDate: '2026-09-30' }),
      invoice(2000, 0, 'Pending', { date: '2026-08-02', dueDate: '2026-08-20' }),
    ],
    totalAmount: 3000,
  })
  check('T1 Next Due sorts on the due date', next.nextDueDate, '2026-08-20')
}

fs.rmSync(path.dirname(tmp), { recursive: true, force: true })

console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
