import { makeValidator } from './hrValidators.js'

export const projectValidators = {

  project: makeValidator(['name', 'client', 'members']),
  task: makeValidator(['title']),
  sprint: makeValidator(['name', 'project']),
  milestone: makeValidator(['title', 'project']),
  comment: makeValidator(['body']),
  file: makeValidator(['name', 'project']),
}
