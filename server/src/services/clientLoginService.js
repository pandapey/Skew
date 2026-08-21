import { User } from '../models/User.js'
import { ApiError } from '../utils/asyncHandler.js'
import { generateTempPassword, validatePassword } from '../utils/password.js'

// ---------------------------------------------------------------------------
// Phase 6.6 (TASK 2): ONE client-portal-login provisioning routine.
//
// ROOT CAUSE OF TASK 2 (traced UI -> Route -> API -> Controller -> Service -> DB):
//   * UI:         pages/Clients.jsx renders the shared EntityManager create
//                 modal for HR/Manager. Its `fields` array had no password
//                 entry, so there was no way to type one.
//   * API:        clientService.createClient -> POST /api/admin/clients.
//   * Controller: controllers/clientController.js createClient() did
//                 `Client.create({...req.body})` and NOTHING else. It never
//                 touched the User collection.
//   => Therefore a client created from Manager -> Clients -> Add Client got a
//      Client document but no login User document, i.e. "no login account",
//      exactly as reported. The missing password field was only the visible
//      half; the controller not provisioning a login was the other half.
//
// WHY THIS FILE EXISTS (de-duplication, not duplication):
//   services/projectService.js ALREADY contained a fully-developed portal-login
//   provisioning block inside createProjectWithClient() (reuse-existing-user,
//   role-conflict detection, password-policy enforcement, temp-password
//   fallback). Re-implementing that inside clientController would have been a
//   second, drifting copy of the same rules. Instead the logic is extracted
//   here VERBATIM and both callers now share it:
//     1. services/projectService.js  (transactional path: passes session/mk/rb)
//     2. controllers/clientController.js (plain path: no session)
//   Net effect on the codebase is one implementation where there used to be one
//   implementation plus one gap - no behavioural change for the project flow.
// ---------------------------------------------------------------------------

// Default document factory for callers with no transaction. Mirrors the `mk`
// helper in projectService.js so behaviour is identical on both paths.
const plainMk = async (Model, doc) => (await Model.create([doc]))[0]

/**
 * Provision (or reuse) the client-portal login User for a Client document.
 *
 * @param {object}   args.client   Persisted Client document (needs clientId, email, company, contactPerson, phone).
 * @param {string}   [args.email]  Preferred login email; falls back to client.email.
 * @param {string}   [args.password] Plaintext password. When blank a temporary one is generated and returned.
 * @param {object}   [args.session]  Mongoose session for the transactional caller.
 * @param {Function} [args.mk]       Document factory (Model, doc, session) => doc.
 * @param {object}   [args.rb]       Rollback stack exposing .add(fn), used on the compensating path.
 * @returns {Promise<{portalUser: object|null, credentials: {email: string, temporaryPassword: string}|null, created: boolean}>}
 */
export async function provisionClientLogin({
  client,
  email = '',
  password = '',
  session = null,
  mk = plainMk,
  rb = null,
} = {}) {
  if (!client?.clientId) throw new ApiError(400, 'A persisted client is required to provision a login.')

  const q = (m) => (session ? m.session(session) : m)

  // Reuse before creating: a client must never end up with two portal logins.
  let portalUser = await q(User.findOne({ role: 'Client', clientId: client.clientId }))
  if (portalUser) return { portalUser, credentials: null, created: false }

  const loginEmail = String(email || client.email || '').toLowerCase().trim()
  if (!loginEmail) {
    throw new ApiError(400, 'An email address is required to create a client portal login.')
  }

  // A User on this email may already exist (possibly unlinked). Reuse it
  // rather than colliding with the unique email index.
  const existingUser = await q(User.findOne({ email: loginEmail }))
  if (existingUser) {
    if (existingUser.role !== 'Client') {
      throw new ApiError(409, `${loginEmail} already belongs to a ${existingUser.role} account.`)
    }
    if (!existingUser.clientId) {
      await User.updateOne(
        { _id: existingUser._id },
        { $set: { clientId: client.clientId } },
        session ? { session } : {},
      )
    }
    return { portalUser: existingUser, credentials: null, created: false }
  }

  // SERVER-SIDE VALIDATION IS AUTHORITATIVE (Task 2 requirement): the same
  // utils/password.js policy the Admin -> Users create path enforces is applied
  // here, regardless of what the browser validated.
  let credentials = null
  let plain = String(password || '')
  if (plain) {
    if (!validatePassword(plain).valid) {
      throw new ApiError(400, 'Password does not meet the required policy (8-64 chars, upper, lower, number, special).')
    }
  } else {
    plain = generateTempPassword()
    credentials = { email: loginEmail, temporaryPassword: plain }
  }

  // The User model's pre-save hook hashes `password`; never hash here.
  portalUser = await mk(User, {
    name: client.contactPerson || client.company,
    email: loginEmail,
    password: plain,
    role: 'Client',
    clientId: client.clientId,
    phone: client.phone || '',
    status: 'Active',
  }, session)
  if (rb) rb.add(() => User.deleteOne({ _id: portalUser._id }))

  return { portalUser, credentials, created: true }
}
