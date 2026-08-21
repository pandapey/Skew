import { employeeRepository as repo } from '../repositories/employeeRepository.js'
import { Employee } from '../models/Employee.js'
import mongoose from 'mongoose'
import { ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit, clampPage } from '../utils/query.js'
import { linkEmployeeToUser, deleteLinkedUser } from '../services/identityLink.js'
import fs from 'fs'
import path from 'path'
// PHASE ATTENDANCE STATUS (TASKS 1-3): the ONE shared per-person status
// resolver (utils/attendanceStatus.js). The list/detail payloads gain an
// ADDITIVE `attendanceStatus` field — the real-time status derived from
// attendance records, approved leave and the person's shift window. The stored
// `Employee.status` (the permanent account state, synced with User.status by
// identityLink.js) is deliberately NOT overwritten; both are carried so the UI
// can show the live status while keeping the account state intact.
import { computeTodayStatusMap, ATT_STATUS_NOT_MARKED } from '../utils/attendanceStatus.js'

// Business-ID lookup: employee URLs use the human-readable Employee ID (EMP001)
// while legacy bookmarks / internal links still carry the Mongo ObjectId. The
// ref resolves to the Employee's `_id` string either way; a malformed ref
// resolves to null (404) instead of throwing a CastError, so no input can
// produce a 500.
async function resolveEmployeeRef(ref) {
  const value = String(ref || '').trim()
  if (!value) return null
  if (mongoose.isValidObjectId(value)) {
    try {
      const emp = await repo.findByIdLean(value)
      return emp ? String(emp._id) : null
    } catch {
      return null
    }
  }
  const emp = await Employee.findOne({ empCode: value.toUpperCase() }).lean()
  return emp ? String(emp._id) : null
}

// Service: business logic + orchestration. Controllers stay thin.
export const employeeService = {
  async list(query) {
    const { search = '', department, status, sortBy = 'name', order = 'asc', page = 1, limit = 8 } = query
    const filter = {}
    if (search) filter.$or = [
      { name: { $regex: escapeRegex(search), $options: 'i' } },
      { email: { $regex: escapeRegex(search), $options: 'i' } },
      { empCode: { $regex: escapeRegex(search), $options: 'i' } },
      { designation: { $regex: escapeRegex(search), $options: 'i' } },
    ]
    // Only accept scalar values (reject operator objects) — NoSQL injection
    // defense. scalarOrNull also maps empty strings ("All") to null = no filter.
    const departmentV = scalarOrNull(department)
    const statusV = scalarOrNull(status)
    if (departmentV != null) filter.department = departmentV
    if (statusV != null) filter.status = statusV

    const pageNum = clampPage(page)
    const limitNum = clampLimit(limit, 100)
    const sort = { [sortBy]: order === 'asc' ? 1 : -1 }

    const { data, total } = await repo.findPaginated({ filter, sort, skip: (pageNum - 1) * limitNum, limit: limitNum })
    // PHASE ATTENDANCE STATUS (TASKS 1-3): decorate every row of this page with
    // the computed attendance status (additive field — stored status untouched).
    // Computed once per page over the page's own rows; the resolver joins on
    // empCode first, then name, so a namesake can never inherit another
    // person's status.
    const statusMap = await computeTodayStatusMap({
      subjects: data.map((e) => ({
        name: e.name, empCode: e.empCode, shift: e.shift, inactive: e.status === 'Inactive',
      })),
    })
    const rows = data.map((e) => ({
      ...e,
      attendanceStatus: statusMap.byEmpCode.get(e.empCode) || statusMap.byName.get(e.name) || ATT_STATUS_NOT_MARKED,
    }))
    return { data: rows, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
  },

  // Phase 9 (My Profile): the logged-in user's OWN Employee record. Resolved
  // from the authenticated `user` (JWT), never from a client-supplied id, so an
  // employee can only ever read their own profile. The link is the `userId`
  // back-reference identityLink maintains on the Employee; `user.employeeId`
  // (the Employee's Mongo _id, per identityLink's own documentation) is the
  // fallback for accounts whose link predates that field.
  async getSelf(user) {
    const byUserId = await Employee.findOne({ userId: user._id }).lean()
    if (byUserId) return byUserId
    if (user.employeeId) return repo.findByIdLean(user.employeeId)
    return null
  },

  async getById(id) {
    const _id = await resolveEmployeeRef(id)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const emp = await repo.findByIdLean(_id)
    if (!emp) throw new ApiError(404, 'Employee not found')
    // PHASE ATTENDANCE STATUS (TASKS 1-3): same additive computed status the
    // list carries, so the Detail page shows the same live status.
    const statusMap = await computeTodayStatusMap({
      subjects: [{ name: emp.name, empCode: emp.empCode, shift: emp.shift, inactive: emp.status === 'Inactive' }],
    })
    return {
      ...emp,
      attendanceStatus: statusMap.byEmpCode.get(emp.empCode) || statusMap.byName.get(emp.name) || ATT_STATUS_NOT_MARKED,
    }
  },

  async update(id, patch) {
    const _id = await resolveEmployeeRef(id)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const { experience, employeeId, password, confirmPassword, role, ...rest } = patch
    const clean = { ...rest }
    // `experience` is OVERLOADED on the wire and always has been:
    //   * the employee FORM sends a string ("4 yrs") meant for
    //     Employee.experienceYears — mapped below, unchanged behaviour;
    //   * the Employee Details -> Work Experience editor sends the ARRAY that
    //     maps 1:1 onto Employee.experience ([{ company, role, from, to }]).
    //
    // PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 1) ROOT CAUSE: only the string
    // branch existed. `experience` was destructured OUT of the patch and, when
    // it was an array, silently discarded — so the model field the Details page
    // renders had no reachable write path at all and Work Experience could
    // never be anything but empty. Handling the array restores the existing
    // model field; it does not add one.
    if (typeof experience === 'string' && experience) clean.experienceYears = experience
    else if (Array.isArray(experience)) clean.experience = experience

    let updated
    if (Object.prototype.hasOwnProperty.call(clean, 'salary')) {
      // Phase 5.4 (Task 2) root cause: the employee form submits salary as a
      // flat CTC number (`salary: 1200000`), but the schema stores it as a
      // subdocument. PHASE SALARY STRUCTURE REWORK: that subdocument shape is
      // now { ctc, basic, pf, esi, tax, net, monthly } — hra/allowances are no
      // longer part of it (see models/Employee.js). This went straight through
      // `repo.updateById` → `findByIdAndUpdate`, which (a) cannot cast a bare
      // number into that subdocument and (b) bypasses `.save()` middleware
      // entirely — so the `pre('save')` hook in Employee.js that derives
      // basic/pf/esi/net from ctc never ran. The breakdown stayed empty, which
      // is why the Salary tab always rendered ₹0.
      //
      // Fix: route salary changes through `.save()` so the EXISTING hook does
      // the derivation (no duplicated math here), and reset the breakdown so
      // the hook recomputes on every CTC change, not just the first one.
      const rawCtc = clean.salary && typeof clean.salary === 'object' ? clean.salary.ctc : clean.salary
      const ctc = Number(rawCtc) || 0
      const doc = await Employee.findById(_id)
      if (!doc) throw new ApiError(404, 'Employee not found')
      doc.set({ ...clean, salary: { ctc } })
      updated = (await doc.save()).toObject()
    } else {
      updated = await repo.updateById(_id, clean)
    }
    if (!updated) throw new ApiError(404, 'Employee not found')
    // Keep the linked login User in sync (creates one if none exists yet).
    await linkEmployeeToUser(updated)
    return updated
  },

  async remove(id) {
    const _id = await resolveEmployeeRef(id)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const emp = await repo.findById(_id)
    if (!emp) throw new ApiError(404, 'Employee not found')
    // Cascade: remove the linked login User too.
    await deleteLinkedUser(emp)
    const deleted = await repo.deleteById(_id)
    return { id: _id }
  },

  async bulkRemove(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No ids provided')
    // Resolve linked Users before deleting the Employees, then cascade.
    const emps = await Employee.find({ _id: { $in: ids } }).lean()
    for (const emp of emps) await deleteLinkedUser(emp)
    const res = await repo.deleteMany(ids)
    return { deleted: res.deletedCount }
  },

  async bulkUpdate(ids, patch) {
    if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No ids provided')
    const res = await repo.updateMany(ids, patch)
    return { updated: res.modifiedCount }
  },

  async addDocument(id, doc) {
    const _id = await resolveEmployeeRef(id)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const updated = await repo.pushSub(_id, 'documents', doc)
    if (!updated) throw new ApiError(404, 'Employee not found')
    return updated.documents.at(-1)
  },

  // ---------------------------------------------------------------------------
  // PHASE: EMPLOYEE PROFILE SELF-SERVICE (TASK 3)
  //
  // An authenticated Employee may edit ONLY their OWN record and ONLY the
  // personal fields below. Everything that determines company authority,
  // payroll, structure or employment status stays Admin/Manager-controlled:
  // name, email, empCode, department, designation, role, status, employment
  // type, joining date, salary, bank, reporting manager, shift and the HR
  // collections (skills/certificates/experience/reviews) are never
  // accepted here — a hand-crafted payload for one of them is silently dropped.
  // `education` + `bank` ARE accepted: My Profile lets an Employee (or Manager)
  // maintain their own academic history and bank details — the only
  // professional fields they may edit themselves — each sanitised by shape
  // before it reaches the model.
  // ---------------------------------------------------------------------------
  SELF_EDITABLE_FIELDS: ['phone', 'address', 'dob', 'bloodGroup', 'maritalStatus', 'emergencyContact', 'emergencyContacts', 'education', 'bank'],

  async updateSelf(user, patch) {
    if (!['Employee', 'Manager'].includes(user.role)) {
      throw new ApiError(403, 'Only Employee and Manager accounts can self-edit their profile')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')

    const clean = {}
    for (const key of this.SELF_EDITABLE_FIELDS) {
      if (key in patch) clean[key] = patch[key]
    }
    // The emergency-contacts array is only accepted as a real array; anything
    // else is ignored rather than crashing the record.
    if ('emergencyContacts' in clean && !Array.isArray(clean.emergencyContacts)) {
      delete clean.emergencyContacts
    }
    // Education entries: an array of { qualification, institution,
    // fieldOfStudy, startYear, endYear, grade }. Rows missing the two required
    // fields are dropped, only known keys survive, and the list is capped so a
    // hostile payload cannot balloon the document.
    if ('education' in clean) {
      if (!Array.isArray(clean.education)) {
        delete clean.education
      } else {
        clean.education = clean.education
          .filter((e) => e && String(e.qualification || '').trim() && String(e.institution || '').trim())
          .slice(0, 10)
          .map((e) => ({
            qualification: String(e.qualification || '').trim(),
            institution: String(e.institution || '').trim(),
            fieldOfStudy: String(e.fieldOfStudy || '').trim(),
            startYear: String(e.startYear || '').trim(),
            endYear: String(e.endYear || '').trim(),
            grade: String(e.grade || '').trim(),
          }))
      }
    }
    // Bank details: a plain object with only the three known keys; anything
    // else is ignored.
    if ('bank' in clean) {
      if (!clean.bank || typeof clean.bank !== 'object' || Array.isArray(clean.bank)) {
        delete clean.bank
      } else {
        clean.bank = {
          name: String(clean.bank.name || '').trim(),
          account: String(clean.bank.account || '').trim(),
          ifsc: String(clean.bank.ifsc || '').trim(),
        }
      }
    }
    if (!Object.keys(clean).length) {
      throw new ApiError(400, 'No editable fields provided')
    }

    const doc = await Employee.findById(emp._id)
    if (!doc) throw new ApiError(404, 'Employee not found')
    doc.set(clean)
    const updated = (await doc.save()).toObject()

    // Mirror the shared fields (phone) onto the linked login User so the two
    // records never disagree — the existing identityLink is the single sync
    // path, reused rather than duplicated.
    await linkEmployeeToUser(updated)
    return updated
  },

  async addSelfDocument(user, file, category) {
    if (user.role !== 'Employee') {
      throw new ApiError(403, 'Only Employee accounts can upload their own profile documents')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')

    const type = file.mimetype.includes('pdf') ? 'pdf'
      : /sheet|excel/.test(file.mimetype) ? 'excel'
      : file.mimetype.includes('image') ? 'image' : 'word'

    const doc = await repo.pushSub(emp._id, 'documents', {
      name: file.originalname,
      type,
      category: String(category || 'General').trim() || 'General',
      size: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      // Private bytes live in profile-uploads/ and are served ONLY through the
      // authorized routes (/employees/me/documents/:id for the owner,
      // /employees/:id/documents/:id for Admin/Manager). The stored reference
      // points at the staff route; authorization lives on the server.
      diskName: file.filename,
      url: '/employees/',
      uploadedBy: String(user._id),
    })
    const item = doc.documents.at(-1).toObject()
    const realUrl = `/employees/${String(emp._id)}/documents/${String(item._id)}`
    // Keep the stored reference in sync with the response (the doc was pushed
    // with a placeholder url because the subdocument _id is only assigned on
    // insert).
    await Employee.updateOne(
      { _id: emp._id, 'documents._id': item._id },
      { $set: { 'documents.$.url': realUrl } }
    )
    return { ...item, url: realUrl }
  },

  // Resolve a PRIVATE self-uploaded document for download. Only the owning
  // employee may pass; the document is looked up inside their own record, so
  // there is no id to tamper with. Admin/Manager use getDocumentFor instead.
  async getSelfDocument(user, docId) {
    if (user.role !== 'Employee') {
      throw new ApiError(403, 'Only Employee accounts can read their own profile documents')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')

    const doc = (emp.documents || []).find((d) => String(d._id) === String(docId))
    if (!doc || !doc.diskName) throw new ApiError(404, 'Document not found')

    const absPath = path.resolve(process.cwd(), 'profile-uploads', doc.diskName)
    if (!absPath.startsWith(path.resolve(process.cwd(), 'profile-uploads')) || !fs.existsSync(absPath)) {
      throw new ApiError(404, 'Document not found')
    }
    return { absPath, name: doc.name, mimeType: doc.mimeType }
  },

  // Admin/Manager door onto an employee's PRIVATE profile document. Route-level
  // canWrite (Admin/Manager) already ran; this re-checks the role defensively
  // and resolves the employee by id exactly like every other detail read.
  async getDocumentFor(actor, empId, docId) {
    if (!['Admin', 'Manager'].includes(actor.role)) {
      throw new ApiError(403, 'You cannot read this employee\'s private documents')
    }
    const _id = await resolveEmployeeRef(empId)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const emp = await repo.findByIdLean(_id)
    if (!emp) throw new ApiError(404, 'Employee not found')
    const doc = (emp.documents || []).find((d) => String(d._id) === String(docId))
    if (!doc || !doc.diskName) throw new ApiError(404, 'Document not found')

    const absPath = path.resolve(process.cwd(), 'profile-uploads', doc.diskName)
    if (!absPath.startsWith(path.resolve(process.cwd(), 'profile-uploads')) || !fs.existsSync(absPath)) {
      throw new ApiError(404, 'Document not found')
    }
    return { absPath, name: doc.name, mimeType: doc.mimeType }
  },

  async deleteSelfDocument(user, docId) {
    if (user.role !== 'Employee') {
      throw new ApiError(403, 'Only Employee accounts can delete their own profile documents')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')

    const doc = (emp.documents || []).find((d) => String(d._id) === String(docId))
    if (!doc || !doc.diskName) throw new ApiError(404, 'Document not found')

    const absPath = path.resolve(process.cwd(), 'profile-uploads', doc.diskName)
    if (absPath.startsWith(path.resolve(process.cwd(), 'profile-uploads')) && fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath) } catch {}
    }

    await Employee.updateOne(
      { _id: emp._id },
      { $pull: { documents: { _id: doc._id } } }
    )
    return { deleted: true }
  },

  async setPhoto(id, url) {
    const _id = await resolveEmployeeRef(id)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const updated = await repo.updateById(_id, { avatar: url })
    if (!updated) throw new ApiError(404, 'Employee not found')
    return { avatar: url }
  },

  // Aggregated workforce stats for the Employee Dashboard.
  async stats() {
    const group = (field) => repo.aggregate([{ $group: { _id: `$${field}`, value: { $sum: 1 } } }, { $project: { _id: 0, name: '$_id', value: 1 } }])
    const [total, byDept, byStatus, genderSplit, avg] = await Promise.all([
      repo.countAll(),
      group('department'),
      group('status'),
      group('gender'),
      repo.aggregate([{ $group: { _id: null, avgSalary: { $avg: '$salary.ctc' }, avgPerformance: { $avg: '$performance' } } }]),
    ])
    return {
      total,
      active: byStatus.find((s) => s.name === 'Active')?.value || 0,
      onLeave: byStatus.find((s) => s.name === 'On Leave')?.value || 0,
      departments: byDept.length,
      avgSalary: Math.round(avg[0]?.avgSalary || 0),
      avgPerformance: Math.round(avg[0]?.avgPerformance || 0),
      byDept, byStatus, genderSplit,
    }
  },
}
