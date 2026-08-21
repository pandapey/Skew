// Self-contained seed script. Generates ALL demo data in-server — no import
// from the client codebase. Run with: npm run seed
//
// Uses deterministic (loop-based) generation so the data is repeatable.
// Collections that have pre-save hooks (User password hashing, Employee
// salary/empCode derivation, Product/Budget status sync) are written with
// Model.create() so the hooks run; for the rest we use insertMany.

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from './config/db.js'

import { User } from './models/User.js'
import { Employee } from './models/Employee.js'
import {
  Department, Designation, JobOpening, Candidate, Interview,
  Offer, Onboarding, Payroll, Review, Movement,
} from './models/hrModels.js'
import {
  Client, ClientProject, ClientAnnouncement, ClientMessage, ClientNotification,
  // PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 7): the client subscription plan
  // catalogue that the Client Creation dropdown reads from.
  Plan,
} from './models/clientModels.js'
import { Attendance, Shift, Holiday } from './models/attendanceModels.js'
import { LeaveType, LeaveBalance, LeaveRequest } from './models/leaveModels.js'
import {
  Project, Sprint, ProjectTask, Milestone,
  ProjectComment, ProjectFile, ProjectActivity,
} from './models/projectModels.js'
import {
  Transaction, FinanceCategory, Budget, Invoice, Payment,
} from './models/financeModels.js'
import { Folder, FileItem } from './models/fileModels.js'
import { Notification } from './models/notificationModels.js'
import { Post } from './models/announcementModels.js'
import { CalendarEvent } from './models/calendarModels.js'
import { AuditLog, Activity } from './models/adminModels.js'

dotenv.config()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length]
const pad2 = (n) => String(n).padStart(2, '0')
const fdate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`
const ymdh = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min)

// ---------------------------------------------------------------------------
// Indexes — created once at seed time (idempotent; safe to re-run). Unique
// indexes prevent duplicate business keys; the rest optimise common queries.
// ---------------------------------------------------------------------------
const indexSpecs = [
  [User, { email: 1 }, { unique: true }],
  [Employee, { empCode: 1 }, { unique: true, sparse: true }],
  [Employee, { email: 1 }, { unique: true, sparse: true }],
  [Client, { clientId: 1 }, { unique: true }],
  [ClientProject, { projectId: 1 }, { unique: true }],
  [Project, { code: 1 }, { unique: true, sparse: true }],
  [Invoice, { invoiceNumber: 1 }, { unique: true }],
  [Payment, { paymentNumber: 1 }, { unique: true }],
  [ProjectTask, { project: 1 }],
  [ProjectActivity, { actor: 1, createdAt: -1 }],
  [AuditLog, { user: 1, at: -1 }],
  [Activity, { user: 1, startedAt: -1 }],
  [Notification, { recipient: 1, read: 1 }],
  [ClientNotification, { clientId: 1, read: 1 }],
  [Post, { category: 1, createdAt: -1 }],
  [Transaction, { date: -1, type: 1 }],
  [CalendarEvent, { start: 1 }],
  [Attendance, { employee: 1, date: -1 }],
  [LeaveRequest, { employee: 1, status: 1 }],
]

async function ensureIndexes() {
  for (const [Model, spec, opts] of indexSpecs) {
    try {
      // Ensure the collection exists before indexing (some models are only
      // written later in the seed); createIndex is a no-op if it already exists.
      await Model.createCollection?.().catch(() => {})
      // A non-unique index with the same auto-generated name may already exist
      // (declared by the schema). Drop it so the requested unique index wins.
      const autoName = Object.entries(spec).map(([k, v]) => `${k}_${v}`).join('_')
      if (opts?.unique) {
        await Model.collection.dropIndex(autoName).catch(() => {})
      }
      await Model.collection.createIndex(spec, opts || {})
    } catch (e) {
      console.warn(`  index skipped for ${Model.modelName}: ${e.message}`)
    }
  }
  console.log(' Indexes ensured')
}

// ---------------------------------------------------------------------------
// Auth users (8 demo accounts kept + 2 extra Admin accounts so every role in
// the ROLES enum is represented and there are 5 admin-capable users).
// ---------------------------------------------------------------------------
const users = [
  // Phase 5 (Task 1): every staff demo account carries a gender so the
  // gender-based leave filtering in Task 2 is demonstrable out of the box
  // (a Male account sees Paternity, a Female account sees Maternity).
  // Client accounts have no Employee HR profile, so they carry no gender.
  { name: 'Aarav Mehta', email: 'admin@skew.com', password: 'admin123', role: 'Admin', department: 'Management', designation: 'CTO', gender: 'Male' },
  { name: 'Priya Sharma', email: 'hr@skew.com', password: 'hr123', role: 'Manager', department: 'Human Resources', designation: 'HR Manager', gender: 'Female' },
  { name: 'Rahul Verma', email: 'manager@skew.com', password: 'manager123', role: 'Manager', department: 'Engineering', designation: 'Engineering Lead', gender: 'Male' },
  { name: 'Sneha Patel', email: 'sales@skew.com', password: 'sales123', role: 'Manager', department: 'Sales', designation: 'Sales Executive', gender: 'Female' },
  { name: 'Karan Singh', email: 'finance@skew.com', password: 'finance123', role: 'Manager', department: 'Finance', designation: 'Accountant', gender: 'Male' },
  { name: 'Divya Nair', email: 'employee@skew.com', password: 'emp123', role: 'Employee', department: 'Engineering', designation: 'Software Engineer', gender: 'Female' },
  { name: 'Neha Gupta', email: 'admin2@skew.com', password: 'admin123', role: 'Admin', department: 'Management', designation: 'Operations Director', gender: 'Female' },
  { name: 'Vikram Rao', email: 'admin3@skew.com', password: 'admin123', role: 'Admin', department: 'Management', designation: 'IT Administrator', gender: 'Male' },
  { name: 'Rohan Kapoor', email: 'client@skew.com', password: 'client123', role: 'Client', department: 'Nova Retail Pvt Ltd', designation: 'Head of Digital', clientId: 'cl-1' },
  { name: 'Meera Nair', email: 'client2@skew.com', password: 'client123', role: 'Client', department: 'BrightWave Solutions', designation: 'CTO', clientId: 'cl-2' },
]

// ---------------------------------------------------------------------------
// Name pools for deterministic generation
// ---------------------------------------------------------------------------
const FIRST = ['Aarav', 'Diya', 'Vivaan', 'Ananya', 'Arjun', 'Isha', 'Reyansh', 'Kavya', 'Aditya', 'Saanvi', 'Vihaan', 'Aadhya', 'Krishna', 'Myra', 'Kabir', 'Anika', 'Rudra', 'Ahana', 'Arnav', 'Kiara']
const LAST = ['Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Nair', 'Reddy', 'Iyer', 'Kapoor', 'Bose', 'Rao', 'Menon', 'Shah', 'Gill', 'Pillai', 'Mehta', 'Das', 'Chopra', 'Bhat', 'Joshi']
const DESIGNATION_BY_DEPT = {
  Engineering: 'Software Engineer',
  Sales: 'Sales Executive',
  'Human Resources': 'HR Executive',
  Finance: 'Accountant',
  Marketing: 'Marketing Specialist',
  Design: 'UX Designer',
  Operations: 'Operations Lead',
  Support: 'Support Engineer',
  Legal: 'Legal Counsel',
}
const DEPARTMENTS = ['Engineering', 'Sales', 'Human Resources', 'Finance', 'Marketing', 'Design', 'Operations', 'Support', 'Legal']

async function seed() {
  await connectDB(process.env.MONGO_URI)
  await ensureIndexes()

  // === Users ==============================================================
  await User.deleteMany({})
  for (const u of users) await User.create(u)
  const userDocs = await User.find({})
  console.log(` Seeded ${userDocs.length} users`)

  // === Employees (20) =====================================================
  await Employee.deleteMany({})
  const empDocs = []
  for (let i = 0; i < 20; i++) {
    const first = pick(FIRST, i)
    const last = pick(LAST, i)
    const dept = pick(DEPARTMENTS, i)
    empDocs.push(await Employee.create({
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@skew.com`,
      phone: `+91 9${String(80001234 + i).slice(0, 8)}`,
      department: dept,
      designation: DESIGNATION_BY_DEPT[dept],
      employmentType: i % 9 === 0 ? 'Contract' : 'Full-time',
      // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2): `workLocation` removed
      // from the seed - the path no longer exists on the Employee schema, so
      // Mongoose would have silently dropped it anyway.
      gender: i % 2 ? 'Male' : 'Female',
      dob: new Date(1990 + (i % 10), (i * 3) % 12, 1 + (i % 27)),
      bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'O-'], i),
      maritalStatus: i % 4 === 0 ? 'Married' : 'Single',
      address: `${100 + i} Residency Layout, ${pick(['Bengaluru', 'Mumbai', 'Delhi'], i)}`,
      joiningDate: new Date(2021 + (i % 4), (i * 5) % 12, 1 + (i % 27)),
      experienceYears: String(1 + (i % 12)),
      status: i % 7 === 0 ? 'On Leave' : 'Active',
      performance: 60 + (i % 40),
      salary: { ctc: 400000 + i * 50000 },
      bank: { name: 'HDFC Bank', account: String(501001234500 + i), ifsc: 'HDFC0001234' },
      skills: [
        { name: pick(['JavaScript', 'Python', 'Java', 'Go', 'React'], i), level: pick(['Intermediate', 'Advanced', 'Expert'], i) },
        { name: pick(['Node.js', 'AWS', 'SQL', 'Figma', 'Salesforce'], i + 1), level: pick(['Beginner', 'Intermediate', 'Advanced'], i + 1) },
      ],
    }))
  }
  console.log(` Seeded ${empDocs.length} employees`)
  const empNames = empDocs.map((e) => e.name)

  // === HR data ============================================================
  await Promise.all([
    Department.deleteMany({}), Designation.deleteMany({}),
    JobOpening.deleteMany({}), Candidate.deleteMany({}), Interview.deleteMany({}),
    Offer.deleteMany({}), Onboarding.deleteMany({}), Payroll.deleteMany({}),
    Review.deleteMany({}), Movement.deleteMany({}),
  ])

  await Department.insertMany(DEPARTMENTS.map((name, i) => ({
    name, code: name.slice(0, 3).toUpperCase(), head: pick(empNames, i),
    headcount: 6 + i * 2, budget: 3000000 + i * 1000000, status: 'Active',
  })))
  await Designation.insertMany(DEPARTMENTS.flatMap((dept, di) => [
    { title: DESIGNATION_BY_DEPT[dept], department: dept, level: 'L2', grade: 'G3', count: 8 + di },
    { title: `Senior ${DESIGNATION_BY_DEPT[dept]}`, department: dept, level: 'L3', grade: 'G4', count: 3 + di },
  ]))
  const jtitles = ['Senior React Developer', 'Product Designer', 'Sales Executive', 'DevOps Engineer', 'QA Engineer', 'Data Analyst', 'Scrum Master', 'HR Business Partner']
  await JobOpening.insertMany(jtitles.map((title, i) => ({
    title, department: pick(DEPARTMENTS, i), location: 'Bengaluru HQ',
    type: 'Full-time', openings: 1 + (i % 4), applicants: 10 + i * 8,
    experience: `${2 + (i % 6)}+ yrs`, status: i % 4 === 0 ? 'On Hold' : 'Open',
  })))
  await Candidate.insertMany(Array.from({ length: 8 }, (_, i) => ({
    name: `${pick(FIRST, i + 5)} ${pick(LAST, i + 5)}`,
    email: `candidate${i}@mail.com`, position: pick(jtitles, i),
    source: pick(['LinkedIn', 'Referral', 'Naukri', 'Website', 'Indeed'], i),
    stage: pick(['Applied', 'Screening', 'Interview', 'Offer', 'Hired'], i),
    rating: 1 + (i % 5), appliedAt: new Date(2026, 6, 1 + i),
  })))
  await Interview.insertMany(Array.from({ length: 8 }, (_, i) => ({
    candidate: `${pick(FIRST, i + 5)} ${pick(LAST, i + 5)}`, position: pick(jtitles, i),
    round: pick(['Screening', 'Technical', 'Managerial', 'HR Round'], i),
    interviewer: pick(['Rahul Verma', 'Priya Sharma', 'Neha Gupta'], i),
    date: new Date(2026, 6, 2 + i), time: `${10 + (i % 6)}:00`,
    mode: 'Video Call', status: i % 2 ? 'Completed' : 'Scheduled',
    feedback: i % 2 ? 'Strong technical fundamentals.' : '',
  })))
  await Offer.insertMany(Array.from({ length: 8 }, (_, i) => ({
    candidate: `${pick(FIRST, i + 5)} ${pick(LAST, i + 5)}`, position: pick(jtitles, i),
    department: pick(DEPARTMENTS, i), ctc: 600000 + i * 150000,
    joiningDate: new Date(2026, 8, 1 + i), status: pick(['Sent', 'Accepted', 'Pending', 'Declined'], i),
    sentAt: new Date(2026, 6, 5 + i),
  })))
  await Onboarding.insertMany(Array.from({ length: 8 }, (_, i) => {
    const labels = ['Offer accepted', 'Documents collected', 'System access', 'Orientation', 'First project']
    const done = 1 + (i % labels.length)
    return {
      name: `New Hire ${i + 1}`, position: pick(jtitles, i), department: pick(DEPARTMENTS, i),
      buddy: 'Rahul Verma', joiningDate: new Date(2026, 8, 1 + i), progress: Math.round((done / labels.length) * 100),
      tasks: labels.map((label, li) => ({ label, done: li < done })),
    }
  }))
  // PHASE SALARY STRUCTURE REWORK: seeded Payroll rows now match the current
  // engine's rules exactly (see payrollEngine.js's file header) — Basic
  // remains 50% of Gross Monthly Salary (the ratio is unchanged; HRA/
  // Allowances no longer fill the remaining 50%), PF = 12% of Basic,
  // ESI = 0.75% of the fixed monthly gross, Net = Gross − PF − ESI. TDS/tax
  // is not applied (kept at 0 for the same "truthful 0, not a dormant
  // deduction" reason the engine itself uses). Previously this block
  // independently re-derived hra (20%), allowances (30%) and an 8% tax that
  // had already been removed from the live calculation, AND (in an earlier
  // pass of this same rework) briefly set basic = monthly directly — both
  // made freshly-seeded demo data disagree with what the app actually
  // computes for the same employee.
  await Payroll.insertMany(empDocs.slice(0, 10).map((e, i) => {
    const monthly = Math.round(e.salary.ctc / 12)
    const basic = Math.round(monthly * 0.5)
    const pf = Math.round(basic * 0.12)
    const esi = Math.round(monthly * 0.0075)
    return {
      employee: e.name, empCode: e.empCode, department: e.department, designation: e.designation,
      month: 'July 2026', monthly, basic, pf, esi,
      gross: monthly, total_deductions: pf + esi, net: monthly - pf - esi,
      status: i % 5 === 0 ? 'Pending' : 'Paid',
    }
  }))
  await Review.insertMany(Array.from({ length: 8 }, (_, i) => ({
    employee: empDocs[i].name, department: empDocs[i].department, period: `Q${1 + (i % 4)} 2026`,
    reviewer: 'Rahul Verma', rating: 3 + (i % 3), goalCompletion: 60 + (i % 40),
    status: pick(['Completed', 'In Progress', 'Pending'], i),
  })))
  await Movement.insertMany(['Promotion', 'Transfer', 'Resignation', 'Exit', 'Promotion', 'Transfer', 'Resignation', 'Exit'].map((type, i) => ({
    type, employee: empDocs[i].name, department: empDocs[i].department,
    from: type === 'Promotion' ? 'Software Engineer' : 'Active',
    to: type === 'Promotion' ? 'Senior Engineer' : 'Exited', effectiveDate: new Date(2026, 6, 1 + i),
    reason: 'Business need', status: i % 3 === 0 ? 'Pending' : 'Approved',
  })))
  console.log(' Seeded HR data (departments, designations, jobs, candidates, interviews, offers, onboarding, payroll, reviews, movements)')

  // === Plans (client subscription catalogue) ==============================
  // PHASE SALARY/CLIENT/PROJECT/CONSOLE (TASK 7): the Plan values offered by the
  // Client Creation form are database records now, not a hardcoded frontend
  // array. They MUST be seeded before clients, because `plan` on each seeded
  // Client below has to name a plan that actually exists in the catalogue —
  // otherwise a freshly seeded database would show every client on a plan the
  // dropdown reports as "no longer offered".
  //
  // Note this also fixes a latent inconsistency in the old seed: it wrote the
  // plan 'Pro', which was never one of the four hardcoded dropdown options, so
  // that value could not be reselected once a client's form was opened.
  await Plan.deleteMany({})
  const planCatalogue = [
    { name: 'Starter', code: 'STRT', price: 4999, description: 'Entry tier — single project, email support.' },
    { name: 'Business', code: 'BUSI', price: 14999, description: 'Growing teams — multiple projects, priority support.' },
    { name: 'Professional', code: 'PROF', price: 29999, description: 'Dedicated delivery team and quarterly reviews.' },
    { name: 'Enterprise', code: 'ENTP', price: 74999, description: 'Custom SLA, dedicated manager, unlimited projects.' },
  ]
  const planDocs = await Plan.insertMany(planCatalogue.map((p) => ({ ...p, status: 'Active' })))
  const planNames = planDocs.map((p) => p.name)
  console.log(` Seeded ${planDocs.length} plans`)

  // === Clients (10) + Client Portal data =================================
  await Promise.all([
    Client.deleteMany({}), ClientProject.deleteMany({}),
    // Phase 6.9 (Task 17): client meetings now live on the shared
    // CalendarEvent collection (clientId set) instead of a separate
    // ClientMeeting table - only clear the client-linked events here, not
    // the generic staff meetings seeded further below.
    CalendarEvent.deleteMany({ clientId: { $ne: null } }),
    ClientAnnouncement.deleteMany({}), ClientMessage.deleteMany({}), ClientNotification.deleteMany({}),
  ])
  const clientCompanies = [
    { company: 'Nova Retail Pvt Ltd', contactPerson: 'Rohan Kapoor', industry: 'Retail', gst: '29AABCN1234R1Z2' },
    { company: 'BrightWave Solutions', contactPerson: 'Meera Nair', industry: 'Technology', gst: '27AABCB5678S2Z9' },
    { company: 'Acme Corp', contactPerson: 'Vikram Rao', industry: 'Manufacturing', gst: '29AABCA9012T3Z4' },
    { company: 'Globex Ltd', contactPerson: 'Anjali Menon', industry: 'Finance', gst: '27AABCG3456U4Z1' },
    { company: 'Stark Industries', contactPerson: 'Kabir Shah', industry: 'Energy', gst: '29AABCS7890V5Z7' },
    { company: 'Wayne Enterprises', contactPerson: 'Ahana Das', industry: 'Conglomerate', gst: '27AABCW2345W6Z3' },
    { company: 'Umbrella Inc', contactPerson: 'Arnav Gill', industry: 'Healthcare', gst: '29AABCU6789X7Z8' },
    { company: 'Hooli', contactPerson: 'Myra Pillai', industry: 'Technology', gst: '27AABCH0123Y8Z5' },
    { company: 'Initech', contactPerson: 'Rudra Mehta', industry: 'Software', gst: '29AABCI4567Z9Z2' },
    { company: 'Soylent Co', contactPerson: 'Kiara Chopra', industry: 'Food & Beverage', gst: '27AABCS8901A1Z6' },
  ]
  const clientDocs = []
  for (let i = 0; i < clientCompanies.length; i++) {
    const c = clientCompanies[i]
    clientDocs.push(await Client.create({
      clientId: `cl-${i + 1}`,
      company: c.company, contactPerson: c.contactPerson, designation: pick(['CTO', 'Head of Digital', 'VP Engineering', 'Procurement Head'], i),
      email: `accounts@${c.company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      phone: `+91 80${String(40001122 + i).slice(0, 8)}`, gst: c.gst, industry: c.industry,
      // TASK 7: picked from the plans actually seeded above, so every client's
      // stored plan resolves to a real catalogue entry.
      plan: pick(planNames, i), status: i % 6 === 0 ? 'Onboarding' : 'Active',
      // Phase 6.9 (TASK 10): `accountManager` removed from seeded clients - the
      // field no longer exists on the Client schema, so seeding it would write a
      // value Mongoose immediately discards.
      joinedDate: fdate(2025, 1 + (i % 12), 1 + (i % 27)),
      address: `${200 + i} Tech Park, ${pick(['Bengaluru', 'Mumbai', 'Delhi', 'Pune'], i)}`,
      website: `www.${c.company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
    }))
  }
  console.log(` Seeded ${clientDocs.length} clients`)

  // Client projects: 2 per client => 20.
  const clientProjectDocs = []
  for (let ci = 0; ci < clientDocs.length; ci++) {
    const cl = clientDocs[ci]
    for (let p = 0; p < 2; p++) {
      const idx = ci * 2 + p
      const team = Array.from({ length: 4 }, (_, m) => ({
        name: pick(empNames, idx * 3 + m), roleInProject: m === 0 ? 'Lead' : pick(['Member', 'QA', 'Designer', 'Backend'], m),
        position: pick(DEPARTMENTS, m), department: pick(DEPARTMENTS, m), availability: 'Available', avatar: '',
      }))
      const tasks = Array.from({ length: 5 }, (_, t) => ({
        title: pick(['Build login page', 'Integrate payments', 'Design dashboard', 'Write API docs', 'Setup CI', 'Fix pagination bug'], t + idx),
        assignee: pick(team, t).name, priority: pick(['Low', 'Medium', 'High', 'Urgent'], t + idx),
        status: pick(['Todo', 'In Progress', 'Review', 'Done'], t + idx), completion: pick([0, 25, 50, 75, 100], t + idx),
        due: fdate(2026, 8, 1 + ((t + idx) % 27)), comments: [],
      }))
      const cp = await ClientProject.create({
        projectId: `cp-${idx + 1}`, clientId: cl.clientId, name: `${cl.company} ${pick(['Portal', 'Mobile App', 'Analytics', 'Platform'], p)}`,
        code: `CP-${100 + idx}`, status: pick(['Planning', 'In Progress', 'Completed', 'On Hold'], idx),
        progress: pick([10, 35, 60, 85, 100], idx), priority: pick(['Low', 'Medium', 'High', 'Urgent'], idx),
        startDate: fdate(2026, 1 + (idx % 6), 1), deliveryDate: fdate(2026, 9, 1 + (idx % 27)),
        projectManager: pick(empNames, idx), budget: 500000 + idx * 100000,
        timeline: [
          { name: 'Discovery', status: 'Completed', date: fdate(2026, 2, 15), notes: 'Requirements gathered' },
          { name: 'Design', status: 'In Progress', date: fdate(2026, 4, 30), notes: 'UI mockups in review' },
          { name: 'Development', status: 'Pending', date: fdate(2026, 7, 31), notes: '' },
          { name: 'Go Live', status: 'Pending', date: fdate(2026, 9, 30), notes: '' },
        ],
        team, tasks,
        activity: [
          // Phase 6.9 (TASK 10): attributed to the project manager instead of the
          // retired account manager, so seeded activity still names a real person.
          { text: `Project ${`cp-${idx + 1}`} created`, at: fdate(2026, 1, 1), by: pick(empNames, idx) },
          { text: 'Kickoff meeting held', at: fdate(2026, 1, 10), by: pick(empNames, idx) },
        ],
        documents: [
          { name: 'SOW.pdf', type: 'Proposal', size: '248 KB', uploadedBy: pick(empNames, idx), uploadedAt: fdate(2026, 1, 5), url: '' },
          { name: 'Wireframes.fig', type: 'Design', size: '1.2 MB', uploadedBy: pick(empNames, idx), uploadedAt: fdate(2026, 2, 20), url: '' },
        ],
        payments: Array.from({ length: 2 }, (_, pm) => ({
          invoice: `INV-${2000 + idx * 2 + pm}`, amount: 150000 + pm * 50000, paid: pm === 0 ? 150000 : 0,
          status: pm === 0 ? 'Paid' : 'Pending', date: fdate(2026, 3 + pm * 2, 1), method: 'Bank Transfer',
        })),
      })
      clientProjectDocs.push(cp)
    }
  }
  console.log(` Seeded ${clientProjectDocs.length} client projects`)

  // Client meetings: 50. Phase 6.9 (Task 17) ROOT CAUSE FIX: seeded directly
  // onto the shared CalendarEvent collection (clientId set, meetingStatus
  // instead of the old upcoming/past/cancelled vocabulary) so they are the
  // SAME rows the internal Calendar and the Client Portal both read.
  await CalendarEvent.insertMany(Array.from({ length: 50 }, (_, i) => {
    const cl = pick(clientDocs, i)
    const day = 1 + (i % 27)
    const start = ymdh(2026, 7 + (i % 3), day, 10 + (i % 6), 30)
    return {
      title: pick(['Sprint Review', 'Requirements Walkthrough', 'Demo & Feedback', 'Quarterly Business Review', 'UAT Sign-off'], i),
      type: 'meeting',
      start, end: new Date(start.getTime() + 60 * 60 * 1000),
      allDay: false,
      location: 'https://meet.skew.com/room',
      description: i % 3 === 0 ? 'Client requested timeline slip.' : 'Review progress and next steps.',
      clientId: cl.clientId,
      meetingStatus: i % 4 === 0 ? 'Cancelled' : 'Approved',
    }
  }))

  // Client announcements: 20.
  await ClientAnnouncement.insertMany(Array.from({ length: 20 }, (_, i) => ({
    title: pick(['New Feature Released', 'Scheduled Maintenance', 'Holiday Hours', 'Security Update', 'Product Webinar', 'Policy Change'], i),
    body: 'We are pleased to share an update regarding your engagement with Skew Enterprise Hub.',
    date: fdate(2026, 7 + (i % 3), 1 + (i % 27)),
    tag: pick(['Update', 'Announcement', 'Event', 'Maintenance'], i), pinned: i % 6 === 0,
  })))

  // Client messages: 15 threads.
  await ClientMessage.insertMany(Array.from({ length: 15 }, (_, i) => {
    const cl = pick(clientDocs, i)
    return {
      clientId: cl.clientId, subject: pick(['Question about invoice', 'Feature request', 'Login issue', 'Onboarding query', 'Demo feedback'], i),
      // Phase 6.9 (TASK 10): the staff side of a seeded client conversation is
      // now an ordinary employee rather than the retired account manager.
      participants: [cl.contactPerson, pick(empNames, i)],
      messages: [
        { from: cl.contactPerson, at: fdate(2026, 7, 1 + i) + ' 10:15', text: 'Hi, could you help with a quick question about the dashboard?' },
        { from: pick(empNames, i), at: fdate(2026, 7, 1 + i) + ' 11:02', text: 'Sure, happy to help. What are you seeing?' },
      ],
    }
  }))

  // Client notifications: 40.
  await ClientNotification.insertMany(Array.from({ length: 40 }, (_, i) => {
    const cl = pick(clientDocs, i)
    return {
      clientId: cl.clientId, title: pick(['Invoice generated', 'Meeting scheduled', 'Task completed', 'Document shared', 'Milestone reached'], i),
      body: 'Tap to view the details in your portal.', at: fdate(2026, 7 + (i % 3), 1 + (i % 27)) + ' 09:30',
      read: i % 3 === 0, icon: pick(['invoice', 'meeting', 'task', 'document', 'update'], i),
    }
  }))
  console.log(' Seeded client portal (meetings, announcements, messages, notifications)')

  // === Projects (25) + Tasks (150) =======================================
  await Promise.all([
    Project.deleteMany({}), Sprint.deleteMany({}), ProjectTask.deleteMany({}),
    Milestone.deleteMany({}), ProjectComment.deleteMany({}), ProjectFile.deleteMany({}), ProjectActivity.deleteMany({}),
  ])
  const projNames = [
    'Apollo Portal', 'Nova Portal', 'Orion Mobile App', 'Zenith Dashboard', 'Helix API Platform', 'Pulse Analytics',
    'Atlas Billing', 'Comet Chat', 'Vega Reporting', 'Lumen Docs', 'Quasar Search', 'Triton Payments',
    'Meteor Notifications', 'Nimbus Storage', 'Falcon Security', 'Cobalt Insights', 'Drift Onboarding',
    'Echo Voice', 'Forge Integrations', 'Gizmo IoT', 'Halo Support', 'Iris Design System', 'Juno Workflow',
    'Krypton Auth', 'Lyra Mobile',
  ]
  const projColors = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444', '#06B6D4', '#22C55E', '#A855F7', '#F97316']
  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']
  const TASK_STATUS = ['Todo', 'In Progress', 'Review', 'Done']
  const clientNames = clientCompanies.map((c) => c.company)
  const projectDocs = []
  for (let i = 0; i < projNames.length; i++) {
    const memberIdx = (i * 3) % empDocs.length
    const members = Array.from({ length: 4 + (i % 3) }, (_, m) => ({
      name: pick(empNames, memberIdx + m), role: m === 0 ? 'Lead' : pick(['Member', 'QA', 'Designer', 'Backend', 'Frontend'], m), avatar: '',
    }))
    const p = await Project.create({
      name: projNames[i], code: `PRJ-${100 + i}`, client: pick(clientNames, i),
      description: `${projNames[i]} — delivery and iteration for ${pick(clientNames, i)}.`,
      lead: members[0].name, members, priority: pick(PRIORITIES, i),
      status: pick(['Active', 'Active', 'Planning', 'On Hold', 'Completed'], i),
      progress: 0, budget: 500000 + i * 250000,
      startDate: fdate(2026, 1 + (i % 6), 1), deadline: fdate(2026, 9 + (i % 3), 28),
      color: pick(projColors, i),
    })
    projectDocs.push(p)
  }

  let sprintCount = 0, taskCount = 0, msCount = 0, commentCount = 0, fileCount = 0, actCount = 0
  const bugTitles = ['Login fails on Safari', 'Null pointer on export', 'Memory leak in worker', 'Race condition in sync', 'Broken pagination', 'Token refresh loop']
  const taskTitles = ['Design login page', 'Build REST endpoints', 'Write unit tests', 'Set up CI pipeline', 'Refactor auth module', 'Implement dashboard', 'Add search filter', 'Optimise queries', 'Create onboarding flow', 'Integrate payment gateway']
  for (let i = 0; i < projectDocs.length; i++) {
    const p = projectDocs[i]
    const sprints = await Sprint.insertMany([
      { project: p._id, name: 'Sprint 1', goal: 'Core features', startDate: '2026-07-01', endDate: '2026-07-14', status: 'Active' },
      { project: p._id, name: 'Sprint 2', goal: 'Polish & QA', startDate: '2026-07-15', endDate: '2026-07-28', status: 'Planned' },
    ])
    sprintCount += 2

    // 6 tasks per project => 150 total. Some in sprints, some in backlog.
    const tasks = []
    for (let t = 0; t < 6; t++) {
      const isBug = t % 4 === 3
      const inBacklog = t >= 5
      const status = pick(TASK_STATUS, i + t)
      tasks.push({
        project: p._id, sprint: inBacklog ? null : pick(sprints, t)._id,
        title: isBug ? pick(bugTitles, i + t) : pick(taskTitles, i + t),
        description: 'Auto-seeded work item for demo data.',
        type: isBug ? 'Bug' : pick(['Task', 'Story', 'Improvement', 'Task'], t),
        status, priority: pick(PRIORITIES, i + t),
        severity: isBug ? pick(['Minor', 'Major', 'Critical', 'Blocker'], t) : 'Major',
        assignee: pick(p.members.map((m) => m.name), t), reporter: p.lead,
        storyPoints: pick([1, 2, 3, 5, 8], t), progress: status === 'Done' ? 100 : status === 'Review' ? 75 : status === 'In Progress' ? 40 : 0,
        dueDate: fdate(2026, 7, 10 + (t % 18)), order: t,
        labels: isBug ? ['bug'] : pick([['frontend'], ['backend'], ['design'], ['infra']], t),
      })
    }
    const taskDocs = await ProjectTask.insertMany(tasks)
    taskCount += taskDocs.length
    const done = taskDocs.filter((t) => t.status === 'Done').length
    p.progress = Math.round((done / taskDocs.length) * 100)
    await p.save()

    await Milestone.insertMany([
      { project: p._id, title: 'MVP Release', description: 'First usable build', dueDate: '2026-08-15', status: pick(['Reached', 'In Progress', 'Upcoming'], i), progress: 60 + (i % 40) },
      { project: p._id, title: 'Public Launch', description: 'GA rollout', dueDate: '2026-09-30', status: 'Upcoming', progress: 20 + (i % 30) },
    ])
    msCount += 2

    await ProjectComment.insertMany([
      { project: p._id, task: taskDocs[0]._id, author: p.lead, body: 'Please prioritise this for the current sprint.' },
      { project: p._id, task: taskDocs[1]._id, author: pick(empNames, i), body: 'Blocked on API access — following up.' },
    ])
    commentCount += 2

    await ProjectFile.insertMany([
      { project: p._id, name: 'requirements.pdf', type: 'pdf', size: 248000, uploadedBy: p.lead },
      { project: p._id, name: 'wireframes.fig', type: 'design', size: 1240000, uploadedBy: pick(empNames, i + 1) },
      { project: p._id, name: 'api-spec.json', type: 'file', size: 32000, uploadedBy: p.lead },
    ])
    fileCount += 3

    await ProjectActivity.insertMany([
      { project: p._id, actor: p.lead, action: 'created the project', target: p.name },
      { project: p._id, actor: pick(empNames, i), action: `moved "${taskDocs[0].title}" to ${taskDocs[0].status}`, target: taskDocs[0].title },
      { project: p._id, actor: pick(empNames, i + 1), action: 'uploaded requirements.pdf', target: 'requirements.pdf' },
    ])
    actCount += 3
  }
  console.log(` Seeded projects (${projectDocs.length} projects, ${sprintCount} sprints, ${taskCount} tasks/bugs, ${msCount} milestones, ${commentCount} comments, ${fileCount} files, ${actCount} activities)`)

  // === Calendar meetings (50) ============================================
  // Phase 6.9 (Task 17): scope this delete to staff-only events (clientId:
  // null) so it does not wipe the client-linked meetings seeded above.
  await CalendarEvent.deleteMany({ clientId: null })
  await CalendarEvent.insertMany(Array.from({ length: 50 }, (_, i) => {
    const day = 1 + (i % 27)
    const startH = 9 + (i % 8)
    return {
      title: pick(['Sprint Planning', 'Client Demo', 'Retrospective', '1:1 with Manager', 'Architecture Review', 'All-Hands', 'Interview Panel', 'Budget Review'], i),
      type: 'meeting', start: ymdh(2026, 7 + (i % 3), day, startH, 0), end: ymdh(2026, 7 + (i % 3), day, startH + 1, 0),
      allDay: false, location: pick(['Bengaluru HQ – Conf A', 'Zoom', 'Mumbai Office', 'Google Meet'], i),
      description: 'Auto-seeded calendar event for demo data.',
      attendees: [pick(empNames, i), pick(empNames, i + 1), pick(empNames, i + 2)],
      done: i % 5 === 0,
    }
  }))
  console.log(' Seeded 50 calendar meetings')

  // === Notifications (100) ===============================================
  await Notification.deleteMany({})
  const notifTypes = ['task', 'leave', 'attendance', 'meeting', 'project', 'announcement']
  const notifTitles = {
    task: 'New task assigned to you', leave: 'Leave request needs approval', attendance: 'Attendance marked late',
    meeting: 'Upcoming meeting reminder', project: 'You were added to a project', announcement: 'New company announcement',
  }
  await Notification.insertMany(Array.from({ length: 100 }, (_, i) => {
    const type = pick(notifTypes, i)
    return {
      recipient: pick(userDocs, i).email, type,
      title: notifTitles[type], body: `This is a ${type} notification (#${i + 1}).`,
      sender: pick(empNames, i), link: '/dashboard', priority: pick(['low', 'normal', 'high'], i),
      read: i % 4 === 0, createdAt: ymdh(2026, 7, 1 + (i % 17), 9 + (i % 8), (i * 7) % 60),
    }
  }))
  console.log(' Seeded 100 notifications')

  // === Announcements / Posts (30) ========================================
  await Post.deleteMany({})
  const postTypes = ['news', 'announcement', 'event', 'birthday']
  const postTitles = {
    news: 'Skew featured in TechCrunch', announcement: 'New leave policy effective August',
    event: 'Annual Offsite 2026 in Goa', birthday: 'Happy Birthday to the team!',
  }
  await Post.insertMany(Array.from({ length: 30 }, (_, i) => {
    const type = pick(postTypes, i)
    const nComments = i % 4
    return {
      type, title: postTitles[type] + (type === 'birthday' ? ` — ${pick(empNames, i)}` : ''),
      body: 'Auto-seeded announcement body for demo data. Stay tuned for more updates.',
      excerpt: 'Auto-seeded announcement.', author: pick(empNames, i), authorRole: pick(DEPARTMENTS, i),
      date: fdate(2026, 7 + (i % 3), 1 + (i % 27)), pinned: i % 7 === 0, likes: (i * 3) % 50,
      // PHASE ADMIN (TASK 2): the seeded `liked: i % 5 === 0` was removed. `liked`
      // is no longer a stored column - it is derived per request from `likedBy`
      // for the calling user - so seeding it would write a property the schema
      // now strips. Seeded posts simply start with nobody having liked them.
      likedBy: [],
      tags: pick([['hr'], ['events'], ['engineering'], ['company']], i), location: 'Bengaluru HQ',
      attachments: i % 6 === 0 ? [{ name: 'poster.png', type: 'image', url: '', size: 120000 }] : [],
      comments: Array.from({ length: nComments }, (_, c) => ({ author: pick(empNames, i + c + 1), body: 'Great update, thanks for sharing!', date: fdate(2026, 7, 1 + (i % 27)) })),
    }
  }))
  console.log(' Seeded 30 announcements')

  // === Attendance (per employee, several days) ===========================
  await Promise.all([Attendance.deleteMany({}), Shift.deleteMany({}), Holiday.deleteMany({})])
  await Shift.insertMany([
    { name: 'General', code: 'GEN', start: '09:00', end: '18:00', hours: 9, graceMins: 15, color: '#2563EB' },
    { name: 'Morning', code: 'MOR', start: '06:00', end: '14:00', hours: 8, graceMins: 10, color: '#10B981' },
    { name: 'Evening', code: 'EVE', start: '14:00', end: '22:00', hours: 8, graceMins: 10, color: '#F59E0B' },
    { name: 'Night', code: 'NGT', start: '22:00', end: '06:00', hours: 8, graceMins: 15, color: '#8B5CF6' },
  ])
  await Holiday.insertMany([
    { name: 'Independence Day', date: '2026-08-15', day: 'Saturday', type: 'National' },
    { name: 'Gandhi Jayanti', date: '2026-10-02', day: 'Friday', type: 'National' },
    { name: 'Diwali', date: '2026-11-08', day: 'Sunday', type: 'Festival' },
    { name: 'Christmas', date: '2026-12-25', day: 'Friday', type: 'Public' },
  ])
  const attendanceRecords = []
  for (let d = 0; d < 10; d++) {
    const date = fdate(2026, 7, 6 + d)
    empDocs.forEach((e, ei) => {
      const status = pick(['Present', 'Present', 'Present', 'Late', 'Early Exit', 'Absent'], ei + d)
      const blank = status === 'Absent'
      const late = status === 'Late', early = status === 'Early Exit'
      const workingHours = blank ? 0 : 8 + ((ei + d) % 3) - 1
      attendanceRecords.push({
        employee: e.name, empCode: e.empCode, employeeId: e._id, department: e.department,
        date, shift: 'General',
        checkIn: blank ? null : late ? '09:32' : `09:0${ei % 9}`,
        checkOut: blank ? null : early ? '16:15' : `18:0${ei % 9}`,
        breakMins: blank ? 0 : 30 + ((ei + d) % 20),
        // Phase 7.2 (TASK 3): Overtime REMOVED — the per-day overtimeHours seed
        // was deleted together with the feature.
        workingHours, late, earlyExit: early, status,
      })
    })
  }
  await Attendance.insertMany(attendanceRecords)
  console.log(` Seeded attendance (${attendanceRecords.length} day records, 4 shifts, 4 holidays)`)

  // === Leave data ========================================================
  await Promise.all([LeaveType.deleteMany({}), LeaveBalance.deleteMany({}), LeaveRequest.deleteMany({})])
  const leaveTypes = [
    // Phase 5 (Task 2): `genderRestriction` controls who sees each type.
    // 'Any' (the schema default) = visible to everyone. The restriction is
    // DATA, not a hardcoded rule keyed off the type name, so renaming
    // "Maternity Leave" or adding a new gender-specific type keeps working.
    { name: 'Casual Leave', code: 'CL', allocated: 12, color: '#2563EB', paid: true, carryForward: false, genderRestriction: 'Any' },
    { name: 'Sick Leave', code: 'SL', allocated: 10, color: '#EF4444', paid: true, carryForward: true, genderRestriction: 'Any' },
    { name: 'Earned Leave', code: 'EL', allocated: 15, color: '#10B981', paid: true, carryForward: true, genderRestriction: 'Any' },
    { name: 'Maternity Leave', code: 'ML', allocated: 180, color: '#EC4899', paid: true, carryForward: false, genderRestriction: 'Female' },
    { name: 'Paternity Leave', code: 'PL', allocated: 15, color: '#8B5CF6', paid: true, carryForward: false, genderRestriction: 'Male' },
    { name: 'Unpaid Leave', code: 'LWP', allocated: 0, color: '#64748B', paid: false, carryForward: false, genderRestriction: 'Any' },
  ]
  await LeaveType.insertMany(leaveTypes)
  const balanceHolders = [...new Set([...empNames, ...userDocs.map((u) => u.name)])]
  const allocTypes = leaveTypes.filter((t) => t.allocated > 0 && t.code !== 'ML')
  const balances = []
  balanceHolders.forEach((name, ei) => {
    allocTypes.forEach((t, ti) => {
      const used = Math.min(t.allocated, (ei + ti) % Math.max(1, Math.round(t.allocated / 2)))
      balances.push({ employee: name, type: t.name, code: t.code, color: t.color, allocated: t.allocated, used, balance: t.allocated - used })
    })
  })
  await LeaveBalance.insertMany(balances)

  const REASONS = ['Family function', 'Medical appointment', 'Personal work', 'Vacation', 'Not feeling well', 'Wedding']
  const REQ_STATUSES = ['Pending', 'Approved', 'Approved', 'Rejected', 'Cancelled']
  const requestOwners = [...empDocs, userDocs.find((u) => u.role === 'Employee'), userDocs.find((u) => u.role === 'Manager')]
  const workflowFor = (status, applicant, i) => {
    const steps = [
      { stage: 'Applied', by: applicant, at: new Date(2026, 6, 1 + (i % 10)), note: 'Leave request submitted' },
      { stage: 'Manager Review', by: pick(['Rahul Verma', 'Priya Sharma'], i), at: new Date(2026, 6, 2 + (i % 10)), note: 'Forwarded to HR', done: status !== 'Pending' },
    ]
    if (status === 'Approved') steps.push({ stage: 'Approved', by: 'Priya Sharma', at: new Date(2026, 6, 3 + (i % 10)), note: 'Approved by HR' })
    if (status === 'Rejected') steps.push({ stage: 'Rejected', by: 'Priya Sharma', at: new Date(2026, 6, 3 + (i % 10)), note: 'Insufficient balance' })
    if (status === 'Cancelled') steps.push({ stage: 'Cancelled', by: applicant, at: new Date(2026, 6, 3 + (i % 10)), note: 'Cancelled by employee' })
    return steps
  }
  const leaveRequests = Array.from({ length: 30 }, (_, i) => {
    const emp = requestOwners[i % requestOwners.length]
    const t = pick(allocTypes, i)
    const status = pick(REQ_STATUSES, i)
    const days = 1 + (i % 5)
    const fromDay = 1 + (i % 27)
    return {
      employee: emp.name, empCode: emp.empCode || undefined, department: emp.department || '',
      type: t.name, typeCode: t.code,
      from: `2026-07-${pad2(fromDay)}`, to: `2026-07-${pad2(fromDay + days - 1)}`,
      days, reason: pick(REASONS, i), status,
      approver: status === 'Pending' ? null : 'Priya Sharma',
      workflow: workflowFor(status, emp.name, i),
    }
  })
  await LeaveRequest.insertMany(leaveRequests)
  console.log(` Seeded leave (${leaveTypes.length} types, ${balances.length} balances, ${leaveRequests.length} requests)`)

  // === Finance data (incl. 40 invoices + 40 payments) ====================
  await Promise.all([
    Transaction.deleteMany({}), FinanceCategory.deleteMany({}), Budget.deleteMany({}),
    Invoice.deleteMany({}), Payment.deleteMany({}),
  ])
  const finCatDefs = [
    ['Sales Revenue', 'Income', '#10B981'], ['Service Income', 'Income', '#06B6D4'],
    ['Interest Income', 'Income', '#22C55E'], ['Other Income', 'Income', '#84CC16'],
    ['Payroll', 'Expense', '#EF4444'], ['Office Rent', 'Expense', '#F59E0B'],
    ['Software & Tools', 'Expense', '#8B5CF6'], ['Marketing', 'Expense', '#EC4899'],
    ['Utilities', 'Expense', '#F97316'], ['Travel', 'Expense', '#3B82F6'],
    ['Equipment', 'Expense', '#14B8A6'], ['Professional Fees', 'Expense', '#A855F7'],
  ]
  await FinanceCategory.insertMany(finCatDefs.map(([name, type, color]) => ({ name, type, color, description: `${name} (${type.toLowerCase()}) transactions.` })))
  const incomeCats = finCatDefs.filter((c) => c[1] === 'Income').map((c) => c[0])
  const expenseCats = finCatDefs.filter((c) => c[1] === 'Expense').map((c) => c[0])
  const incomeTitles = ['Client Payment', 'Product Sale', 'Consulting Fee', 'Subscription Revenue', 'Retainer', 'License Sale', 'Support Contract']
  const expenseTitles = ['Office Rent', 'Salaries', 'AWS Bill', 'Google Ads', 'Electricity', 'Team Offsite', 'Laptops', 'Legal Fees', 'Internet', 'Stationery']
  const methods = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque']
  const finVendors = ['TechSource Pvt Ltd', 'MegaSupply Co', 'CloudNine Hosting', 'AdVantage Media', 'PowerGrid Utils', 'LegalEase LLP']
  const finClients = clientCompanies.map((c) => c.company)
  await Transaction.insertMany(Array.from({ length: 60 }, (_, i) => {
    const isIncome = i % 5 < 2
    const type = isIncome ? 'Income' : 'Expense'
    const month = 1 + (i % 7)
    const base = isIncome ? 40000 + (i % 12) * 28000 : 8000 + (i % 15) * 14000
    return {
      title: isIncome ? pick(incomeTitles, i) : pick(expenseTitles, i),
      type, category: isIncome ? pick(incomeCats, i) : pick(expenseCats, i),
      amount: base, date: fdate(2026, month, 1 + (i % 27)), method: pick(methods, i),
      reference: `${isIncome ? 'RCPT' : 'BILL'}-${2000 + i}`,
      party: isIncome ? pick(finClients, i) : pick(finVendors, i),
      taxRate: isIncome ? 18 : pick([0, 5, 12, 18], i),
    }
  }))
  await Budget.insertMany(expenseCats.map((category, i) => {
    const allocated = 100000 + (i % 6) * 60000
    const spent = Math.min(Math.round(allocated * (0.45 + ((i * 13) % 60) / 100)), Math.round(allocated * 1.15))
    return { category, period: 'July 2026', allocated, spent }
  }))
  const invStatuses = ['Paid', 'Sent', 'Overdue', 'Draft', 'Partial']
  const invoiceDocs = await Invoice.insertMany(Array.from({ length: 40 }, (_, i) => {
    const items = Array.from({ length: 2 + (i % 3) }, (_, j) => {
      const qty = 1 + ((i + j) % 5)
      const rate = 15000 + ((i * 7 + j * 3) % 10) * 8000
      return { description: pick(['Consulting', 'Development', 'License', 'Support', 'Design'], i + j), quantity: qty, rate, amount: qty * rate }
    })
    const subtotal = items.reduce((s, it) => s + it.amount, 0)
    const tax = Math.round(subtotal * 0.18)
    const total = subtotal + tax
    const status = pick(invStatuses, i)
    const client = pick(finClients, i)
    const month = 1 + (i % 7)
    return {
      invoiceNumber: `INV-${1001 + i}`, client,
      clientEmail: `accounts@${client.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      items, subtotal, tax, taxRate: 18, total,
      amountPaid: status === 'Paid' ? total : status === 'Partial' ? Math.round(total * 0.5) : 0,
      status, issueDate: fdate(2026, month, 1 + (i % 20)), dueDate: fdate(2026, Math.min(12, month + 1), 1 + (i % 20)),
    }
  }))
  await Payment.insertMany(Array.from({ length: 40 }, (_, i) => {
    const direction = i % 3 === 0 ? 'Outgoing' : 'Incoming'
    const month = 1 + (i % 7)
    const inv = direction === 'Incoming' ? invoiceDocs[i % invoiceDocs.length] : null
    return {
      paymentNumber: `PMT-${5001 + i}`, direction,
      party: direction === 'Incoming' ? pick(finClients, i) : pick(finVendors, i),
      invoiceNumber: inv ? inv.invoiceNumber : '',
      amount: direction === 'Incoming' ? 50000 + (i % 10) * 30000 : 20000 + (i % 8) * 18000,
      method: pick(methods, i), status: pick(['Completed', 'Completed', 'Pending', 'Failed'], i),
      date: fdate(2026, month, 1 + (i % 27)),
    }
  }))
  console.log(` Seeded finance (12 categories, 60 transactions, ${expenseCats.length} budgets, ${invoiceDocs.length} invoices, 40 payments)`)

  // === File Management ===================================================
  await Promise.all([Folder.deleteMany({}), FileItem.deleteMany({})])
  const ownerName = userDocs[0].name
  const folderDefs = ['Documents', 'Images', 'Videos', 'Reports']
  const folderDocs = await Folder.insertMany(folderDefs.map((name) => ({ name, parent: null, owner: ownerName })))
  const folderByName = (n) => folderDocs.find((f) => f.name === n)._id
  // 50 realistic enterprise documents distributed across folders/types.
  const docTemplates = [
    ['pdf', 'Reports'], ['word', 'Documents'], ['excel', 'Documents'], ['image', 'Images'],
    ['pdf', 'Reports'], ['video', 'Videos'], ['word', 'Documents'], ['image', 'Images'],
    ['pdf', 'Documents'], ['excel', 'Reports'], ['pdf', 'Reports'], ['word', 'Documents'],
  ]
  const docNames = {
    pdf: ['Quarterly Financial Report', 'Annual Compliance Audit', 'Design Specification', 'Project Proposal', 'Board Meeting Minutes', 'Client Master Agreement', 'Technical Architecture', 'Risk Assessment', 'Security Policy', 'Monthly KPI Summary'],
    word: ['Offer Letter', 'Mutual NDA', 'HR Policy Manual', 'Job Description', 'Statement of Work', 'Onboarding Checklist', 'Vendor Agreement', 'Leave Policy'],
    excel: ['Budget Sheet', 'Payroll Register', 'Leave Ledger', 'Headcount Forecast', 'Expense Tracker', 'Tax Computation'],
    image: ['Brand Assets', 'Team Photo', 'Product Mockup', 'Org Chart', 'Event Banner', 'UI Screenshots'],
    video: ['Product Demo', 'Training Session', 'Webinar Recording', 'All-Hands Recap', 'Client Walkthrough'],
  }
  const extByType = { pdf: 'pdf', word: 'docx', excel: 'xlsx', image: 'png', video: 'mp4' }
  const fileDocs = []
  for (let i = 0; i < 50; i++) {
    const [type, folderName] = docTemplates[i % docTemplates.length]
    const names = docNames[type]
    const base = names[(i + Math.floor(i / docTemplates.length)) % names.length]
    const name = `${base}.${extByType[type]}`
    const permission = ['public', 'team', 'private'][i % 3]
    const size = (i + 1) * 137000 + (i % 7) * 41000
    fileDocs.push({
      name, originalName: name, type, mimeType: '', size, url: null,
      folder: folderByName(folderName), owner: ownerName, permission, starred: i % 4 === 0,
      versions: [{ version: 1, filename: name, size, by: ownerName, uploadedAt: new Date(2026, 6, 1 + (i % 27)) }],
      sharedWith: permission === 'public' ? [] : [{ user: userDocs[4].name, permission: 'view' }],
    })
  }
  await FileItem.insertMany(fileDocs)
  console.log(` Seeded file management (${folderDocs.length} folders, ${fileDocs.length} files)`)

  // === Audit logs (30) + Admin activity sessions (30) ====================
  await Promise.all([AuditLog.deleteMany({}), Activity.deleteMany({})])
  const modules = ['Auth', 'User', 'Employee', 'HR', 'Project', 'Finance', 'Admin', 'Client']
  const actions = {
    Auth: 'User logged in', User: 'User profile updated', Employee: 'Employee record created',
    HR: 'Job opening published', Project: 'Project status changed', Finance: 'Invoice generated',
    Admin: 'Role permissions updated', Client: 'Client project updated',
  }
  await AuditLog.insertMany(Array.from({ length: 30 }, (_, i) => {
    const module = pick(modules, i)
    return {
      user: pick(userDocs, i).name, actor: pick(userDocs, i).name,
      action: actions[module], module, severity: pick(['Info', 'Warning', 'Critical'], i),
      ip: `192.168.1.${10 + (i % 240)}`, at: ymdh(2026, 7, 1 + (i % 17), 9 + (i % 8), (i * 11) % 60),
    }
  }))
  await Activity.insertMany(Array.from({ length: 30 }, (_, i) => {
    const u = pick(userDocs, i)
    return {
      user: u.email, role: u.role, device: pick(['Windows PC', 'MacBook', 'iPhone', 'Android'], i),
      browser: pick(['Chrome', 'Safari', 'Edge', 'Firefox'], i), ip: `192.168.1.${10 + (i % 240)}`,
      location: pick(['Bengaluru', 'Mumbai', 'Delhi', 'Remote'], i),
      startedAt: fdate(2026, 7, 1 + (i % 17)) + ` ${pad2(9 + (i % 8))}:${pad2((i * 13) % 60)}`,
      currentUrl: pick(['/dashboard', '/employees', '/project', '/finance', '/leave'], i), active: i % 4 !== 0,
    }
  }))
  console.log(' Seeded audit logs + admin activity timeline')

  await mongoose.disconnect()
  console.log('\n Seed complete. Run `npm run dev` to start the server.')
  process.exit(0)
}

seed()
