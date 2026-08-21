import { Router } from 'express'
import { calendarController as ctrl } from '../controllers/calendarController.js'
import { protect, authorize, blockClient } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'

const router = Router()

// Roles permitted to create / edit / delete calendar events.
const canWrite = authorize('Admin', 'Manager')

router.use(protect, blockClient)

// Reads
router.get('/', asyncHandler(ctrl.list))
router.get('/range', asyncHandler(ctrl.range))
router.get('/:id', asyncHandler(ctrl.get))

// Writes
// Phase 6.21 (TASK 2): the canWrite gate is REMOVED here for the same reason
// (and with the same safety property) as meeting-status and reschedule below -
// the controller self-authorizes in assertCanCreate with a rule that is
// NARROWER than canWrite for everyone it newly admits: a non-privileged user
// may create ONLY a pending meeting request, and ONLY for a project the
// database says they LEAD. Admin/HR/Manager behaviour is byte-for-byte
// unchanged; PUT/PATCH done/DELETE below keep their canWrite gate.
router.post('/', asyncHandler(ctrl.create))
router.put('/:id', canWrite, asyncHandler(ctrl.update))
router.patch('/:id/done', canWrite, asyncHandler(ctrl.toggleDone))
// Phase 6.9 (Task 17): Approve/Reject/Cancel a client meeting request. No
// canWrite gate here - the controller self-authorizes (Admin/Manager/HR OR
// the Employee who leads the related project), which is a narrower rule than
// canWrite alone would allow.
router.patch('/:id/meeting-status', asyncHandler(ctrl.updateMeetingStatus))
// Phase 6.12 (TASK 2): reschedule a client meeting request. Same deliberate
// absence of a canWrite gate as meeting-status above, for the same reason - the
// controller self-authorizes via assertCanManageMeeting (Admin/Manager/HR OR
// the Employee who leads the related project), which is NARROWER than canWrite.
// The generic PUT '/:id' above keeps its canWrite gate, so this adds a single
// tightly-scoped start/end change and widens nothing else.
router.patch('/:id/reschedule', asyncHandler(ctrl.rescheduleMeeting))
router.delete('/:id', canWrite, asyncHandler(ctrl.remove))

export default router
