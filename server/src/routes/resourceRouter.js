import { Router } from 'express'
import { asyncHandler } from '../utils/asyncHandler.js'
import { protect, authorize } from '../middleware/auth.js'

// Ensure every resource router authenticates before applying role guards. Some
// parent routers (finance, project, employee, calendar, …) already
// call `protect` at the router level, so this is idempotent there; routers that
// forget it (hr, attendance, admin resource mounts) are now protected regardless.
// Without this, `authorize` dereferences `req.user.role` and throws when a request
// is unauthenticated, returning 500 instead of 401.

// Phase 7.2: HR is retired and merged into Manager — the HR resource surface
// is now owned by Admin + Manager.
const HR_WRITE = ['Admin', 'Manager']

// Build a REST router for a resource service produced by createResourceService.
// Wires list/all/get + protected create/update/delete with an optional validator.
//
// Role model (defense-in-depth to match the frontend route gating):
//   - readGuard  : applied to every route (reads + writes). Defaults to the
//                  write role so reads are never more permissive than writes.
//   - writeGuard : applied to create/update/delete. Defaults to HR_WRITE.
// Admin consoles override both with a stricter admin-only guard.
export function buildResourceRouter(service, { validate, extraRoutes, readGuard, writeGuard } = {}) {
  const router = Router()
  const canWrite = authorize(...HR_WRITE)
  const readGuardFn = readGuard || canWrite
  const writeGuardFn = writeGuard || canWrite

  // Authenticate first, then enforce read role. `protect` is idempotent.
  router.use(protect, readGuardFn)

  router.get('/', asyncHandler(async (req, res) => res.json(await service.list(req.query))))
  router.get('/all', asyncHandler(async (req, res) => res.json(await service.all())))
  router.get('/:id', asyncHandler(async (req, res) => res.json(await service.get(req.params.id))))

  const createChain = validate ? [writeGuardFn, validate] : [writeGuardFn]
  router.post('/', ...createChain, asyncHandler(async (req, res) => res.status(201).json(await service.create(req.body))))
  router.put('/:id', writeGuardFn, asyncHandler(async (req, res) => res.json(await service.update(req.params.id, req.body))))
  router.delete('/:id', writeGuardFn, asyncHandler(async (req, res) => res.json(await service.remove(req.params.id))))

  // Allow resource-specific endpoints (e.g. candidate stage move).
  if (extraRoutes) extraRoutes(router, writeGuardFn)

  return router
}
