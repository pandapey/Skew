import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLeaveDuration } from '../src/utils/leaveDays.js'

describe('resolveLeaveDuration — working-day counting', () => {
  it('excludes Sundays from multi-day ranges', () => {
    // Fri 2026-09-04 → Mon 2026-09-07 skips Sun 2026-09-06
    const r = resolveLeaveDuration({ from: '2026-09-04', to: '2026-09-07' })
    assert.equal(r.error, null)
    assert.equal(r.days, 3)
    assert.equal(r.sundaysExcluded, 1)
  })

  it('excludes company holidays', () => {
    const r = resolveLeaveDuration({
      from: '2026-09-07', to: '2026-09-08', holidays: new Set(['2026-09-07']),
    })
    assert.equal(r.error, null)
    assert.equal(r.days, 1)
  })

  it('rejects Sunday endpoints and inverted ranges', () => {
    assert.match(resolveLeaveDuration({ from: '2026-09-06', to: '2026-09-07' }).error, /Sunday/)
    assert.match(resolveLeaveDuration({ from: '2026-09-08', to: '2026-09-07' }).error, /no working days/)
  })

  it('validates half-day requests', () => {
    const ok = resolveLeaveDuration({ from: '2026-09-07', to: '2026-09-07', halfDay: true, halfDaySession: 'First Half' })
    assert.equal(ok.error, null)
    assert.equal(ok.days, 0.5)
    const bad = resolveLeaveDuration({ from: '2026-09-07', to: '2026-09-08', halfDay: true, halfDaySession: 'First Half' })
    assert.match(bad.error, /same date/)
  })
})
