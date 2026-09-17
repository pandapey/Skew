import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { idOrNameClause, isIdentityHolder } from '../src/services/identityLink.js'

describe('idOrNameClause — ID-first matching with name fallback', () => {
  it('matches by ID and name when both are known', () => {
    const id = new mongoose.Types.ObjectId()
    const clause = idOrNameClause('assignee', 'assigneeId', { name: 'Divya', userId: String(id) })
    assert.deepEqual(clause, { $or: [{ assigneeId: id }, { assignee: 'Divya' }] })
  })

  it('falls back to name-only without an ID', () => {
    assert.deepEqual(
      idOrNameClause('assignee', 'assigneeId', { name: 'Divya', userId: null }),
      { assignee: 'Divya' },
    )
  })

  it('supports dotted paths for embedded members', () => {
    const id = new mongoose.Types.ObjectId()
    const clause = idOrNameClause('members.name', 'members.userId', { name: 'Divya', userId: String(id) })
    assert.deepEqual(clause, { $or: [{ 'members.userId': id }, { 'members.name': 'Divya' }] })
  })

  it('returns an empty filter when identity is unknown', () => {
    assert.deepEqual(idOrNameClause('assignee', 'assigneeId', {}), {})
  })
})

describe('isIdentityHolder — rename-safe ownership check', () => {
  const user = { name: 'New Name', _id: new mongoose.Types.ObjectId(), role: 'Employee' }

  it('matches by ID even after a rename', () => {
    assert.equal(isIdentityHolder('Old Name', user._id, user), true)
  })

  it('matches by name for legacy docs without IDs', () => {
    assert.equal(isIdentityHolder('New Name', null, { ...user, _id: null }), true)
  })

  it('rejects strangers and anonymous callers', () => {
    assert.equal(isIdentityHolder('Old Name', new mongoose.Types.ObjectId(), user), false)
    assert.equal(isIdentityHolder('New Name', null, null), false)
  })
})

// --- Live rename simulation against a throwaway local database ------------
const LOCAL_URI = 'mongodb://127.0.0.1:27017/skew_identity_test'
let db = false
try {
  await mongoose.connect(LOCAL_URI, { serverSelectionTimeoutMS: 5000 })
  db = true
} catch {
  db = false
}

after(async () => {
  if (db) {
    await mongoose.connection.db.dropDatabase().catch(() => {})
    await mongoose.disconnect()
  }
})

describe('rename simulation — access survives a name change', { skip: !db }, () => {
  let User
  let ProjectTask
  let userId

  it('sets up a user and a task assigned by name', async () => {
    ;({ User } = await import('../src/models/User.js'))
    ;({ ProjectTask } = await import('../src/models/projectModels.js'))
    const created = await User.create({
      name: 'Test Alpha',
      email: 'identity-test-alpha@example.com',
      password: 'Test123!',
      role: 'Employee',
      empCode: 'T001',
    })
    userId = created._id
    await ProjectTask.create({
      title: 'Rename-proof task',
      assignee: 'Test Alpha',
      assigneeId: userId,
      assignedBy: 'Manager',
    })
  })

  it('still finds the task after the user is renamed', async () => {
    await User.updateOne({ _id: userId }, { $set: { name: 'Test Alpha-Renamed' } })
    const renamed = await User.findById(userId).lean()
    assert.equal(renamed.name, 'Test Alpha-Renamed')
    const clause = idOrNameClause('assignee', 'assigneeId', { name: renamed.name, userId: String(userId) })
    const found = await ProjectTask.findOne(clause).lean()
    assert.ok(found, 'task must be found via assigneeId despite the rename')
    assert.equal(
      isIdentityHolder(found.assignee, found.assigneeId, renamed),
      true,
      'ownership check must pass via ID despite the rename',
    )
  })

  it('resolves identities by current name', async () => {
    const { resolveStaffIdentity } = await import('../src/services/identityLink.js')
    const hit = await resolveStaffIdentity('Test Alpha-Renamed')
    assert.equal(String(hit.userId), String(userId))
    assert.equal(hit.empCode, 'T001')
    assert.equal(await resolveStaffIdentity('Nobody Here'), null)
  })
})
