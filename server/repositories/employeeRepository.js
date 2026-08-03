import { Employee } from '../models/Employee.js'

// Repository: the only layer that talks to Mongoose for employees.
// Keeps the service free of ORM specifics (swappable persistence).
export const employeeRepository = {
  async findPaginated({ filter, sort, skip, limit }) {
    const [data, total] = await Promise.all([
      Employee.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      Employee.countDocuments(filter),
    ])
    return { data, total }
  },

  findById: (id) => Employee.findById(id),
  findByIdLean: (id) => Employee.findById(id).lean(),
  findOne: (query) => Employee.findOne(query),
  create: (payload) => Employee.create(payload),
  updateById: (id, patch) => Employee.findByIdAndUpdate(id, patch, { new: true, runValidators: true }),
  deleteById: (id) => Employee.findByIdAndDelete(id),
  deleteMany: (ids) => Employee.deleteMany({ _id: { $in: ids } }),
  updateMany: (ids, patch) => Employee.updateMany({ _id: { $in: ids } }, { $set: patch }),

  // Push a subdocument (documents array etc.) and return the updated doc.
  pushSub: (id, field, value) =>
    Employee.findByIdAndUpdate(id, { $push: { [field]: value } }, { new: true }),

  aggregate: (pipeline) => Employee.aggregate(pipeline),
  countAll: () => Employee.countDocuments(),
}
