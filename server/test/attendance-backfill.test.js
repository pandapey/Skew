import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { backfillAbsentDays } from '../src/utils/attendanceStatus.js'

// September 2026: 1st is a Tuesday. Sundays fall on 6th, 13th, 20th, 27th.
describe('backfillAbsentDays — mini-calendar absent rule', () => {
  it('marks unrecorded elapsed working days Absent', () => {
    const out = backfillAbsentDays({}, '2026-09-01', '2026-09-30', new Set(), '2026-09-04')
    assert.equal(out['2026-09-01'], 'Absent')
    assert.equal(out['2026-09-02'], 'Absent')
    assert.equal(out['2026-09-03'], 'Absent')
    assert.equal(out['2026-09-04'], 'Absent')
    assert.equal(out['2026-09-05'], undefined) // future stays blank
  })

  it('never overwrites recorded statuses', () => {
    const out = backfillAbsentDays(
      { '2026-09-02': 'Present', '2026-09-03': 'On Leave' },
      '2026-09-01', '2026-09-04', new Set(), '2026-09-04',
    )
    assert.equal(out['2026-09-02'], 'Present')
    assert.equal(out['2026-09-03'], 'On Leave')
    assert.equal(out['2026-09-01'], 'Absent')
  })

  it('skips Sundays and holidays (client paints those itself)', () => {
    const out = backfillAbsentDays({}, '2026-09-04', '2026-09-08', new Set(['2026-09-07']), '2026-09-08')
    assert.equal(out['2026-09-04'], 'Absent') // Friday
    assert.equal(out['2026-09-05'], 'Absent') // Saturday is a working day
    assert.equal(out['2026-09-06'], undefined) // Sunday
    assert.equal(out['2026-09-07'], undefined) // holiday
    assert.equal(out['2026-09-08'], 'Absent')
  })

  it('caps the range at today and does not mutate the input', () => {
    const input = { '2026-09-01': 'Present' }
    const out = backfillAbsentDays(input, '2026-09-01', '2026-09-30', new Set(), '2026-09-02')
    assert.equal(out['2026-09-03'], undefined)
    assert.deepEqual(input, { '2026-09-01': 'Present' })
  })

  it('returns the map untouched for empty/inverted ranges', () => {
    assert.deepEqual(backfillAbsentDays({ a: 1 }, '2026-09-05', '2026-09-01', new Set(), '2026-09-30'), { a: 1 })
  })
})
