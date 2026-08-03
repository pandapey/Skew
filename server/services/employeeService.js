import { employeeRepository as repo } from '../repositories/employeeRepository.js'
import { Employee } from '../models/Employee.js'
import { ApiError } from '../utils/asyncHandler.js'
import { scalarOrNull, escapeRegex, clampLimit, clampPage } from '../utils/query.js'
import { linkEmployeeToUser, deleteLinkedUser } from '../services/identityLink.js'

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
    return { data, total, page: pageNum, limit: limitNum, totalPages: Math.max(1, Math.ceil(total / limitNum)) }
  },

  async getById(id) {
    const emp = await repo.findByIdLean(id)
    if (!emp) throw new ApiError(404, 'Employee not found')
    return emp
  },

  async update(id, patch) {
    const { experience, employeeId, password, confirmPassword, role, ...rest } = patch
    const clean = { ...rest }
    if (typeof experience === 'string' && experience) clean.experienceYears = experience

    let updated
    if (Object.prototype.hasOwnProperty.call(clean, 'salary')) {
      // Phase 5.4 (Task 2) root cause: the employee form submits salary as a
      // flat CTC number (`salary: 1200000`), but the schema stores it as a
      // subdocument ({ ctc, basic, hra, allowances, pf, tax, net, monthly }).
      // This went straight through `repo.updateById` → `findByIdAndUpdate`,
      // which (a) cannot cast a bare number into that subdocument and (b)
      // bypasses `.save()` middleware entirely — so the `pre('save')` hook in
      // Employee.js that derives basic/hra/allowances/pf/tax/net from ctc never
      // ran. The breakdown stayed empty, which is why the Salary tab always
      // rendered ₹0.
      //
      // Fix: route salary changes through `.save()` so the EXISTING hook does
      // the derivation (no duplicated math here), and reset the breakdown so
      // the hook recomputes on every CTC change, not just the first one.
      const rawCtc = clean.salary && typeof clean.salary === 'object' ? clean.salary.ctc : clean.salary
      const ctc = Number(rawCtc) || 0
      const doc = await Employee.findById(id)
      if (!doc) throw new ApiError(404, 'Employee not found')
      doc.set({ ...clean, salary: { ctc } })
      updated = (await doc.save()).toObject()
    } else {
      updated = await repo.updateById(id, clean)
    }
    if (!updated) throw new ApiError(404, 'Employee not found')
    // Keep the linked login User in sync (creates one if none exists yet).
    await linkEmployeeToUser(updated)
    return updated
  },

  async remove(id) {
    const emp = await repo.findById(id)
    if (!emp) throw new ApiError(404, 'Employee not found')
    // Cascade: remove the linked login User too.
    await deleteLinkedUser(emp)
    const deleted = await repo.deleteById(id)
    return { id }
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
    const updated = await repo.pushSub(id, 'documents', doc)
    if (!updated) throw new ApiError(404, 'Employee not found')
    return updated.documents.at(-1)
  },

  async setPhoto(id, url) {
    const updated = await repo.updateById(id, { avatar: url })
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
