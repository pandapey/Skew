import { employeeRepository as repo } from '../repositories/employeeRepository.js'
import { Employee } from '../models/Employee.js'
import mongoose from 'mongoose'
import { ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit, clampPage } from '../utils/query.js'
import { linkEmployeeToUser, deleteLinkedUser } from '../services/identityLink.js'
import { saveBufferToGridFS, deleteGridFSFile, isGridFsId, extractGridFsId } from '../utils/mongoStorage.js'
import { computeTodayStatusMap, ATT_STATUS_NOT_MARKED } from '../utils/attendanceStatus.js'

const gridIdOfDoc = (doc) => extractGridFsId(doc?.fileId, doc?.diskName)

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

    const departmentV = scalarOrNull(department)
    const statusV = scalarOrNull(status)
    if (departmentV != null) filter.department = departmentV
    if (statusV != null) filter.status = statusV

    const pageNum = clampPage(page)
    const limitNum = clampLimit(limit, 100)
    const sort = { [sortBy]: order === 'asc' ? 1 : -1 }

    const { data, total } = await repo.findPaginated({ filter, sort, skip: (pageNum - 1) * limitNum, limit: limitNum })

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

    if (typeof experience === 'string' && experience) clean.experienceYears = experience
    else if (Array.isArray(experience)) clean.experience = experience

    let updated
    if (Object.prototype.hasOwnProperty.call(clean, 'salary')) {

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

    await linkEmployeeToUser(updated)
    return updated
  },

  async remove(id) {
    const _id = await resolveEmployeeRef(id)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const emp = await repo.findById(_id)
    if (!emp) throw new ApiError(404, 'Employee not found')

    await deleteLinkedUser(emp)
    const deleted = await repo.deleteById(_id)
    return { id: _id }
  },

  async bulkRemove(ids) {
    if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'No ids provided')

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
    if ('emergencyContacts' in clean && !Array.isArray(clean.emergencyContacts)) {
      delete clean.emergencyContacts
    }
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

    await linkEmployeeToUser(updated)
    return updated
  },

  async addSelfDocument(user, file, category) {
    if (user.role !== 'Employee') {
      throw new ApiError(403, 'Only Employee accounts can upload their own profile documents')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')
    if (!file?.buffer) throw new ApiError(400, 'No document uploaded')

    const type = file.mimetype.includes('pdf') ? 'pdf'
      : /sheet|excel/.test(file.mimetype) ? 'excel'
      : file.mimetype.includes('image') ? 'image' : 'word'

    // MongoDB Atlas only — bytes stored in GridFS.
    const gridFsId = await saveBufferToGridFS(file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype || 'application/octet-stream',
      metadata: { owner: String(user._id), kind: 'employee-doc', employee: String(emp._id) },
    })

    const doc = await repo.pushSub(emp._id, 'documents', {
      name: file.originalname,
      type,
      category: String(category || 'General').trim() || 'General',
      size: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      contentType: file.mimetype || 'application/octet-stream',
      diskName: gridFsId,
      fileId: gridFsId,
      storage: 'gridfs',
      url: '/employees/',
      uploadedBy: String(user._id),
    })
    const item = doc.documents.at(-1).toObject()
    const realUrl = `/employees/${String(emp._id)}/documents/${String(item._id)}`

    await Employee.updateOne(
      { _id: emp._id, 'documents._id': item._id },
      { $set: { 'documents.$.url': realUrl } }
    )
    return { ...item, url: realUrl }
  },

  async getSelfDocument(user, docId) {
    if (user.role !== 'Employee') {
      throw new ApiError(403, 'Only Employee accounts can read their own profile documents')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')

    const doc = (emp.documents || []).find((d) => String(d._id) === String(docId))
    if (!doc) throw new ApiError(404, 'Document not found')
    const gid = gridIdOfDoc(doc)
    if (gid) return { gridFsId: gid, name: doc.name, mimeType: doc.contentType || doc.mimeType, isGridFS: true }
    // Legacy disk fallback (read-only). Old `diskName` values without GridFS id are
    // treated as legacy paths under profile-uploads.
    if (!doc.diskName) throw new ApiError(404, 'Document not found')
    return { legacyDiskName: doc.diskName, name: doc.name, mimeType: doc.mimeType, isGridFS: false }
  },

  async getDocumentFor(actor, empId, docId) {
    if (!['Admin', 'Manager'].includes(actor.role)) {
      throw new ApiError(403, 'You cannot read this employee\'s private documents')
    }
    const _id = await resolveEmployeeRef(empId)
    if (!_id) throw new ApiError(404, 'Employee not found')
    const emp = await repo.findByIdLean(_id)
    if (!emp) throw new ApiError(404, 'Employee not found')
    const doc = (emp.documents || []).find((d) => String(d._id) === String(docId))
    if (!doc) throw new ApiError(404, 'Document not found')
    const gid = gridIdOfDoc(doc)
    if (gid) return { gridFsId: gid, name: doc.name, mimeType: doc.contentType || doc.mimeType, isGridFS: true }
    if (!doc.diskName) throw new ApiError(404, 'Document not found')
    return { legacyDiskName: doc.diskName, name: doc.name, mimeType: doc.mimeType, isGridFS: false }
  },

  async deleteSelfDocument(user, docId) {
    if (user.role !== 'Employee') {
      throw new ApiError(403, 'Only Employee accounts can delete their own profile documents')
    }
    const emp = await this.getSelf(user)
    if (!emp) throw new ApiError(404, 'No employee profile found for this account')

    const doc = (emp.documents || []).find((d) => String(d._id) === String(docId))
    if (!doc) throw new ApiError(404, 'Document not found')

    const gid = gridIdOfDoc(doc)
    if (gid) await deleteGridFSFile(gid)

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
