import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildExpiryInstant, expiryFor } from '../src/utils/leaveExpiry.js'

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('buildExpiryInstant — month-end rule', () => {
  it('expires at 23:59:59 on the last day of the same month', () => {
    const at = buildExpiryInstant('2026-09-15')
    assert.equal(key(at), '2026-09-30')
    assert.equal(at.getHours(), 23)
    assert.equal(at.getMinutes(), 59)
    assert.equal(at.getSeconds(), 59)
  })

  it('a request ending in the next month expires at the next month end', () => {
    assert.equal(key(buildExpiryInstant('2026-10-01')), '2026-10-31')
    assert.equal(key(buildExpiryInstant('2026-10-03')), '2026-10-31')
  })

  it('handles February, leap years and year rollover', () => {
    assert.equal(key(buildExpiryInstant('2026-02-10')), '2026-02-28')
    assert.equal(key(buildExpiryInstant('2024-02-10')), '2024-02-29')
    assert.equal(key(buildExpiryInstant('2027-01-02')), '2027-01-31')
    assert.equal(key(buildExpiryInstant('2026-12-15')), '2026-12-31')
  })

  it('returns null for unparseable input', () => {
    assert.equal(buildExpiryInstant(''), null)
    assert.equal(buildExpiryInstant(null), null)
  })
})

describe('expiryFor — stored deadline wins, else month-end of leave end', () => {
  it('prefers an existing expiresAt', () => {
    const stored = new Date('2026-09-30T23:59:59')
    const at = expiryFor({ expiresAt: stored, from: '2026-09-10', to: '2026-09-12' })
    assert.equal(at.getTime(), stored.getTime())
  })

  it('falls back to month-end of the leave end date', () => {
    const at = expiryFor({ from: '2026-09-29', to: '2026-10-03' })
    assert.equal(key(at), '2026-10-31')
  })
})
