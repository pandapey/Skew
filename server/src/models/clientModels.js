import mongoose from 'mongoose'

const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true },
    company: { type: String, required: true },
    contactPerson: { type: String, default: '' },
    designation: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    gst: { type: String, default: '' },
    industry: { type: String, default: '' },
    plan: { type: String, default: 'Business' },
    status: { type: String, default: 'Active' },
    joinedDate: { type: String, default: '' },
    address: { type: String, default: '' },
    website: { type: String, default: '' },
    notes: { type: String, default: '' },
    projectType: { type: String, default: '' },
    projectMembers: { type: [String], default: [] },
    projectName: { type: String, default: '' },
    projectCode: { type: String, default: '' },
    projectDescription: { type: String, default: '' },
    advancePayment: { type: Number, default: 0 },
    monthlyDue: { type: Number, default: 0 },
    budget: { type: Number, default: 0 },
    billingCycle: { type: String, default: 'Monthly' },
    paymentMode: { type: String, default: 'Bank Transfer' },
  },
  { timestamps: true }
)

clientSchema.index({ email: 1 })

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', uppercase: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, default: 0 },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
)
planSchema.index({ name: 'text', code: 'text', description: 'text' })
planSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
)

const domainPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, default: '', uppercase: true, trim: true },
    description: { type: String, default: '' },
    price: { type: Number, default: 0 },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
)
domainPlanSchema.index({ name: 'text', code: 'text', description: 'text' })
domainPlanSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
)

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    assignee: { type: String, default: '' },
    priority: { type: String, default: 'Medium' },
    status: { type: String, default: 'Todo' },
    completion: { type: Number, default: 0 },
    due: { type: String, default: '' },
    comments: { type: [String], default: [] },
  },
  { _id: true }
)

const timelineStageSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    status: { type: String, default: 'Pending' },
    date: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { _id: true }
)

const teamMemberSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    roleInProject: { type: String, default: 'Member' },
    position: { type: String, default: '' },
    department: { type: String, default: '' },
    availability: { type: String, default: 'Available' },
    avatar: { type: String, default: '' },
  },
  { _id: false }
)

const activitySchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    at: { type: String, default: '' },
    by: { type: String, default: '' },
  },
  { _id: true }
)

const documentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    type: { type: String, default: '' },
    size: { type: String, default: '' },
    uploadedBy: { type: String, default: '' },
    uploadedAt: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: true }
)

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    status: { type: String, default: 'Pending' },
    date: { type: String, default: '' },
    method: { type: String, default: 'Bank Transfer' },
  },
  { _id: true }
)

const clientProjectSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, unique: true },
    sourceProjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    clientId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, default: '' },
    status: { type: String, default: 'Planning' },
    progress: { type: Number, default: 0 },
    priority: { type: String, default: 'Medium' },
    startDate: { type: String, default: '' },
    deliveryDate: { type: String, default: '' },
    projectManager: { type: String, default: '' },
    budget: { type: Number, default: 0 },
    advancePayment: { type: Number, default: 0 },
    monthlyDue: { type: Number, default: 0 },
    timeline: { type: [timelineStageSchema], default: [] },
    team: { type: [teamMemberSchema], default: [] },
    tasks: { type: [taskSchema], default: [] },
    activity: { type: [activitySchema], default: [] },
    documents: { type: [documentSchema], default: [] },
    payments: { type: [paymentSchema], default: [] },
  },
  { timestamps: true }
)

const clientAnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: '' },
    date: { type: String, default: '' },
    tag: { type: String, default: 'Update' },
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true }
)

const clientMessageSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    subject: { type: String, default: '' },
    participants: { type: [String], default: [] },
    messages: [
      {
        from: { type: String, default: '' },
        at: { type: String, default: '' },
        text: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
)

const clientNotificationSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, index: true },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    at: { type: String, default: '' },
    read: { type: Boolean, default: false },
    icon: { type: String, default: 'update' },
  },
  { timestamps: true }
)

export const Client = mongoose.model('Client', clientSchema)
export const Plan = mongoose.model('Plan', planSchema)
export const DomainPlan = mongoose.model('DomainPlan', domainPlanSchema)
export const ClientProject = mongoose.model('ClientProject', clientProjectSchema)
export const ClientAnnouncement = mongoose.model('ClientAnnouncement', clientAnnouncementSchema)
export const ClientMessage = mongoose.model('ClientMessage', clientMessageSchema)
export const ClientNotification = mongoose.model('ClientNotification', clientNotificationSchema)
