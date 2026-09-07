import { Client, ClientProject } from '../models/clientModels.js'
import { Project } from '../models/projectModels.js'
import { Invoice, Transaction } from '../models/financeModels.js'
import mongoose from 'mongoose'

export const buildBillingRows = async (clientId, projectFilter = {}) => {
  // Opt2: source projects from Project (FK clientId); fallback to legacy ClientProject if needed
  let projectFilterForLegacy = { ...projectFilter }
  // Translate ObjectId projectId string to legacy cp-* if needed
  if (projectFilter.projectId && mongoose.isValidObjectId(String(projectFilter.projectId))) {
    try {
      const cp = await ClientProject.findOne({ sourceProjectId: projectFilter.projectId }).select('projectId').lean()
      if (cp?.projectId) projectFilterForLegacy.projectId = cp.projectId
    } catch {}
  }

  const [legacyProjects, liveProjects, client] = await Promise.all([
    ClientProject.find({ clientId, ...projectFilterForLegacy }).sort({ createdAt: -1 }).lean().catch(()=>[]),
    // live projects matching clientId, with optional specific project
    (async () => {
      if (projectFilter.projectId && mongoose.isValidObjectId(String(projectFilter.projectId))) {
        return Project.find({ clientId, _id: projectFilter.projectId }).lean().catch(()=>[])
      }
      if (projectFilter.projectId) {
        // cp-* string -> try to resolve via legacy mapping then via code
        const cp = await ClientProject.findOne({ projectId: projectFilter.projectId }).lean().catch(()=>null)
        if (cp?.sourceProjectId) return Project.find({ _id: cp.sourceProjectId }).lean().catch(()=>[])
        // fallback by code
        return Project.find({ clientId, code: String(projectFilter.projectId).toUpperCase() }).lean().catch(()=>[])
      }
      return Project.find({ clientId }).sort({ createdAt: -1 }).lean().catch(()=>[])
    })(),
    Client.findOne({ clientId }).lean(),
  ])
  // Prefer legacy embedded payments source but augment counts/budgets with liveProjects
  const projects = legacyProjects.length ? legacyProjects : liveProjects.map(p => ({
    projectId: String(p._id),
    name: p.name,
    budget: p.budget || 0,
    advancePayment: p.advancePayment || 0,
    monthlyDue: p.monthlyDue || 0,
    payments: []
  }))
  const company = client?.company || ''
  const rows = []

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
      budget: p.budget || 0,
      source: 'project',
    }))
  })

  if (company && !projectFilter.projectId) {
    const invoices = await Invoice.find({ client: company, status: { $ne: 'Draft' } })
      .sort({ issueDate: -1 }).lean()
    const seen = new Set(rows.map((r) => r.invoice).filter(Boolean))
    invoices.forEach((inv) => {
      if (inv.invoiceNumber && seen.has(inv.invoiceNumber)) return
      rows.push({
        id: String(inv._id),
        invoice: inv.invoiceNumber || '',
        amount: inv.total || 0,
        paid: inv.amountPaid || 0,
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

  if (company && !projectFilter.projectId) {
    const transactions = await Transaction.find({ type: 'Income', party: company }).sort({ date: -1 }).lean()
    const seenRef = new Set(rows.map((r) => r.invoice).filter(Boolean))
    transactions.forEach((t) => {
      if (t.reference && seenRef.has(t.reference)) return
      rows.push({
        id: String(t._id),
        invoice: t.reference || t.title || '',
        amount: t.amount || 0,
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

  // Budget totals: prefer liveProjects (Project.budget is source of truth after Opt2), fallback to legacy
  const liveBudgetTotal = liveProjects.reduce((sum, p) => sum + (p.budget || 0), 0)
  const legacyBudgetTotal = projects.reduce((sum, p) => sum + (p.budget || 0), 0)
  const projectBudgetTotal = liveBudgetTotal || legacyBudgetTotal
  const accountBudget = client?.budget || 0
  const totalAmount = projectBudgetTotal > 0 || projectFilter.projectId
    ? projectBudgetTotal
    : accountBudget
  const totalBilled = rows.reduce((sum, r) => sum + (r.source === 'transaction' ? 0 : (r.amount || 0)), 0)

  const liveAdvance = liveProjects.reduce((sum, p) => sum + (p.advancePayment || 0), 0)
  const liveMonthly = liveProjects.reduce((sum, p) => sum + (p.monthlyDue || 0), 0)
  const projectAdvanceTotal = liveAdvance || projects.reduce((sum, p) => sum + (p.advancePayment || 0), 0)
  const projectMonthlyDueTotal = liveMonthly || projects.reduce((sum, p) => sum + (p.monthlyDue || 0), 0)

  return {
    rows,
    advancePayment: projectAdvanceTotal > 0 ? projectAdvanceTotal : (client?.advancePayment || 0),
    monthlyDue: projectMonthlyDueTotal > 0 ? projectMonthlyDueTotal : (client?.monthlyDue || 0),
    totalAmount,
    totalBilled,
    projectBudgetTotal,
    accountBudget,
  }
}

const isBillable = (r) => r.source !== 'transaction'

const rowDue = (r) => Math.max(0, (r.amount || 0) - (r.paid || 0))

export function summarizeBilling(billing) {
  const rows = billing?.rows || []

  const advancePayment = billing?.advancePayment || 0
  const monthlyDue = billing?.monthlyDue || 0

  const billed = rows.filter(isBillable).reduce((s, r) => s + (r.amount || 0), 0)

  const totalAmount = Number(billing?.totalAmount) > 0 ? Number(billing.totalAmount) : billed
  const paid = rows.reduce((s, r) => s + (r.paid || 0), 0)

  const pending = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid')
    .reduce((s, r) => s + rowDue(r), 0)

  const balance = Math.max(0, Math.max(totalAmount, billed) - paid)

  const dueOn = (r) => r.dueDate || r.date || ''
  const next = rows
    .filter((r) => isBillable(r) && r.status !== 'Paid' && dueOn(r))
    .sort((a, b) => new Date(dueOn(a)) - new Date(dueOn(b)))[0]

  const overdue = rows.some((r) => r.status === 'Overdue')

  return { rows, advancePayment, monthlyDue, totalAmount, billed, paid, pending, balance, next, nextDueDate: next ? dueOn(next) : '', overdue }
}

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
