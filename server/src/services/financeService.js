import {
  Transaction, FinanceCategory, Budget, Invoice, Payment,
} from '../models/financeModels.js'
import { ApiError } from '../utils/asyncHandler.js'

// Frontend keys every row on `.id`; Mongo returns `_id`. Normalize on the way out.
export const withId = (doc) => (doc ? { ...doc, id: String(doc._id) } : doc)
export const withIds = (docs) => docs.map(withId)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const nextNumber = async (Model, prefix, base = 1001) => `${prefix}-${base + await Model.countDocuments()}`

export const financeService = {
  // --- Invoice: create with computed totals + generated number ---
  async createInvoice(body) {
    const rawItems = body.items || []
    // Compute each line item's amount from quantity x rate so the stored
    // item always carries a correct amount (not just the invoice totals).
    const items = rawItems.map((it) => ({
      ...it,
      amount: Math.round(Number(it.rate || 0) * Number(it.quantity || 0)),
    }))
    const subtotal = items.reduce((s, it) => s + it.amount, 0)
    const taxRate = Number(body.taxRate ?? 18)
    const tax = Math.round(subtotal * (taxRate / 100))
    const invoiceNumber = body.invoiceNumber || await nextNumber(Invoice, 'INV')
    const inv = await Invoice.create({ ...body, items, invoiceNumber, subtotal, tax, taxRate, total: subtotal + tax, amountPaid: 0 })
    return withId(inv.toObject())
  },

  // Record a payment against an invoice → update paid amount/status + log a Payment.
  async recordInvoicePayment(id, amount) {
    const amt = Number(amount)
    if (!amt || Number.isNaN(amt) || amt <= 0) throw new ApiError(422, 'amount must be a positive number')
    const inv = await Invoice.findById(id)
    if (!inv) throw new ApiError(404, 'Invoice not found')
    if (inv.status === 'Cancelled') throw new ApiError(422, 'Cannot record a payment against a cancelled invoice')
    // Reject overpayment instead of silently capping amountPaid: previously
    // `Math.min(inv.total, amountPaid + amt)` let a payment larger than the
    // outstanding balance through, and the full `amt` was persisted on the
    // Payment document while the invoice only absorbed the remainder — the two
    // records then disagreed with each other and with the client's ledger.
    const remaining = Math.max(0, (inv.total || 0) - (inv.amountPaid || 0))
    if (amt > remaining) throw new ApiError(422, `Payment exceeds the outstanding balance (${remaining})`)
    inv.amountPaid = (inv.amountPaid || 0) + amt
    // amt > 0 always raises amountPaid, so the status is always derived here;
    // the old `: inv.status` fallback was dead code that could never run.
    inv.status = inv.amountPaid >= inv.total ? 'Paid' : 'Partial'
    await inv.save()
    await Payment.create({
      paymentNumber: await nextNumber(Payment, 'PMT', 5001),
      direction: 'Incoming', party: inv.client, invoiceNumber: inv.invoiceNumber,
      amount: amt, method: 'Bank Transfer', status: 'Completed', date: new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),
    })
    return withId(inv.toObject())
  },

  // --- Dashboard + analytics ---
  async stats() {
    const [transactions, invoices, payments, budgets] = await Promise.all([
      Transaction.find().lean(), Invoice.find().lean(), Payment.find().lean(), Budget.find().lean(),
    ])

    const income = transactions.filter((t) => t.type === 'Income').reduce((s, t) => s + t.amount, 0)
    const expense = transactions.filter((t) => t.type === 'Expense').reduce((s, t) => s + t.amount, 0)

    // Monthly cash-flow series.
    const trendMap = {}
    transactions.forEach((t) => {
      const m = Number(String(t.date).slice(5, 7)) - 1
      if (Number.isNaN(m) || m < 0) return
      const b = (trendMap[m] ||= { month: MONTHS[m], revenue: 0, expense: 0 })
      if (t.type === 'Income') b.revenue += t.amount
      else b.expense += t.amount
    })
    const monthlyTrend = Object.keys(trendMap).map(Number).sort((a, b) => a - b).map((m) => trendMap[m])

    const byCat = (type) => {
      const map = {}
      transactions.filter((t) => t.type === type).forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount })
      return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    }

    const outstanding = invoices.filter((i) => !['Paid', 'Draft', 'Cancelled'].includes(i.status)).reduce((s, i) => s + (i.total - i.amountPaid), 0)
    const overdue = invoices.filter((i) => i.status === 'Overdue').reduce((s, i) => s + (i.total - i.amountPaid), 0)

    return {
      totalIncome: income,
      totalExpense: expense,
      netProfit: income - expense,
      profitMargin: income ? Math.round(((income - expense) / income) * 100) : 0,
      totalTransactions: transactions.length,
      totalInvoices: invoices.length,
      paidInvoices: invoices.filter((i) => i.status === 'Paid').length,
      outstandingAmount: outstanding,
      overdueAmount: overdue,
      totalBudget: budgets.reduce((s, b) => s + (b.allocated || 0), 0),
      budgetSpent: budgets.reduce((s, b) => s + (b.spent || 0), 0),
      incomingPayments: payments.filter((p) => p.direction === 'Incoming' && p.status === 'Completed').reduce((s, p) => s + p.amount, 0),
      outgoingPayments: payments.filter((p) => p.direction === 'Outgoing' && p.status === 'Completed').reduce((s, p) => s + p.amount, 0),
      monthlyTrend,
      expenseByCategory: byCat('Expense'),
      incomeByCategory: byCat('Income'),
      budgets: withIds(budgets),
    }
  },

  // --- Tax report (GST-style, grouped by rate) ---
  async taxReport() {
    const [transactions, invoices] = await Promise.all([Transaction.find().lean(), Invoice.find().lean()])
    const outputTax = {}
    const inputTax = {}
    transactions.forEach((t) => {
      const rate = t.taxRate || 0
      const tax = Math.round(t.amount * (rate / 100))
      const bucket = t.type === 'Income' ? outputTax : inputTax
      const b = (bucket[rate] ||= { rate, taxable: 0, tax: 0, count: 0 })
      b.taxable += t.amount; b.tax += tax; b.count += 1
    })
    const outputRows = Object.values(outputTax).sort((a, b) => a.rate - b.rate)
    const inputRows = Object.values(inputTax).sort((a, b) => a.rate - b.rate)
    const totalOutput = outputRows.reduce((s, r) => s + r.tax, 0)
    const totalInput = inputRows.reduce((s, r) => s + r.tax, 0)
    return {
      outputRows, inputRows, totalOutput, totalInput,
      netPayable: totalOutput - totalInput,
      invoiceTax: invoices.reduce((s, i) => s + (i.tax || 0), 0),
    }
  },

  // --- Period report: group by month or full year ---
  async periodReport(groupBy = 'month', year = 2026) {
    const rows = (await Transaction.find().lean()).filter((t) => String(t.date).slice(0, 4) === String(year))
    if (groupBy === 'year') {
      const income = rows.filter((t) => t.type === 'Income').reduce((s, t) => s + t.amount, 0)
      const expense = rows.filter((t) => t.type === 'Expense').reduce((s, t) => s + t.amount, 0)
      return [{ period: String(year), income, expense, net: income - expense, count: rows.length }]
    }
    const map = {}
    rows.forEach((t) => {
      const m = Number(String(t.date).slice(5, 7)) - 1
      if (Number.isNaN(m) || m < 0) return
      const b = (map[m] ||= { period: `${MONTHS[m]} ${year}`, month: m, income: 0, expense: 0, count: 0 })
      if (t.type === 'Income') b.income += t.amount
      else b.expense += t.amount
      b.count += 1
    })
    return Object.values(map).sort((a, b) => a.month - b.month).map((r) => ({ ...r, net: r.income - r.expense }))
  },
}
