import {
  FiTrendingUp, FiTrendingDown, FiPieChart, FiFileText, FiCreditCard,
  FiRepeat, FiGrid, FiPercent, FiCalendar, FiBarChart2,
} from 'react-icons/fi'

// Finance sub-module navigation — drives the hub grid.
export const FINANCE_SECTIONS = [
  { key: 'income', label: 'Income', path: '/finance/income', icon: FiTrendingUp, tone: 'success', desc: 'Revenue & receipts' },
  { key: 'expenses', label: 'Expenses', path: '/finance/expenses', icon: FiTrendingDown, tone: 'danger', desc: 'Costs & bills' },
  { key: 'transactions', label: 'Transactions', path: '/finance/transactions', icon: FiRepeat, tone: 'primary', desc: 'Full ledger' },
  { key: 'invoices', label: 'Invoices', path: '/finance/invoices', icon: FiFileText, tone: 'accent', desc: 'Billing & receivables' },
  { key: 'payments', label: 'Payments', path: '/finance/payments', icon: FiCreditCard, tone: 'warning', desc: 'In / out settlements' },
  { key: 'budgets', label: 'Budgets', path: '/finance/budgets', icon: FiBarChart2, tone: 'primary', desc: 'Plan vs actual' },
  { key: 'categories', label: 'Categories', path: '/finance/categories', icon: FiGrid, tone: 'accent', desc: 'Chart of accounts' },
  { key: 'tax', label: 'Tax Reports', path: '/finance/tax', icon: FiPercent, tone: 'warning', desc: 'GST input / output' },
  { key: 'monthly', label: 'Monthly Reports', path: '/finance/monthly', icon: FiCalendar, tone: 'success', desc: 'Month-wise P&L' },
  { key: 'yearly', label: 'Yearly Reports', path: '/finance/yearly', icon: FiPieChart, tone: 'primary', desc: 'Annual summary' },
]

// Enumerations (mirror backend models)
export const TRANSACTION_TYPES = ['Income', 'Expense']
export const PAYMENT_METHODS = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque']
export const TAX_RATES = [0, 5, 12, 18, 28]
export const INVOICE_STATUSES = ['Draft', 'Sent', 'Partial', 'Paid', 'Overdue', 'Cancelled']
export const PAYMENT_STATUSES = ['Pending', 'Completed', 'Failed']
export const PAYMENT_DIRECTIONS = ['Incoming', 'Outgoing']
export const BUDGET_STATUSES = ['On Track', 'At Risk', 'Over Budget']
export const CATEGORY_TYPES = ['Income', 'Expense']

// Roles allowed to write in Finance (matches backend route guards).
export const FINANCE_WRITE_ROLES = ['Admin', 'HR']

// Badge tone maps
export const TYPE_TONE = { Income: 'success', Expense: 'danger' }
export const INVOICE_STATUS_TONE = {
  Draft: 'default', Sent: 'primary', Partial: 'warning', Paid: 'success', Overdue: 'danger', Cancelled: 'default',
}
export const PAYMENT_STATUS_TONE = { Pending: 'warning', Completed: 'success', Failed: 'danger' }
export const PAYMENT_DIR_TONE = { Incoming: 'success', Outgoing: 'danger' }
export const BUDGET_STATUS_TONE = { 'On Track': 'success', 'At Risk': 'warning', 'Over Budget': 'danger' }

// Demo clients / vendors for invoices & payments.
export const FINANCE_CLIENTS = ['Acme Corp', 'Globex Ltd', 'Stark Industries', 'Wayne Enterprises', 'Umbrella Inc', 'Hooli', 'Initech', 'Soylent Co']
export const FINANCE_VENDORS = ['TechSource Pvt Ltd', 'MegaSupply Co', 'CloudNine Hosting', 'AdVantage Media', 'PowerGrid Utils', 'LegalEase LLP']
