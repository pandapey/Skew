import { Router } from 'express'
import { protect, authorize } from '../middleware/auth.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { upload } from '../middleware/upload.js'
import * as ctrl from '../controllers/clientController.js'

const router = Router()

// --- Client-facing surface: any authenticated client sees ONLY their data ---
router.use(protect, authorize('Client'))

router.get('/profile', ctrl.getProfile)
router.get('/projects', ctrl.getProjects)
router.get('/projects/:id', ctrl.getProject)
router.get('/projects/:id/tasks', ctrl.getProjectSub('tasks'))
router.get('/projects/:id/timeline', ctrl.getProjectSub('timeline'))
router.get('/projects/:id/team', ctrl.getProjectSub('team'))
router.get('/projects/:id/activity', ctrl.getProjectSub('activity'))
router.get('/projects/:id/documents', ctrl.getProjectSub('documents'))
router.get('/projects/:id/payments', ctrl.getProjectSub('payments'))
// Phase 5.4 (Task 4), extended Phase 5.8 (Task 2): the shared project
// discussion thread, now the ENTIRE Client Portal "Messages" surface (Project
// Communication Center). Client-reachable comment endpoints only -
// projectRoutes.js stays blocked to Clients - all scoped to the caller's own
// clientId server-side, and edit/delete are additionally ownership-checked
// inside projectSvc.updateComment/deleteComment.
router.get('/projects/:id/comments', ctrl.getProjectComments)
router.post('/projects/:id/comments', ctrl.addProjectComment)
router.patch('/projects/:id/comments/:commentId', ctrl.updateProjectComment)
router.delete('/projects/:id/comments/:commentId', ctrl.deleteProjectComment)
router.post('/projects/:id/comments/attachments', upload.single('file'), ctrl.uploadCommentAttachment)
// Phase 5.8 (Task 3): Documents, rebuilt on the same ClientProject.documents
// sub-array Admin already writes - real multer upload, ownership-checked
// delete, disk download via the same path-safety pattern as fileRoutes.js.
router.post('/projects/:id/documents', upload.single('file'), ctrl.uploadClientDocument)
router.delete('/projects/:id/documents/:docId', ctrl.deleteClientDocument)
router.get('/projects/:id/documents/:docId/download', ctrl.downloadClientDocument)
// Phase 5.8 (Task 5): Task History tab (reuses projectSvc.taskHistory).
router.get('/projects/:id/task-history', ctrl.getProjectTaskHistory)
// Phase 5.8 (Task 7): Progress Dashboard (reuses ProjectTask/Milestone reads).
router.get('/projects/:id/progress', ctrl.getProjectProgress)
router.get('/tasks', asyncHandler(async (req, res) => {
  // All tasks across the client's projects.
  const id = req.user.clientId
  if (!id) throw new ApiError(403, 'Your account is not linked to a client')
  const filter = { clientId: id }
  if (req.query.projectId) filter.projectId = req.query.projectId
  const projects = await (await import('../models/clientModels.js')).ClientProject.find(filter).lean()
  const rows = []
  projects.forEach((p) => (p.tasks || []).forEach((t) => rows.push({ ...t, projectId: p.projectId, projectName: p.name, projectCode: p.code })))
  res.json(rows)
}))
// Aggregate views across all the client's projects (optional ?projectId= filter).
router.get('/timeline', ctrl.getAllTimeline)
router.get('/team', ctrl.getAllTeam)
router.get('/activity', ctrl.getAllActivity)
router.get('/documents', ctrl.getAllDocuments)
router.get('/payments', ctrl.getAllPayments)
router.get('/invoices', ctrl.getAllInvoices)
// Phase 6.11 (TASK 5): read-only Company Holidays for the meeting date picker.
// Mounted on THIS router, which is already `protect, authorize('Client')`, so
// the existing staff-only holiday endpoints in attendanceRoutes/leaveRoutes are
// left exactly as they are - no guard is widened to admit the Client role.
// Read-only by design: there is no POST/PATCH/DELETE counterpart here, so
// holidays remain Admin/HR-managed.
router.get('/holidays', ctrl.getHolidays)
router.get('/meetings', ctrl.getMeetings)
// Phase 6.9 (Task 17): client requests a new meeting - creates a real
// CalendarEvent (type: 'meeting', meetingStatus: 'Pending').
router.post('/meetings', ctrl.createMeetingRequest)
// Phase 6.17 (TASK 3) ROOT CAUSE FIX: the Client's Accept/Reject/Reschedule
// surface for a meeting STAFF requested. Mirrors PATCH /calendar/:id/meeting-
// status and /:id/reschedule on the staff-only calendar router (calendarRoutes.js
// stays `blockClient`'d - untouched, nothing there is widened to the Client
// role). Mounted here instead, on this already `protect, authorize('Client')`
// router, scoped to the caller's own clientId inside the controller
// (assertClientCanRespond). Same CalendarEvent model, same MEETING_STATUSES
// vocabulary, same notification/realtime helpers as every other meeting
// mutation - not a second meeting API.
router.patch('/meetings/:id/status', ctrl.respondToMeeting)
router.patch('/meetings/:id/reschedule', ctrl.rescheduleMeetingAsClient)
// Phase 5.8 (Task 1): Announcements removed from the Client Portal only -
// route deleted here; Admin/HR/Manager/Employee announcement surfaces
// (adminClientRouter.post('/announcements', ...) below, and their own
// pages) are untouched.
router.get('/notifications', ctrl.getNotifications)
// Phase 6.3 (Task 10): POST (not PATCH) to match the existing staff endpoint
// POST /notifications/read-all in notificationRoutes.js - one convention across
// both notification surfaces. Sits behind this file's `protect,
// authorize('Client')` guard and is scoped to req.user.clientId in the
// controller, so it is strictly per-account.
router.post('/notifications/read-all', ctrl.markAllNotificationsRead)
router.patch('/notifications/:id/read', ctrl.markNotificationRead)
// Phase 5.8 (Task 2): '/messages' and '/messages/:id/reply' removed - replaced
// by the project-scoped comment routes above.

// --- Admin surface: manage clients + their portal data (mounted in adminRoutes) ---
export const adminClientRouter = Router()
// Phase 6.1 ROOT CAUSE: this single line was `authorize('Admin')`, so EVERY
// client endpoint was Admin-only. That is why HR/Manager could not view or
// create clients and had to be pushed into the Admin panel.
//
// The gate is now widened to Admin/HR/Manager, but ONLY for the client CRUD
// endpoints below - and Manager reads/writes are scoped per-document inside
// clientController via scopeService, so a Manager still cannot touch a client
// that is not linked to a project they lead. Destructive and billing endpoints
// stay Admin-only (see `adminOnly` below), so nothing is weakened.
adminClientRouter.use(protect, authorize('Admin', 'HR', 'Manager'))

// Roles allowed to create/update a client record. Manager is included because
// the spec requires "Create Client" / "Edit Clients related to their own
// projects"; the per-document scope check is what enforces the "their own"
// half, not this coarse role list.
const clientWrite = authorize('Admin', 'HR', 'Manager')
// Deliberately unchanged from the previous behaviour: destructive deletes,
// billing/invoice mutations, announcements and the unscoped cross-client
// project listing remain Admin-only. Widening these was NOT requested and
// would leak other clients' data to a Manager.
const adminOnly = authorize('Admin')

adminClientRouter.get('/clients', ctrl.listClients)
// NOTE: listAllProjects returns EVERY client project with no per-caller scope,
// so it stays Admin-only. Widening it would leak unrelated clients' budgets.
adminClientRouter.get('/projects', adminOnly, ctrl.listAllProjects)
adminClientRouter.get('/clients/:id', ctrl.getClient)
adminClientRouter.post('/clients', clientWrite, ctrl.createClient)
adminClientRouter.put('/clients/:id', clientWrite, ctrl.updateClient)
adminClientRouter.delete('/clients/:id', adminOnly, ctrl.removeClient)
// Phase 6.1: all of the following keep their ORIGINAL Admin-only behaviour.
// They are now explicit rather than relying on the router-level authorize()
// that used to be Admin-only, so widening the router above did not silently
// hand these to HR/Manager. This is a no-op RBAC-wise - it preserves exactly
// what these routes allowed before Phase 6.1.
adminClientRouter.post('/clients/:id/projects', adminOnly, ctrl.assignProject)
adminClientRouter.put('/projects/:id/manager', adminOnly, ctrl.assignProjectManager)
adminClientRouter.put('/projects/:id/team', adminOnly, ctrl.assignTeam)
adminClientRouter.put('/projects/:id/progress', adminOnly, ctrl.updateProjectProgress)
adminClientRouter.post('/projects/:id/invoices', adminOnly, ctrl.generateInvoice)
adminClientRouter.put('/projects/:id/payments/:paymentId', adminOnly, ctrl.updatePayment)
adminClientRouter.post('/projects/:id/documents', adminOnly, ctrl.uploadDocument)
adminClientRouter.post('/announcements', adminOnly, ctrl.publishAnnouncement)
adminClientRouter.get('/clients/:id/messages', adminOnly, ctrl.adminListMessages)
adminClientRouter.post('/messages/:id/reply', adminOnly, ctrl.adminReplyMessage)

export default router
