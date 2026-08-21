import { makeValidator } from './hrValidators.js'

export const projectValidators = {
  // PROJECT FORM SIMPLIFICATION: the create form no longer collects
  // Priority / Budget / Start Date / End Date / Advance Payment / Monthly Due /
  // Billing Cycle / Payment Method, so `budget` is dropped from the server-side
  // create requirements (it used to be required here). The model keeps the
  // columns with their defaults (Medium / 0 / '' / Monthly / Bank Transfer),
  // so nothing downstream breaks and existing projects are untouched.
  //
  // Safe for existing data: this validator is mounted ONLY on the create chain
  // (`createChain` in routes/projectRoutes.js). PUT /project/:id does not run
  // it, so partial updates of already-saved projects keep working unchanged.
  //
  // `members` works with the shared makeValidator because it rejects any value
  // whose String(...) form is blank, and String([]) === '' - so an empty member
  // array is correctly treated as missing while a populated one passes.
  project: makeValidator(['name', 'client', 'members']),
  task: makeValidator(['title', 'project']),
  sprint: makeValidator(['name', 'project']),
  milestone: makeValidator(['title', 'project']),
  comment: makeValidator(['body']),
  file: makeValidator(['name', 'project']),
}
