import { Transaction } from '../models/financeModels.js'

// ---------------------------------------------------------------------------
// PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 5) — ONE advance-payment mirror
// ---------------------------------------------------------------------------
// An "Advance Payment" captured on a client is money RECEIVED, so it must exist
// as a real Income Transaction in the Finance ledger — that ledger row is what
// clientController.buildBillingRows() surfaces as "Paid Amount" in the client
// portal's Billing & Payments screen. A number stored only on the Client
// document shows an advance on one card and ₹0 paid on the next.
//
// This routine already existed TWICE:
//   * inline inside projectService.createProjectWithClient() (the
//     /project/with-client path), and
//   * as a private `recordAdvancePayment()` in controllers/userController.js
//     (the Admin -> Users path), added in PHASE SALARY/BILLING (TASK 1)
//     precisely because the two paths disagreed.
//
// TASK 5 moves Client Creation onto POST /admin/clients, a third path that had
// NO ledger mirror at all — so without this, separating client creation from
// project creation would have silently dropped the advance receipt. Rather than
// writing a fourth copy, the helper is extracted here and shared, so every
// client-provisioning entry point posts the identical receipt.
//
// IDEMPOTENCY (this is what prevents a double count): the advance is keyed on
// party + category + reference, where the reference is the client's own code.
// Re-running provisioning, or an admin editing the client afterwards, can never
// post a second copy. A per-PROJECT advance raised later by
// createProjectWithClient() carries the PROJECT code as its reference, so it
// stays a genuinely distinct receipt and is not suppressed by this guard.
// ---------------------------------------------------------------------------
export async function recordAdvancePayment(client, amount, actorName) {
  const advance = Number(amount)
  if (!client?.company || !Number.isFinite(advance) || advance <= 0) return null
  const reference = `ADV-${client.clientId}`
  const already = await Transaction.exists({
    type: 'Income',
    category: 'Project Advance',
    party: client.company,
    reference,
  })
  if (already) return null
  return Transaction.create({
    title: `Advance payment - ${client.company}`,
    type: 'Income',
    category: 'Project Advance',
    amount: advance,
    date: new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),
    method: client.paymentMode || 'Bank Transfer',
    party: client.company,
    reference,
    notes: `Auto-recorded on client onboarding by ${actorName || 'System'}.`,
  })
}

export default recordAdvancePayment
