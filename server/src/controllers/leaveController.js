import { leaveService as svc } from '../services/leaveService.js'
import { asyncHandler } from '../utils/asyncHandler.js'

// Thin controller mapping requests to the leave service.
export const leaveController = {
  list: asyncHandler(async (req, res) => res.json(await svc.list(req.query))),
  myRequests: asyncHandler(async (req, res) => res.json(await svc.myRequests(req.user, req.query))),
  // LEAVE BUG 1: forward the session so the service can enforce ownership —
  // this route intentionally has no `canApprove` guard (employees open their
  // own request from a notification), so the check has to live in the service.
  get: asyncHandler(async (req, res) => res.json(await svc.get(req.params.id, req.user))),
  apply: asyncHandler(async (req, res) => res.status(201).json(await svc.apply(req.user, req.body))),
  // Phase 5.5 (Task 4): hourly permission. Kept as its own endpoint rather
  // than overloading /apply, because the payload shape differs (single date +
  // hours, no leave type or half-day) and a discriminated body would make both
  // paths harder to validate. Both still write to the SAME LeaveRequest
  // collection and share the approve/reject endpoints below.
  applyHourly: asyncHandler(async (req, res) => res.status(201).json(await svc.applyHourly(req.user, req.body))),
  hourlyBalance: asyncHandler(async (req, res) => res.json(await svc.hourlyBalance(req.user, req.query.month))),
  // Phase 4: the approver's comment is mandatory. Accept either `comment`
  // (the new, explicit field name used by the decision dialog) or the legacy
  // `note` key so any existing caller keeps working. The service rejects an
  // empty/whitespace value with a 422.
  approve: asyncHandler(async (req, res) => res.json(await svc.decide(req.params.id, 'approve', req.user.name, req.body.comment ?? req.body.note))),
  reject: asyncHandler(async (req, res) => res.json(await svc.decide(req.params.id, 'reject', req.user.name, req.body.comment ?? req.body.note))),
  cancel: asyncHandler(async (req, res) => res.json(await svc.cancel(req.user, req.params.id))),
  remove: asyncHandler(async (req, res) => res.json(await svc.remove(req.params.id))),
  balances: asyncHandler(async (req, res) => res.json(await svc.balances(req.user))),
  stats: asyncHandler(async (req, res) => res.json(await svc.stats())),
  holidays: asyncHandler(async (req, res) => res.json(await svc.holidays())),
}
