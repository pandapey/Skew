import { Router } from 'express'
import {
  Transaction, FinanceCategory, Budget, Invoice, Payment,
} from '../models/financeModels.js'
import { createResourceService } from '../services/resourceFactory.js'
import { financeService as svc, withId, withIds } from '../services/financeService.js'
import { financeValidators } from '../validators/financeValidators.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// Finance is visible to finance staff + admins; writes limited to the same set.
// Finance was retired in Phase 4; HR inherited every Finance permission, and in
// Phase 7.2 HR itself was merged into Manager, so Manager now owns it.
const FIN_ROLES = ['Admin', 'Manager']
const canWrite = authorize(...FIN_ROLES)

router.use(protect, authorize(...FIN_ROLES))

// Resource router that normalizes _id -> id on every response.
function financeResource(Model, config, validate) {
  const { service } = createResourceService(Model, config)
  const r = Router()
  r.get('/', asyncHandler(async (req, res) => {
    const result = await service.list(req.query)
    res.json({ ...result, data: withIds(result.data) })
  }))
  r.get('/all', asyncHandler(async (req, res) => res.json(withIds(await service.all()))))
  r.get('/:id', asyncHandler(async (req, res) => res.json(withId(await service.get(req.params.id)))))
  // BUGFIX: the create handler called `.toObject()` on the return value of
  // service.create() - but createResourceService.create() ALREADY normalizes
  // (withId(plain(doc))), so `.toObject()` threw "toObject is not a function".
  // The document had ALREADY been persisted by then, so every create through
  // this generic route (categories, transactions, budgets, payments) saved the
  // record AND returned 500 - the UI showed "Could not save" while the row
  // actually appeared in the database. Same defensive shape the PUT handler
  // already uses.
  const createChain = validate ? [canWrite, validate] : [canWrite]
  r.post('/', ...createChain, asyncHandler(async (req, res) => {
    const doc = await service.create(req.body)
    res.status(201).json(withId(doc.toObject ? doc.toObject() : doc))
  }))
  r.put('/:id', canWrite, asyncHandler(async (req, res) => {
    const doc = await service.update(req.params.id, req.body)
    res.json(withId(doc.toObject ? doc.toObject() : doc))
  }))
  r.delete('/:id', canWrite, asyncHandler(async (req, res) => res.json(await service.remove(req.params.id))))
  return { router: r, service }
}

// --- Dashboard + analytics + reports (declare before generic mounts) ---
router.get('/stats', asyncHandler(async (req, res) => res.json(await svc.stats())))
router.get('/reports/tax', asyncHandler(async (req, res) => res.json(await svc.taxReport())))
router.get('/reports/period', asyncHandler(async (req, res) => res.json(await svc.periodReport(req.query.groupBy, req.query.year))))

// --- Invoices (custom: create + record payment, before generic mount) ---
const invoices = financeResource(Invoice, {
  searchFields: ['invoiceNumber', 'client'], filterFields: ['status', 'client'],
}, financeValidators.invoice)
invoices.router.post('/create', canWrite, asyncHandler(async (req, res) => res.status(201).json(await svc.createInvoice(req.body))))
invoices.router.patch('/:id/pay', canWrite, asyncHandler(async (req, res) => res.json(await svc.recordInvoicePayment(req.params.id, req.body.amount))))
router.use('/invoices', invoices.router)

// --- Straight CRUD collections ---
router.use('/transactions', financeResource(Transaction, { searchFields: ['title', 'category', 'party', 'reference'], filterFields: ['type', 'category', 'method'] }, financeValidators.transaction).router)
router.use('/categories', financeResource(FinanceCategory, { searchFields: ['name'], filterFields: ['type'] }, financeValidators.category).router)
router.use('/budgets', financeResource(Budget, { searchFields: ['category', 'period'], filterFields: ['period', 'status'] }, financeValidators.budget).router)
router.use('/payments', financeResource(Payment, { searchFields: ['paymentNumber', 'party', 'invoiceNumber'], filterFields: ['direction', 'status', 'method'] }, financeValidators.payment).router)

export default router
