// PHASE CLIENT PAY/BALANCE (TASK 5) — single source of truth for client billing.
//
// The Client Portal (GET /client/payments) and the new HR "Client Pay/Balance"
// module (GET /hr/client-billing) must show the SAME figures, computed by ONE
// routine. Before this phase:
//   * buildBillingRows lived in clientController.js and was only reachable via
//     the client-scoped routes — Admin/HR had no billing read surface at all.
//   * The summary arithmetic (billed / paid / pending / balance / next due /
//     overdue) existed ONLY in the client frontend
//     (client/src/features/client/constants.js summarizeBilling), so any future
//     Admin/HR surface would have had to duplicate it or disagree with the
//     portal.
//
// This module is that one routine: the row assembler (moved verbatim from
// clientController.js — the portal endpoint now imports it from here) plus the
// summariser (moved verbatim from the client, which now consumes the server-
// computed `summary` instead of re-deriving it) plus the Admin/HR overview.

import { Client, ClientProject } from '../models/clientModels.js'
import { Invoice, Transaction } from '../models/financeModels.js'

// ---------------------------------------------------------------------------
// Row assembler — moved VERBATIM from clientController.js (the single
// assembler every billing surface uses). See the notes below for the defects
// each step repairs; nothing about the produced rows changes.
// ---------------------------------------------------------------------------
export const buildBillingRows = async (clientId, projectFilter = {}) => {
  const [projects, client] = await Promise.all([
    ClientProject.find({ clientId, ...projectFilter }).sort({ createdAt: -1 }).lean(),
    Client.findOne({ clientId }).lean(),
  ])
  const company = client?.company || ''
  const rows = []

  // (a) Invoices raised at project level by Admin (existing behaviour, repaired).
  projects.forEach((p) => {
    (p.payments || []).forEach((x) => rows.push({
      ...x,
      id: String(x._id),
      invoice: x.invoice || '',
      amount: x.amount || 0,
      paid: x.paid || 0,
      status: x.status || 'Pending',
      date: x.date || '',
      method: x.method || '',
      projectId: p.projectId,
      projectName: p.name,
      client: company,
      // Carried from the PARENT project - this is the field cause #1 was
      // looking for on the payment row itself.
      budget: p.budget || 0,
      source: 'project',
    }))
  })

  // (b) Real Finance invoices for this company. Drafts are excluded because an
  // unissued invoice is not something a client should see. Scoped strictly to
  // the caller's own company, and only when a project filter is not in play.
  if (company && !projectFilter.projectId) {
    const invoices = await Invoice.find({ client: company, status: { $ne: 'Draft' } })
      .sort({ issueDate: -1 }).lean()
    // Never list the same invoice twice if Admin also mirrored it onto a project.
    const seen = new Set(rows.map((r) => r.invoice).filter(Boolean))
    invoices.forEach((inv) => {
      if (inv.invoiceNumber && seen.has(inv.invoiceNumber)) return
      rows.push({
        id: String(inv._id),
        invoice: inv.invoiceNumber || '',
        amount: inv.total || 0,
        paid: inv.amountPaid || 0,
        // Map the Finance vocabulary onto the portal's paymentSchema enum so the
        // existing PAYMENT_STATUS_TONE badge map keeps working unchanged.
        status: inv.status === 'Partial' ? 'Partial Payment'
          : inv.status === 'Sent' ? 'Pending'
          : inv.status,
        date: inv.issueDate || inv.dueDate || '',
        dueDate: inv.dueDate || '',
        method: '',
        projectId: '',
        projectName: 'Account',
        client: company,
        budget: 0,
        source: 'finance',
      })
    })
  }

  // (c) The ONE remaining real billing event most clients actually have — the
  // advance-payment Income Transaction that createProjectWithClient() posts to
  // the SAME Finance Transaction ledger the internal Finance module reads —
  // was never surfaced before Phase 6.9 (Task 18). A client whose only billing
  // history is that advance legitimately saw 0 on every card even though real
  // money had been recorded against them. Scoped by `party === company`, the
  // SAME matching key already used for Invoice.find({ client: company }) above,
  // so no other client's transactions can leak in. Only when no project filter
  // is in play, matching rule (b)'s account-level scope.
  if (company && !projectFilter.projectId) {
    const transactions = await Transaction.find({ type: 'Income', party: company }).sort({ date: -1 }).lean()
    const seenRef = new Set(rows.map((r) => r.invoice).filter(Boolean))
    transactions.forEach((t) => {
      if (t.reference && seenRef.has(t.reference)) return
      rows.push({
        id: String(t._id),
        invoice: t.reference || t.title || '',
        amount: t.amount || 0,
        // A recorded Income transaction is, by definition, money already
        // received - unlike an Invoice, there is no separate "amountPaid".
        paid: t.amount || 0,
        status: 'Paid',
        date: t.date || '',
        method: t.method || '',
        projectId: '',
        projectName: t.category === 'Project Advance' ? 'Advance Payment' : 'Account',
        client: company,
        budget: 0,
        source: 'transaction',
      })
    })
  }

  rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))

  // advancePayment/monthlyDue are real commercial terms captured on the Client
  // document at onboarding and already consumed by Finance — returned alongside
  // rows (not tacked onto the array, which JSON.stringify would silently drop).
  //
  // totalAmount = the CONTRACTED value of the client's projects
  // (ClientProject.budget). The account-level Client.budget (now actually
  // persisted — see models/clientModels.js) is used as a FALLBACK, never an
  // addition: summing both would double-count the same commercial figure once a
  // project mirror exists carrying the same budget. Multiple projects therefore
  // still total correctly (Σ project budgets), and a project-filtered request
  // keeps reporting only that project's own budget.
  const projectBudgetTotal = projects.reduce((sum, p) => sum + (p.budget || 0), 0)
  const accountBudget = client?.budget || 0
  const totalAmount = projectBudgetTotal > 0 || projectFilter.projectId
    ? projectBudgetTotal
    : accountBudget
  const totalBilled = rows.reduce((sum, r) => sum + (r.source === 'transaction' ? 0 : (r.amount || 0)), 0)

  // advance / monthly due are captured on PROJECT creation now. The mirror rows
  // this function already loaded carry them (syncClientProject), so they are
  // summed here. FALLBACK, never additive — exactly the rule `totalAmount` uses
  // (see the PHASE CLIENT/PROJECT FIELD OWNERSHIP note in clientController.js).
  const projectAdvanceTotal = projects.reduce((sum, p) => sum + (p.advancePayment || 0), 0)
  const projectMonthlyDueTotal = projects.reduce((sum, p) => sum + (p.monthlyDue || 0), 0)

  return {
    rows,
    advancePayment: projectAdvanceTotal > 0 ? projectAdvanceTotal : (client?.advancePayment || 0),
    monthlyDue: projectMonthlyDueTotal > 0 ? projectMonthlyDueTotal : (client?.monthlyDue || 0),
    totalAmount,
    totalBilled,
    // Reported separately so the portal can distinguish "contracted across
    // projects" from "agreed at onboarding" without re-deriving either.
    projectBudgetTotal,
    accountBudget,
  }
}

// ---------------------------------------------------------------------------
// Summariser — moved VERBATIM from client/src/features/client/constants.js
// (summarizeBilling). Every rule that phase documented (a receipt is not a
// bill; per-row floor on the balance; Next Due on the DUE date; Outstanding on
// max(contracted, billed) − paid) is preserved exactly, so the Admin/HR module
// and the Client Portal read the same numbers from the same function.
// ---------------------------------------------------------------------------

// A receipt is not a bill. Income Transaction rows (source: 'transaction') are
// money ALREADY RECEIVED that the server surfaces so advance payments are
// visible; counting them in "Total Billed" would inflate it by the value of
// every advance. They still count towards Paid, which is what they are.
const isBillable = (r) => r.source !== 'transaction'

// Per-row unpaid portion, floored at zero. Flooring PER ROW (rather than on the
// total) matters: an overpaid or credited invoice must not silently cancel out
// a genuinely unpaid one and hide a real debt behind a healthy-looking net.
const rowDue = (r) => Math.max(0, (r.amount || 0) - (r.paid || 0))

export function summarizeBilling(billing) {
  const rows = billing?.rows || []

  // Stored commercial terms off the Client document, passed straight through —
  // not derived, not defaulted to a placeholder.
  const advancePayment = billing?.advancePayment || 0
  const monthlyDue = billing?.monthlyDue || 0

  const billed = rows.filter(isBillable).reduce((s, r) => s + (r.amount || 0), 0)

  // The account's Total Amount is the CONTRACTED value of the client's
  // projects (ClientProject.budget), which only the server can total — a
  // project that has not been invoiced yet produces no row here. The `?? billed`
  // fallback only covers an older cached response that predates the field.
  const totalAmount = Number(billing?.totalAmount) > 0 ? Number(billing.totalAmount) : billed
  const paid = rows.reduce((s, r) => s + (r.paid || 0), 0)

  // Pending = the unpaid portion of invoices that are still open. Rows already
  // marked Paid are excluded so a rounding remainder on a settled invoice does
  // not read as an amount still due.
  const pending = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid')
    .reduce((s, r) => s + rowDue(r), 0)

  // Outstanding = what the ACCOUNT owes, net of everything received. The basis
  // is max(contracted, billed): an un-invoiced contract is still owed on the
  // account, while billing BEYOND the agreed budget is never hidden. `paid` is
  // subtracted exactly ONCE and already includes the advance-payment Income
  // transaction, so the advance is never double-counted here. Floored at zero:
  // a credit balance is not a debt.
  const balance = Math.max(0, Math.max(totalAmount, billed) - paid)

  // Next payment due. Finance invoices carry a real `dueDate`; project payment
  // rows only carry `date`. Prefer the due date and fall back to the issue date
  // only when no due date is stored.
  const dueOn = (r) => r.dueDate || r.date || ''
  const next = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid' && dueOn(r))
    .sort((a, b) => new Date(dueOn(a)) - new Date(dueOn(b)))[0]

  const overdue = rows.some((r) => r.status === 'Overdue')

  return { rows, advancePayment, monthlyDue, totalAmount, billed, paid, pending, balance, next, nextDueDate: next ? dueOn(next) : '', overdue }
}

// ---------------------------------------------------------------------------
// Admin/HR overview — every client's billing in one payload for the new
// "Client Pay/Balance" module (GET /hr/client-billing, guarded to Admin/HR).
// Each client row is produced by the SAME buildBillingRows + summarizeBilling
// the Client Portal reads, so the HR screen and the client's own portal can
// never disagree. Aggregate figures are plain sums over those rows.
// ---------------------------------------------------------------------------
export async function buildClientBillingOverview() {
  const clients = await Client.find({}).sort({ company: 1 }).lean()

  const perClient = await Promise.all(clients.map(async (c) => {
    const billing = await buildBillingRows(c.clientId)
    const summary = summarizeBilling(billing)
    return {
      clientId: c.clientId,
      company: c.company,
      contactPerson: c.contactPerson,
      email: c.email,
      status: c.status,
      plan: c.plan,
      projectCount: billing.rows.length ? new Set(billing.rows.filter((r) => r.projectId).map((r) => r.projectId)).size : 0,
      ...summary,
    }
  }))

  const totalBudget = perClient.reduce((s, c) => s + (c.totalAmount || 0), 0)
  const totalBilled = perClient.reduce((s, c) => s + (c.billed || 0), 0)
  const totalPaid = perClient.reduce((s, c) => s + (c.paid || 0), 0)
  const totalPending = perClient.reduce((s, c) => s + (c.pending || 0), 0)
  const totalBalance = perClient.reduce((s, c) => s + (c.balance || 0), 0)

  return {
    generatedAt: new Date().toISOString(),
    totalClients: perClient.length,
    clientsWithBalance: perClient.filter((c) => c.balance > 0).length,
    clientsOverdue: perClient.filter((c) => c.overdue).length,
    totalBudget, totalBilled, totalPaid, totalPending, totalBalance,
    clients: perClient,
  }
}