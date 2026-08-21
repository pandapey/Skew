import { z } from 'zod'

const req = (msg) => z.string().min(1, msg)

export const transactionSchema = z.object({
  title: req('Title required'),
  type: z.string().min(1, 'Type required'),
  category: req('Category required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  date: req('Date required'),
  method: z.string().optional(),
  reference: z.string().optional(),
  party: z.string().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
})

export const categorySchema = z.object({
  name: req('Category name required'),
  type: z.string().min(1, 'Type required'),
  color: z.string().optional(),
  description: z.string().optional(),
})

export const budgetSchema = z.object({
  category: req('Category required'),
  period: req('Period required'),
  allocated: z.coerce.number().min(0, 'Allocated must be ≥ 0'),
  spent: z.coerce.number().min(0).optional(),
})

export const paymentSchema = z.object({
  direction: z.string().min(1, 'Direction required'),
  party: req('Party required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  method: z.string().optional(),
  status: z.string().optional(),
  date: req('Date required'),
  invoiceNumber: z.string().optional(),
  notes: z.string().optional(),
})

// Invoices are created via a dedicated builder (line items), validated inline.
export const invoiceMetaSchema = z.object({
  client: req('Client required'),
  clientEmail: z.string().email('Valid email required').optional().or(z.literal('')),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
})
