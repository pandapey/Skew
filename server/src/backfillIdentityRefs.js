import dotenv from 'dotenv'
import mongoose from 'mongoose'

dotenv.config()

const uri = process.env.MONGO_URI
if (!uri) {
  console.error('MONGO_URI is not set. Refusing to run.')
  process.exit(1)
}

const DRY_RUN = process.argv.includes('--dry-run')

const { User } = await import('./models/User.js')
const { Project, ProjectTask, ProjectComment } = await import('./models/projectModels.js')
const { Attendance } = await import('./models/attendanceModels.js')
const { LeaveRequest } = await import('./models/leaveModels.js')

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
  console.log(`Connected (${DRY_RUN ? 'DRY RUN' : 'LIVE'}). Resolving identities...`)
  const report = { resolved: 0, missing: new Set(), updated: {} }
  const bump = (key, n = 1) => { report.updated[key] = (report.updated[key] || 0) + n }

  const users = await User.find({}).select('_id name empCode employeeId').lean()
  const byName = new Map(users.map((u) => [u.name, u]))
  const idOf = (name) => {
    const u = byName.get(String(name || '').trim())
    if (!u) {
      if (name) report.missing.add(String(name))
      return null
    }
    report.resolved += 1
    return u
  }

  // --- ProjectTasks -------------------------------------------------------
  {
    const tasks = await ProjectTask.find({
      $or: [{ assigneeId: null }, { assignedById: null }, { 'submission.byId': null }],
    }).select('_id assignee assignedBy submission').lean()
    let n = 0
    for (const t of tasks) {
      const set = {}
      if (t.assignee) {
        const u = idOf(t.assignee)
        if (u) set.assigneeId = u._id
      }
      if (t.assignedBy) {
        const u = idOf(t.assignedBy)
        if (u) set.assignedById = u._id
      }
      if (t.submission?.by && !t.submission?.byId) {
        const u = idOf(t.submission.by)
        if (u) set['submission.byId'] = u._id
      }
      if (Object.keys(set).length) {
        if (!DRY_RUN) await ProjectTask.updateOne({ _id: t._id }, { $set: set })
        n += 1
      }
    }
    bump('ProjectTask', n)
  }

  // --- Projects -----------------------------------------------------------
  {
    const projects = await Project.find({}).select('_id lead leadId members').lean()
    let n = 0
    for (const p of projects) {
      const set = {}
      let members = null
      if (p.lead && !p.leadId) {
        const u = idOf(p.lead)
        if (u) set.leadId = u._id
      }
      if (Array.isArray(p.members) && p.members.some((m) => m?.name && !m?.userId)) {
        members = p.members.map((m) => {
          if (!m?.name || m?.userId) return m
          const u = idOf(m.name)
          return u ? { ...m, userId: u._id } : m
        })
      }
      if (Object.keys(set).length || members) {
        if (!DRY_RUN) {
          await Project.updateOne(
            { _id: p._id },
            { ...(Object.keys(set).length ? { $set: set } : {}), ...(members ? { $set: { members } } : {}) },
          )
        }
        n += 1
      }
    }
    bump('Project', n)
  }

  // --- Comments -----------------------------------------------------------
  {
    const res = await ProjectComment.find({ authorId: null, author: { $ne: null } })
      .select('_id author')
      .lean()
    let n = 0
    for (const c of res) {
      const u = idOf(c.author)
      if (u) {
        if (!DRY_RUN) await ProjectComment.updateOne({ _id: c._id }, { $set: { authorId: u._id } })
        n += 1
      }
    }
    bump('ProjectComment', n)
  }

  // --- Attendance / LeaveRequest empCodes ----------------------------------
  for (const [Model, key] of [[Attendance, 'Attendance'], [LeaveRequest, 'LeaveRequest']]) {
    const rows = await Model.find({ $or: [{ empCode: null }, { empCode: '' }] })
      .select('_id employee empCode')
      .lean()
    let n = 0
    for (const r of rows) {
      const u = byName.get(String(r.employee || '').trim())
      if (u?.empCode) {
        if (!DRY_RUN) {
          const patch = { empCode: u.empCode }
          if (key === 'LeaveRequest' && u.employeeId && mongoose.isValidObjectId(u.employeeId)) {
            patch.employeeId = new mongoose.Types.ObjectId(String(u.employeeId))
          }
          await Model.updateOne({ _id: r._id }, { $set: patch })
        }
        n += 1
      } else if (r.employee) {
        report.missing.add(String(r.employee))
      }
    }
    bump(key, n)
  }

  console.log('Backfill report:', JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'live', updated: report.updated }, null, 2))
  if (report.missing.size) {
    console.log(`Unresolvable names (${report.missing.size}) — left on name matching:`)
    ;[...report.missing].slice(0, 50).forEach((m) => console.log(`  - ${m}`))
  }
  await mongoose.disconnect()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
