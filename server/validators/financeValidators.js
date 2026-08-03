import { makeValidator } from './hrValidators.js'

const isPos = { test: (v) => !Number.isNaN(Number(v)) && Number(v) > 0, message: 'must be a positive number' }
const isNonNeg = { test: (v) => !Number.isNaN(Number(v)) && Number(v) >= 0, message: 'must be a positive number' }

// Field-level validators mirroring the frontend Zod schemas for each finance entity.
export const financeValidators = {
  transaction: makeValidator(['title', 'type', 'category'], { amount: isPos }),
  category: makeValidator(['name', 'type']),
  budget: makeValidator(['category'], { allocated: isNonNeg }),
  invoice: makeValidator(['client']),
  payment: makeValidator(['direction', 'party'], { amount: isPos }),
}
