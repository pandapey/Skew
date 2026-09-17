import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canReviewTask } from '../src/services/projectService.js'

const admin = { name: 'Aarav', role: 'Admin' }
const manager = { name: 'Rahul', role: 'Manager' }
const lead = { name: 'Lead', role: 'Employee' }
const assignee = { name: 'Divya', role: 'Employee' }
const stranger = { name: 'Stranger', role: 'Employee' }
const project = { lead: 'Lead', members: [{ name: 'Divya' }] }

const submittedBy = (by) => ({
  assignedBy: 'Rahul',
  assignee: 'Divya',
  submission: { by },
})

describe('canReviewTask — who may approve a submitted task', () => {
  it('allows Admin / Manager / assigner / project lead', () => {
    const task = submittedBy('Divya')
    assert.equal(canReviewTask(task, project, admin).allowed, true)
    assert.equal(canReviewTask(task, project, manager).allowed, true)
    assert.equal(canReviewTask(task, project, lead).allowed, true)
  })

  it('allows a non-privileged assigner to review (employee assigning to employee)', () => {
    const task = { assignedBy: 'A', assignee: 'B', submission: { by: 'B' } }
    assert.equal(canReviewTask(task, null, { name: 'A', role: 'Employee' }).allowed, true)
  })

  it('blocks strangers with the lead-only message', () => {
    const verdict = canReviewTask(submittedBy('Divya'), project, stranger)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /project lead/)
  })

  it('allows the assignee to approve their own General Task', () => {
    const task = { assignedBy: 'Divya', assignee: 'Divya', submission: { by: 'Divya' } }
    assert.equal(canReviewTask(task, null, assignee).allowed, true)
  })

  it('allows the assigner to review a General Task without a project', () => {
    const task = { assignedBy: 'Rahul', assignee: 'Divya', submission: { by: 'Divya' } }
    assert.equal(canReviewTask(task, null, manager).allowed, true)
  })

  it('blocks a non-assignee from reviewing their own submission', () => {
    // e.g. a lead who submitted on someone else's behalf still cannot review it
    const task = { assignedBy: 'Rahul', assignee: 'Divya', submission: { by: 'Lead' } }
    const verdict = canReviewTask(task, project, lead)
    assert.equal(verdict.allowed, false)
    assert.match(verdict.reason, /own submission/)
  })

  it('lets Admins review anything, including their own submissions', () => {
    const task = { assignedBy: 'Aarav', assignee: 'Divya', submission: { by: 'Aarav' } }
    assert.equal(canReviewTask(task, project, admin).allowed, true)
  })
})
