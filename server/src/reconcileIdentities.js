// One-time helper: link existing (seeded) Users and Employees into a single
// identity, mirroring the live behaviour added in identityLink.js.
//
// For every staff User it ensures a linked Employee exists (creating one if
// needed); for every Employee without a linked login it creates a User account
// with a generated temp password. Run once after deploying the identity-link
// change to make historical data consistent:
//
//   npm run reconcile          # from repo root
//
// NOTE: this will create login accounts for any Employee that doesn't already
// have one (with auto-generated temp passwords printed to the console).
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import { User } from './models/User.js'
import { Employee } from './models/Employee.js'
import { STAFF_ROLES, linkUserToEmployee, linkEmployeeToUser } from './services/identityLink.js'

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/skew'

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
  console.log('Connected. Reconciling Users <-> Employees...')

  const users = await User.find({ role: { $in: STAFF_ROLES } }).lean()
  let userLinked = 0
  for (const u of users) {
    const emp = await linkUserToEmployee(u)
    if (emp) userLinked++
  }
  console.log(`Users -> Employees: ${userLinked}/${users.length} linked/created`)

  const employees = await Employee.find({}).lean()
  let empProcessed = 0
  const creds = []
  for (const e of employees) {
    const { credentials } = await linkEmployeeToUser(e)
    empProcessed++
    if (credentials) creds.push(credentials)
  }
  console.log(`Employees -> Users: ${empProcessed}/${employees.length} processed`)

  if (creds.length) {
    console.log(`\nCreated ${creds.length} login account(s) with temp passwords:`)
    creds.forEach((c) => console.log(`  ${c.email} : ${c.temporaryPassword}`))
  } else {
    console.log('\nNo new login accounts were needed.')
  }

  await mongoose.disconnect()
  console.log('Reconcile complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
