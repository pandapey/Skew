import { asyncHandler } from '../utils/asyncHandler.js'
import { Employee } from '../models/Employee.js'
import { Attendance } from '../models/attendanceModels.js'
import { LeaveRequest } from '../models/leaveModels.js'
import { Transaction, Budget, Invoice } from '../models/financeModels.js'
import { Project, ProjectTask } from '../models/projectModels.js'
import { Client, ClientProject } from '../models/clientModels.js'
import { ClientNotification } from '../models/clientModels.js'
import { CalendarEvent } from '../models/calendarModels.js'
// PHASE SALARY/PROJECT AUDIT (DASHBOARD BUG 1): the EXISTING visibility rules
// are imported, never re-derived, so the dashboard can never show a task or a
// meeting that the Tasks page / Calendar would hide from the same user.
import { accessibleProjectFilter } from '../services/projectService.js'
import { meetingVisibilityFilter } from './calendarController.js'

// Home-dashboard stats matching the shape dashboardService.stats consumes
// (services.js). Built from live collections instead of the in-memory store.
export const dashboardStats = asyncHandler(async (req, res) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const [
    employees, projects, clients, pendingLeaves,
    incomeThis, incomePrev,
    recentEmployees, recentProjects, recentLeaves,
  ] = await Promise.all([
    Employee.estimatedDocumentCount(),
    Project.countDocuments({ status: 'Active' }),
    // PHASE DASHBOARD (TASK 1) ROOT CAUSE FIX: the client count was previously
    // derived from `ClientProject.estimatedDocumentCount()` — i.e. the number of
    // client-project rows — which EXCLUDED every client that had no project
    // assigned. The authoritative source for "clients in the system" is the Client
    // collection itself (Client.clientId — the organisation record), which every
    // client-portal User is linked to via User.clientId === Client.clientId.
    // Counting Client documents gives the true total: clients with projects,
    // without projects, newly created and existing.
    Client.countDocuments(),
    LeaveRequest.countDocuments({ status: 'Pending' }),
    Transaction.aggregate([
      { $match: { type: 'Income', date: { $gte: monthStart.toISOString().slice(0, 10) } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { type: 'Income', date: { $gte: prevMonthStart.toISOString().slice(0, 10), $lt: monthStart.toISOString().slice(0, 10) } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Employee.find().sort({ createdAt: -1 }).limit(6).lean(),
    Project.find().sort({ createdAt: -1 }).limit(6).lean(),
    LeaveRequest.find().sort({ createdAt: -1 }).limit(6).lean(),
  ])

  // Real financial + attendance breakdowns straight from MongoDB so the
  // dashboard charts are never placeholders.
  const fin = await computeFinance({})
  const att = await computeAttendance({})

  // -------------------------------------------------------------------------
  // PHASE SALARY/PROJECT AUDIT (DASHBOARD BUG 1) — "My Tasks" AND "Upcoming
  // Meetings" WERE HARDCODED EMPTY ARRAYS.
  //
  // TRACE: pages/ClassicDashboard.jsx renders a "My Tasks" widget from
  //        `data.tasks` and an "Upcoming Meetings" widget from `data.meetings`
  //        -> dashboardService.stats() -> GET /api/dashboard/stats -> here.
  //
  // ROOT CAUSE: this handler shipped `tasks: []` and `meetings: []` as literals.
  // Both collections exist and are populated (ProjectTask, CalendarEvent), so
  // the two widgets rendered their empty state permanently for Admin, HR,
  // Manager and Client — "No open tasks yet." / "No upcoming events." — and the
  // widget was indistinguishable from a genuinely empty account. That is the
  // "mock data still being used where MongoDB data should be" case.
  //
  // FIX: read the real collections, scoped by the EXISTING authorization
  // helpers rather than a new rule:
  //   * tasks    -> ProjectTask assigned to the caller by name, restricted to
  //                 projects accessibleProjectFilter() already grants them.
  //                 Same scope projectService.tasks() applies, so the dashboard
  //                 can never show a task the Tasks page would hide.
  //   * meetings -> CalendarEvent filtered by meetingVisibilityFilter(), the
  //                 same scope GET /calendar/list and /calendar/range use.
  // `projectId` / `id` ride along so the widgets can navigate to the record.
  const upcomingFrom = new Date()
  const meetingScope = await meetingVisibilityFilter(req.user)
  const meetingFilter = { start: { $gte: upcomingFrom } }
  const [myTaskRows, meetingRows] = await Promise.all([
    req.user?.name
      ? (async () => {
        const scope = await accessibleProjectFilter(req.user)
        const filter = { assignee: req.user.name, status: { $ne: 'Done' } }
        if (scope.$or) {
          filter.project = { $in: await Project.find(scope).distinct('_id') }
        }
        return ProjectTask.find(filter).sort({ dueDate: 1 }).limit(6).lean()
      })()
      : [],
    CalendarEvent.find(
      meetingScope ? { $and: [meetingFilter, meetingScope] } : meetingFilter
    ).sort({ start: 1 }).limit(6).lean(),
  ])

  const myTasks = myTaskRows.map((t) => ({
    id: String(t._id),
    title: t.title,
    due: t.dueDate || null,
    priority: t.priority || 'Medium',
    status: t.status,
    // The widget links through to the owning project's detail page.
    projectId: t.project ? String(t.project) : null,
  }))

  const upcomingMeetings = meetingRows.map((m) => ({
    id: String(m._id),
    title: m.title,
    start: m.start,
    // Preserved as a preformatted label because the existing widget renders
    // `m.time` directly; `start` is also exposed for callers that format it.
    time: m.start ? new Date(m.start).toLocaleString() : '',
    attendees: (m.attendees || []).length,
    type: m.type || 'event',
    projectId: m.projectId ? String(m.projectId) : null,
  }))

  const cur = incomeThis[0]?.total || 0
  const prev = incomePrev[0]?.total || 0
  const revenueTrend = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0

  const feed = [
    ...recentLeaves.map((l) => ({ id: `act-lv-${l._id}`, user: l.employee || 'Someone', action: `applied for ${l.type || 'leave'}`, ts: l.createdAt })),
    ...recentEmployees.map((e) => ({ id: `act-emp-${e._id}`, user: e.name || 'New employee', action: e.designation ? `joined as ${e.designation}` : 'joined the team', ts: e.createdAt || e.joiningDate })),
    ...recentProjects.map((p) => ({ id: `act-prj-${p._id}`, user: p.lead || p.manager || 'Project team', action: `created project "${p.name}"`, ts: p.createdAt || p.startDate })),
  ]
    .filter((a) => a.ts)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 6)
    .map((a) => ({ id: a.id, user: a.user, action: a.action, time: timeAgo(a.ts) }))

  res.json({
    employees, projects, clients, pendingLeaves,
    trends: {
      // PHASE SALARY/PROJECT AUDIT: these four were literal `0`s. StatCard's own
      // contract is "only show the trend chip when a real, finite number was
      // computed — never fabricate a 'vs last month' delta", and 0 IS finite, so
      // every one of these KPI cards rendered a confident "0% vs last month" for
      // a month-over-month comparison that was never calculated. `null` is the
      // honest value and makes StatCard omit the chip, exactly as designed.
      // `revenue` below is genuinely derived (this month vs last month of Income
      // transactions) and is unchanged.
      employees: null, projects: null, clients: null, pendingLeaves: null,
      revenue: revenueTrend, profitMargin: fin.kpis.profitMargin,
    },
    // Real monthly revenue vs expense (computed from Finance transactions).
    revenue: fin.charts.monthlyTrend,
    // Real weekly attendance split (present vs absent) from Attendance docs.
    attendance: att.charts.monthlyTrend.map((w) => ({ day: w.week, present: w.present, absent: w.absent })),
    activities: feed,
    meetings: upcomingMeetings,
    tasks: myTasks,
    notifications: req.user?.role === 'Client'
      ? await ClientNotification.countDocuments({ clientId: req.user.clientId, read: false })
      : 0,
  })
})

function timeAgo(input) {
  const then = new Date(input).getTime()
  if (Number.isNaN(then)) return ''
  const s = Math.floor(Math.max(0, Date.now() - then) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// --- small aggregation helpers (all run in JS over fetched docs) ---
const countBy = (arr, keyFn) => {
  const m = {}
  arr.forEach((x) => { const k = keyFn(x); m[k] = (m[k] || 0) + 1 })
  return m
}
const pairs = (m) => Object.entries(m).map(([name, value]) => ({ name, value }))
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0)

// Range filter for string YYYY-MM-DD fields.
const dateRange = (field, from, to) => {
  const f = {}
  if (from) f.$gte = from
  if (to) f.$lte = to
  return Object.keys(f).length ? { [field]: f } : {}
}

// Extract a 'YYYY-MM' key from a Date or a 'YYYY-MM-DD'/ISO string. Returns
// null when the input can't be resolved to a real date. This makes byMonth
// robust to both the string date fields (e.g. Transaction.date) and Mongoose
// Date timestamps (e.g. Deal.createdAt), which previously broke trend charts.
const ymKey = (d) => {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(String(d).slice(0, 10))
  if (isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

// Bucket docs by calendar month; valueFns maps output key -> (doc)=>number.
const byMonth = (arr, dateFn, valueFns) => {
  const m = {}
  arr.forEach((x) => {
    const ym = ymKey(dateFn(x))
    if (!ym) return
    const mi = Number(ym.slice(5, 7)) - 1
    const b = (m[mi] ||= { month: MONTHS[mi] })
    Object.entries(valueFns).forEach(([k, fn]) => { b[k] = (b[k] || 0) + fn(x) })
  })
  return Object.keys(m).map(Number).sort((a, b) => a - b).map((i) => m[i])
}

// Attendance weekly trend (weeks from day-of-month).
const byWeek = (arr) => {
  const m = {}
  arr.forEach((x) => {
    if (!x.date) return
    const day = Number(x.date.slice(8, 10))
    const w = Math.min(4, Math.floor((day - 1) / 7))
    const b = (m[w] ||= { week: `Week ${w + 1}`, present: 0, absent: 0, late: 0 })
    if (x.status === 'Present') b.present += 1
    else if (x.status === 'Absent' || x.status === 'On Leave') b.absent += 1
    else if (x.status === 'Late') b.late += 1
  })
  return Object.keys(m).map(Number).sort((a, b) => a - b).map((i) => ({ ...m[i], week: `Week ${i + 1}` }))
}

// Average working hours by weekday. Phase 7.2 (TASK 3): Overtime REMOVED —
// the key stays as 0 so existing consumers of this report keep working.
const byWeekday = (arr) => {
  const m = {}
  arr.forEach((x) => {
    if (!x.date) return
    const dow = new Date(x.date).getDay()
    const label = DAYS[(dow + 6) % 7]
    const b = (m[label] ||= { day: label, hours: 0, overtime: 0, _n: 0 })
    b.hours += x.workingHours || 0
    b._n += 1
  })
  return DAYS.filter((d) => m[d]).map((d) => {
    const b = m[d]
    return { day: d, hours: +(b.hours / (b._n || 1)).toFixed(1), overtime: 0 }
  })
}

/* ------------------------------- Employees ------------------------------- */
const computeEmployees = async (query = {}) => {
  const { department } = query
  const filter = department && department !== 'all' ? { department } : {}
  const list = await Employee.find(filter).lean()
  const byDept = pairs(countBy(list, (e) => e.department))
  const byStatus = pairs(countBy(list, (e) => e.status))
  const genderSplit = pairs(countBy(list, (e) => e.gender || 'Other'))
  // Real headcount growth: count hires (joiningDate, falling back to createdAt)
  // bucketed into each of the last six calendar months. No synthetic values.
  const now = new Date()
  const growth = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    growth.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, month: MONTHS[d.getMonth()], headcount: 0 })
  }
  const gIdx = Object.fromEntries(growth.map((g, i) => [g.key, i]))
  list.forEach((e) => {
    const src = e.joiningDate || e.createdAt
    const ym = ymKey(src)
    if (ym && ym in gIdx) growth[gIdx[ym]].headcount += 1
  })
  const table = list.map((e) => ({
    id: String(e._id), name: e.name, department: e.department, designation: e.designation,
    status: e.status, ctc: e.salary?.ctc || 0, performance: e.performance || 0,
  }))
  return {
    kpis: {
      total: list.length,
      active: list.filter((e) => e.status === 'Active').length,
      onLeave: list.filter((e) => e.status === 'On Leave').length,
      departments: byDept.length,
      avgSalary: list.length ? Math.round(sum(list, (e) => e.salary?.ctc || 0) / list.length) : 0,
      avgPerformance: list.length ? Math.round(sum(list, (e) => e.performance || 0) / list.length) : 0,
    },
    charts: { byDept, byStatus, genderSplit, growth },
    table,
  }
}

/* ------------------------------- Attendance ------------------------------- */
const computeAttendance = async (query = {}) => {
  const { from, to, department } = query
  const filter = { ...dateRange('date', from, to) }
  if (department && department !== 'all') filter.department = department
  const rows = await Attendance.find(filter).lean()
  const present = rows.filter((r) => r.status === 'Present').length
  const late = rows.filter((r) => r.status === 'Late').length
  const earlyExit = rows.filter((r) => r.status === 'Early Exit').length
  const absent = rows.filter((r) => r.status === 'Absent').length
  const onLeave = rows.filter((r) => r.status === 'On Leave').length
  // Phase 7.2 (TASK 3): Overtime REMOVED — the key stays as 0 so existing
  // consumers of this report (AttendanceReports page) keep reading it.
  const totalOvertime = 0
  const avgHours = +(sum(rows, (r) => r.workingHours || 0) / (rows.length || 1)).toFixed(1)

  const deptMap = {}
  rows.forEach((r) => {
    deptMap[r.department] ||= { name: r.department, present: 0, absent: 0, late: 0, total: 0 }
    deptMap[r.department].total += 1
    if (r.status === 'Present') deptMap[r.department].present += 1
    else if (r.status === 'Absent' || r.status === 'On Leave') deptMap[r.department].absent += 1
    else if (r.status === 'Late') deptMap[r.department].late += 1
  })
  const statusSplit = [
    { name: 'Present', value: present }, { name: 'Late', value: late },
    { name: 'Early Exit', value: earlyExit }, { name: 'Absent', value: absent },
    { name: 'On Leave', value: onLeave },
  ].filter((s) => s.value > 0)

  const table = rows.map((r) => ({
    id: String(r._id), employee: r.employee, department: r.department, date: r.date,
    status: r.status, checkIn: r.checkIn, checkOut: r.checkOut,
    workingHours: r.workingHours,
    // Phase 7.2 (TASK 3): Overtime REMOVED — the key stays as 0.
    overtimeHours: 0,
  }))
  return {
    kpis: {
      present, late, absent, onLeave,
      attendanceRate: rows.length ? Math.round(((present + late + earlyExit) / rows.length) * 100) : 0,
      avgHours, totalOvertime,
    },
    charts: { statusSplit, byDepartment: Object.values(deptMap), monthlyTrend: byWeek(rows), hoursTrend: byWeekday(rows) },
    table,
  }
}

/* -------------------------------- Leaves -------------------------------- */
const computeLeaves = async (query = {}) => {
  const { from, to, department } = query
  const filter = { ...dateRange('from', from, to) }
  if (department && department !== 'all') filter.department = department
  const all = await LeaveRequest.find(filter).lean()
  const byStatus = ['Pending', 'Approved', 'Rejected', 'Cancelled']
    .map((name) => ({ name, value: all.filter((r) => r.status === name).length }))
  const byType = pairs(countBy(all, (r) => r.type))
  const deptMap = {}
  all.filter((r) => r.status === 'Approved').forEach((r) => { deptMap[r.department] = (deptMap[r.department] || 0) + (r.days || 0) })
  const byDepartment = Object.entries(deptMap).map(([name, value]) => ({ name, value }))
  const monthlyTrend = byMonth(all, (r) => r.from, {
    approved: (r) => (r.status === 'Approved' ? 1 : 0), rejected: (r) => (r.status === 'Rejected' ? 1 : 0),
  })
  const table = all.map((r) => ({
    id: String(r._id), employee: r.employee, department: r.department, type: r.type,
    from: r.from, to: r.to, days: r.days, status: r.status, reason: r.reason,
  }))
  return {
    kpis: {
      total: all.length,
      pending: all.filter((r) => r.status === 'Pending').length,
      approved: all.filter((r) => r.status === 'Approved').length,
      rejected: all.filter((r) => r.status === 'Rejected').length,
      totalDaysApproved: sum(all.filter((r) => r.status === 'Approved'), (r) => r.days || 0),
    },
    charts: { byStatus, byType, byDepartment, monthlyTrend },
    table,
  }
}

/* -------------------------------- Finance -------------------------------- */
const computeFinance = async (query = {}) => {
  const { from, to } = query
  const txns = await Transaction.find(dateRange('date', from, to)).lean()
  const income = sum(txns.filter((t) => t.type === 'Income'), (t) => t.amount)
  const expense = sum(txns.filter((t) => t.type === 'Expense'), (t) => t.amount)
  const monthlyTrend = byMonth(txns, (t) => t.date, {
    revenue: (t) => (t.type === 'Income' ? t.amount : 0),
    expense: (t) => (t.type === 'Expense' ? t.amount : 0),
  })
  const expenseByCategory = pairs(countBy(txns.filter((t) => t.type === 'Expense'), (t) => t.category)).sort((a, b) => b.value - a.value)
  const incomeByCategory = pairs(countBy(txns.filter((t) => t.type === 'Income'), (t) => t.category)).sort((a, b) => b.value - a.value)
  const invoices = await Invoice.find().lean()
  const outstanding = sum(invoices.filter((i) => !['Paid', 'Draft'].includes(i.status)), (i) => (i.total || 0) - (i.amountPaid || 0))
  const budgets = (await Budget.find().lean()).map((b) => ({ category: b.category, allocated: b.allocated, spent: b.spent, status: b.status }))
  const table = txns.map((t) => ({
    id: String(t._id), title: t.title, type: t.type, category: t.category,
    amount: t.amount, taxRate: t.taxRate, date: t.date, method: t.method,
  }))
  return {
    kpis: {
      totalIncome: income, totalExpense: expense,
      netProfit: income - expense,
      profitMargin: income ? Math.round(((income - expense) / income) * 100) : 0,
      outstandingAmount: outstanding, totalInvoices: invoices.length,
    },
    charts: { monthlyTrend, expenseByCategory, incomeByCategory, budgets },
    table,
  }
}

/* ------------------------------- Projects ------------------------------- */
const computeProjects = async (query = {}) => {
  const { from, to } = query
  const projects = await Project.find(dateRange('startDate', from, to)).lean()
  const tasks = await ProjectTask.find().lean()
  const byStatus = Object.entries(countBy(projects, (p) => p.status)).map(([name, value]) => ({ name, value })).filter((x) => x.value)
  const tasksByStatus = Object.entries(countBy(tasks, (t) => t.status)).map(([name, value]) => ({ name, value }))
  const byPriority = Object.entries(countBy(tasks, (t) => t.priority)).map(([name, value]) => ({ name, value }))
  const monthlyTrend = byMonth(projects, (p) => p.startDate, { created: () => 1, done: (p) => (p.status === 'Completed' ? 1 : 0) })
  const table = projects.map((p) => ({
    id: String(p._id), name: p.name, code: p.code, client: p.client, lead: p.lead,
    status: p.status, priority: p.priority, progress: p.progress, budget: p.budget,
  }))
  return {
    kpis: {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'Active').length,
      completedProjects: projects.filter((p) => p.status === 'Completed').length,
      totalTasks: tasks.length,
      doneTasks: tasks.filter((t) => t.status === 'Done').length,
      openBugs: tasks.filter((t) => t.type === 'Bug' && t.status !== 'Done').length,
      avgProgress: projects.length ? Math.round(sum(projects, (p) => p.progress || 0) / projects.length) : 0,
    },
    charts: { byStatus, tasksByStatus, byPriority, monthlyTrend },
    table,
  }
}

/* ------------------------------- Dashboard ------------------------------- */
const computeDashboard = async (query = {}) => {
  // Phase 5.5 (Tasks 8/9): CRM and Inventory removed. The remaining five
  // reports are unchanged, so every other dashboard KPI keeps its exact
  // previous value.
  const [emp, att, fin, proj, lv] = await Promise.all([
    computeEmployees(query), computeAttendance(query), computeFinance(query),
    computeProjects(query), computeLeaves(query),
  ])
  return {
    kpis: [
      { key: 'employees', label: 'Total Employees', value: emp.kpis.total, icon: 'users', tone: 'primary' },
      { key: 'present', label: 'Present Today', value: att.kpis.present, icon: 'clock', tone: 'success' },
      { key: 'leaves', label: 'Pending Leaves', value: lv.kpis.pending, icon: 'calendar', tone: 'warning' },
      { key: 'revenue', label: 'Net Profit', value: fin.kpis.netProfit, icon: 'rupee', tone: 'accent' },
      { key: 'projects', label: 'Active Projects', value: proj.kpis.activeProjects, icon: 'folder', tone: 'warning' },
      { key: 'tasks', label: 'Open Tasks', value: proj.kpis.totalTasks - proj.kpis.doneTasks, icon: 'folder', tone: 'primary' },
    ],
    charts: {
      revenueTrend: fin.charts.monthlyTrend,
      attendanceSplit: att.charts.statusSplit,
      headcountByDept: emp.charts.byDept,
      projectStatus: proj.charts.byStatus,
    },
  }
}

// --- HTTP handlers (all protected by `protect` in the router) ---
const json = (fn) => async (req, res) => res.json(await fn(req.query))

export const dashboardReport = json(computeDashboard)
export const employeesReport = json(computeEmployees)
export const attendanceReport = json(computeAttendance)
export const leavesReport = json(computeLeaves)
export const financeReport = json(computeFinance)
export const projectsReport = json(computeProjects)
