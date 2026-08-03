import { makeValidator } from './hrValidators.js'

export const projectValidators = {
  // Phase 6.9 (TASK 11) - AUDIT OF BACKEND PROJECT VALIDATION.
  //
  // ROOT CAUSE: only `name` was ever required server-side, so a project could be
  // created with no client, no members and no budget even though the product
  // treats all three as mandatory. The frontend zod schema was equally loose
  // (`client`/`budget` were `.optional()` and `members` was plain component
  // state that zod never saw), so nothing on either side enforced the rule.
  //
  // FIX: require the three fields here as well, so the rule holds for ANY
  // caller - the UI, a script, or a direct API call.
  //
  // Safe for existing data: this validator is mounted ONLY on the create chain
  // (`createChain` in routes/projectRoutes.js). PUT /project/:id does not run
  // it, so partial updates of already-saved projects keep working unchanged.
  //
  // `members` works with the shared makeValidator because it rejects any value
  // whose String(...) form is blank, and String([]) === '' - so an empty member
  // array is correctly treated as missing while a populated one passes.
  project: makeValidator(['name', 'client', 'members', 'budget']),
  task: makeValidator(['title', 'project']),
  sprint: makeValidator(['name', 'project']),
  milestone: makeValidator(['title', 'project']),
  comment: makeValidator(['body']),
  file: makeValidator(['name', 'project']),
}
