import { Employee } from '../models/Employee.js'

// PHASE EMPLOYEE-DETAILS/WORK-LOCATION (TASK 2) - RETIRED-FIELD READ SUPPRESSION
//
// Removing `workLocation` from the schema stops the application WRITING it, but
// not READING it: these queries use `.lean()`, which returns the raw BSON
// document straight from the driver rather than a hydrated model, so a document
// stored before this phase still carried the retired key all the way into the
// JSON response. Verified over HTTP against the real database - GET
// /employees/:id was still emitting `workLocation` for all 8 pre-existing
// employees.
//
// This is an explicit EXCLUSION PROJECTION, which MongoDB applies regardless of
// whether the field is declared on the schema. It is deliberately NOT a
// migration: no stored document is modified, so the change is reversible and
// non-destructive. A `$unset` clean-up script is provided separately in
// server/src/migrations/ and is NOT run automatically.
const HIDE_RETIRED = { workLocation: 0 }

// Repository: the only layer that talks to Mongoose for employees.
// Keeps the service free of ORM specifics (swappable persistence).
export const employeeRepository = {
  async findPaginated({ filter, sort, skip, limit }) {
    const [data, total] = await Promise.all([
      Employee.find(filter, HIDE_RETIRED).sort(sort).skip(skip).limit(limit).lean(),
      Employee.countDocuments(filter),
    ])
    return { data, total }
  },

  findById: (id) => Employee.findById(id),
  findByIdLean: (id) => Employee.findById(id, HIDE_RETIRED).lean(),
  findOne: (query) => Employee.findOne(query),
  create: (payload) => Employee.create(payload),
  // `projection` keeps the retired key out of the UPDATE response too — the
  // controller returns this document straight to the client.
  updateById: (id, patch) =>
    Employee.findByIdAndUpdate(id, patch, { new: true, runValidators: true, projection: HIDE_RETIRED }),
  deleteById: (id) => Employee.findByIdAndDelete(id),
  deleteMany: (ids) => Employee.deleteMany({ _id: { $in: ids } }),
  updateMany: (ids, patch) => Employee.updateMany({ _id: { $in: ids } }, { $set: patch }),

  // Push a subdocument (documents array etc.) and return the updated doc.
  pushSub: (id, field, value) =>
    Employee.findByIdAndUpdate(id, { $push: { [field]: value } }, { new: true }),

  aggregate: (pipeline) => Employee.aggregate(pipeline),
  countAll: () => Employee.countDocuments(),
}
