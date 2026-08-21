import mongoose from 'mongoose'

const { Schema, model } = mongoose
const opts = { timestamps: true }

// --- Finance category (chart of accounts) ---
const financeCategorySchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  type: { type: String, enum: ['Income', 'Expense'], required: true, index: true },
  color: { type: String, default: '#2563EB' },
  description: String,
}, opts)
financeCategorySchema.index({ name: 'text' })

// --- Transaction (income / expense ledger) ---
const transactionSchema = new Schema({
  title: { type: String, required: true, trim: true, index: true },
  type: { type: String, enum: ['Income', 'Expense'], required: true, index: true },
  category: { type: String, index: true },
  amount: { type: Number, required: true, min: 0 },
  date: { type: String, index: true }, // YYYY-MM-DD
  method: { type: String, default: 'Bank Transfer' },
  reference: String,
  party: String, // client (income) or vendor (expense)
  taxRate: { type: Number, default: 0 },
  notes: String,
}, opts)
transactionSchema.index({ title: 'text', category: 'text', party: 'text', reference: 'text' })

// --- Budget (plan vs actual per category / period) ---
const budgetSchema = new Schema({
  category: { type: String, required: true, index: true },
  period: { type: String, default: 'July 2026', index: true },
  allocated: { type: Number, default: 0 },
  spent: { type: Number, default: 0 },
  status: { type: String, enum: ['On Track', 'At Risk', 'Over Budget'], default: 'On Track' },
}, opts)

// Keep status in sync with spend on every save.
budgetSchema.pre('save', function syncStatus(next) {
  if (this.spent > this.allocated) this.status = 'Over Budget'
  else if (this.spent > this.allocated * 0.85) this.status = 'At Risk'
  else this.status = 'On Track'
  next()
})

// --- Invoice line item (subdoc) ---
const invoiceItemSchema = new Schema({
  description: String,
  quantity: { type: Number, default: 1 },
  rate: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
}, { _id: false })

// --- Invoice ---
const invoiceSchema = new Schema({
  invoiceNumber: { type: String },
  client: { type: String, required: true, index: true },
  clientEmail: String,
  items: [invoiceItemSchema],
  subtotal: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  taxRate: { type: Number, default: 18 },
  total: { type: Number, default: 0 },
  amountPaid: { type: Number, default: 0 },
  status: { type: String, enum: ['Draft', 'Sent', 'Partial', 'Paid', 'Overdue', 'Cancelled'], default: 'Draft', index: true },
  issueDate: String,
  dueDate: String,
  notes: String,
}, opts)
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true })
invoiceSchema.index({ invoiceNumber: 'text', client: 'text' })

// --- Payment (incoming / outgoing settlement) ---
const paymentSchema = new Schema({
  paymentNumber: { type: String, index: true },
  direction: { type: String, enum: ['Incoming', 'Outgoing'], required: true, index: true },
  party: { type: String, required: true },
  invoiceNumber: String,
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, default: 'Bank Transfer' },
  status: { type: String, enum: ['Pending', 'Completed', 'Failed'], default: 'Completed', index: true },
  date: String,
  notes: String,
}, opts)
paymentSchema.index({ paymentNumber: 'text', party: 'text', invoiceNumber: 'text' })

export const FinanceCategory = model('FinanceCategory', financeCategorySchema)
export const Transaction = model('Transaction', transactionSchema)
export const Budget = model('Budget', budgetSchema)
export const Invoice = model('Invoice', invoiceSchema)
export const Payment = model('Payment', paymentSchema)
