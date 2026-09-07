import { Router } from 'express'
import mongoose from 'mongoose'
import { protect, authorize } from '../middleware/auth.js'
import { asyncHandler, ApiError } from '../utils/asyncHandler.js'
import { Domain, HostingPlan, Registrar } from '../models/infrastructureModels.js'
import { Client } from '../models/clientModels.js'
import { validateDomainPayload, validateHostingPayload } from '../validators/infrastructureValidators.js'
import { escapeRegex, clampLimit, clampPage } from '../utils/query.js'

const DEFAULT_REGISTRARS = ['GoDaddy', 'BigRock', 'Namecheap', 'Cloudflare', 'Google Domains', 'Hostinger', 'Name.com', 'Bluehost', 'HostGator']

async function ensureDefaultRegistrars() {
  try {
    const count = await Registrar.countDocuments()
    if (count === 0) {
      await Registrar.insertMany(DEFAULT_REGISTRARS.map((name) => ({ name })), { ordered: false })
    }
  } catch {}
}
ensureDefaultRegistrars()

async function ensureRegistrar(name) {
  const clean = String(name || '').trim()
  if (!clean) return
  if (clean.length > 120) return
  const exists = await Registrar.findOne({ name: { $regex: new RegExp(`^${escapeRegex(clean)}$`, 'i') } }).lean()
  if (!exists) {
    try { await Registrar.create({ name: clean }) } catch {}
  }
}

const INFRA_WRITE = ['Admin', 'Manager']
const WINDOW_DAYS = 30

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
function normalizeDate(v) {
  if (v == null || String(v).trim() === '') return null
  const d = new Date(v)
  if (isNaN(d)) return null
  d.setHours(0, 0, 0, 0)
  return d
}
function statusMatches(doc, filter) {
  if (!filter) return true
  const exp = doc.expiresOn ? new Date(doc.expiresOn) : null
  if (!exp) return false
  exp.setHours(0, 0, 0, 0)
  const today = todayStart()
  const windowEnd = addDays(today, WINDOW_DAYS)
  if (filter === 'expiring') return exp >= today && exp <= windowEnd
  if (filter === 'expired') return exp < today
  if (filter === 'active') return exp > windowEnd
  return true
}
function assertValidId(id, label) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ApiError(400, `Invalid ${label} id`)
}

// Populate helper — returns domain objects with client info
async function enrichDomains(docs) {
  const clientIds = [...new Set(docs.map((d) => String(d.client)).filter(Boolean))]
  const clients = clientIds.length
    ? await Client.find({ _id: { $in: clientIds } }).select('company').lean()
    : []
  const cMap = new Map(clients.map((c) => [String(c._id), c.company || 'Unknown client']))
  // hosting counts
  const domainIds = docs.map((d) => d._id)
  const hostingAgg = domainIds.length
    ? await HostingPlan.aggregate([
        { $match: { domain: { $in: domainIds }, isDeleted: { $ne: true } } },
        { $group: { _id: '$domain', count: { $sum: 1 } } },
      ])
    : []
  const hMap = new Map(hostingAgg.map((r) => [String(r._id), r.count]))
  return docs.map((d) => ({
    ...d,
    id: String(d._id),
    clientName: cMap.get(String(d.client)) || 'Unknown client',
    hostingCount: hMap.get(String(d._id)) || 0,
  }))
}
async function enrichHosting(docs) {
  const clientIds = [...new Set(docs.map((h) => String(h.client)).filter(Boolean))]
  const domainIds = [...new Set(docs.map((h) => h.domain && String(h.domain)).filter(Boolean))]
  const [clients, domains] = await Promise.all([
    clientIds.length ? Client.find({ _id: { $in: clientIds } }).select('company').lean() : [],
    domainIds.length ? Domain.find({ _id: { $in: domainIds } }).select('domainName').lean() : [],
  ])
  const cMap = new Map(clients.map((c) => [String(c._id), c.company || 'Unknown client']))
  const dMap = new Map(domains.map((d) => [String(d._id), d.domainName || '']))
  return docs.map((h) => ({
    ...h,
    id: String(h._id),
    clientName: cMap.get(String(h.client)) || 'Unknown client',
    domainName: h.domain ? dMap.get(String(h.domain)) || '' : '',
  }))
}

// ---------------- DOMAIN ROUTER ----------------
export const domainRouter = Router()
domainRouter.use(protect, authorize(...INFRA_WRITE))

domainRouter.get('/', asyncHandler(async (req, res) => {
  const { search = '', status = '', client: clientFilter = '', page = 1, limit = 10, sortBy = 'expiresOn', order = 'asc' } = req.query
  const pageNum = clampPage(page)
  const limitNum = clampLimit(limit, 50)

  const filter = { isDeleted: { $ne: true } }
  // filter before aggregation for performance but search needs client join — do app-level for simplicity
  // Build base query with client filter only (search handled after)
  if (clientFilter && mongoose.Types.ObjectId.isValid(String(clientFilter))) {
    filter.client = new mongoose.Types.ObjectId(String(clientFilter))
  }

  const sort = {}
  const allowedSort = ['expiresOn', 'domainName', 'registrar', 'renewalCost', 'createdAt']
  const sortField = allowedSort.includes(String(sortBy)) ? String(sortBy) : 'expiresOn'
  sort[sortField] = order === 'desc' ? -1 : 1
  if (sortField !== 'expiresOn') sort.expiresOn = 1

  let all = await Domain.find(filter).sort(sort).lean()

  // Search across domainName, registrar, client company
  const term = String(search || '').trim()
  if (term) {
    const re = new RegExp(escapeRegex(term, 100), 'i')
    // Need client names map for filtering
    const clientIdsInDocs = [...new Set(all.map((d) => String(d.client)))]
    const clients = clientIdsInDocs.length ? await Client.find({ _id: { $in: clientIdsInDocs } }).select('company').lean() : []
    const cMap = new Map(clients.map((c) => [String(c._id), c.company || '']))
    all = all.filter((d) => re.test(d.domainName || '') || re.test(d.registrar || '') || re.test(cMap.get(String(d.client)) || ''))
  }

  // Status filter (requires date logic)
  const st = String(status || '').trim().toLowerCase()
  if (st && ['expiring', 'expired', 'active'].includes(st)) {
    all = all.filter((d) => statusMatches(d, st))
  }

  const total = all.length
  const totalPages = Math.max(1, Math.ceil(total / limitNum))
  const curPage = Math.min(pageNum, totalPages)
  const start = (curPage - 1) * limitNum
  const slice = all.slice(start, start + limitNum)
  const data = await enrichDomains(slice)
  res.json({ data, total, page: curPage, limit: limitNum, totalPages })
}))

domainRouter.get('/summary', asyncHandler(async (_req, res) => {
  const all = await Domain.find({ isDeleted: { $ne: true } }).lean()
  const today = todayStart()
  const windowEnd = addDays(today, WINDOW_DAYS)
  let expiringSoon = 0, expired = 0, renewalValue = 0, upcomingValue = 0
  for (const d of all) {
    const exp = d.expiresOn ? new Date(d.expiresOn) : null
    if (!exp) continue
    exp.setHours(0, 0, 0, 0)
    const cost = Number(d.renewalCost) || 0
    renewalValue += cost
    if (exp < today) { expired += 1; upcomingValue += cost }
    else if (exp <= windowEnd) { expiringSoon += 1; upcomingValue += cost }
  }
  res.json({ total: all.length, expiringSoon, expired, renewalValue, upcomingValue })
}))

domainRouter.get('/lookup', asyncHandler(async (req, res) => {
  const { client } = req.query
  const filter = { isDeleted: { $ne: true } }
  if (client && mongoose.Types.ObjectId.isValid(String(client))) filter.client = String(client)
  const rows = await Domain.find(filter).select('domainName client').sort({ domainName: 1 }).lean()
  res.json(rows.map((r) => ({ value: String(r._id), label: r.domainName, client: String(r.client), domainName: r.domainName })))
}))

domainRouter.get('/:id', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'domain')
  const doc = await Domain.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean()
  if (!doc) throw new ApiError(404, 'Domain not found')
  const [enriched] = await enrichDomains([doc])
  res.json(enriched)
}))

domainRouter.post('/', validateDomainPayload, asyncHandler(async (req, res) => {
  const { client, domainName, registrar, registeredOn, expiresOn, renewalCost, autoRenew } = req.body
  // check client exists
  const c = await Client.findById(client).lean()
  if (!c) throw new ApiError(404, 'Client not found')
  // unique name check (case-insensitive)
  const normalized = String(domainName).trim().toLowerCase()
  const exists = await Domain.findOne({ domainName: new RegExp(`^${escapeRegex(normalized)}$`, 'i'), isDeleted: { $ne: true } }).lean()
  if (exists) throw new ApiError(409, 'This domain is already registered')

  const registrarClean = registrar ? String(registrar).trim() : ''
  if (registrarClean) await ensureRegistrar(registrarClean)

  const doc = await Domain.create({
    client,
    domainName: normalized,
    registrar: registrarClean,
    registeredOn: normalizeDate(registeredOn),
    expiresOn: normalizeDate(expiresOn),
    renewalCost: renewalCost != null && String(renewalCost).trim() !== '' ? Number(renewalCost) : 0,
    autoRenew: Boolean(autoRenew),
  })
  const [enriched] = await enrichDomains([doc.toObject()])
  res.status(201).json(enriched)
}))

domainRouter.put('/:id', validateDomainPayload, asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'domain')
  const existing = await Domain.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!existing) throw new ApiError(404, 'Domain not found')
  const { client, domainName, registrar, registeredOn, expiresOn, renewalCost, autoRenew } = req.body
  const c = await Client.findById(client).lean()
  if (!c) throw new ApiError(404, 'Client not found')
  const normalized = String(domainName).trim().toLowerCase()
  const dup = await Domain.findOne({ domainName: new RegExp(`^${escapeRegex(normalized)}$`, 'i'), _id: { $ne: req.params.id }, isDeleted: { $ne: true } }).lean()
  if (dup) throw new ApiError(409, 'This domain is already registered')

  const registrarClean = registrar != null ? String(registrar).trim() : existing.registrar
  if (registrarClean && registrarClean !== existing.registrar) await ensureRegistrar(registrarClean)

  existing.client = client
  existing.domainName = normalized
  existing.registrar = registrarClean || ''
  existing.registeredOn = normalizeDate(registeredOn)
  existing.expiresOn = normalizeDate(expiresOn)
  if (renewalCost != null && String(renewalCost).trim() !== '') existing.renewalCost = Number(renewalCost)
  existing.autoRenew = Boolean(autoRenew)
  await existing.save()
  const [enriched] = await enrichDomains([existing.toObject()])
  res.json(enriched)
}))

domainRouter.patch('/:id/renew', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'domain')
  const doc = await Domain.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw new ApiError(404, 'Domain not found')
  const months = Number(req.body?.months) || 12
  const safeMonths = Math.max(1, Math.min(60, Math.floor(months)))
  const today = todayStart()
  const base = doc.expiresOn && new Date(doc.expiresOn) >= today ? new Date(doc.expiresOn) : today
  base.setHours(0, 0, 0, 0)
  const next = new Date(base)
  next.setMonth(next.getMonth() + safeMonths)
  doc.expiresOn = next
  await doc.save()
  const [enriched] = await enrichDomains([doc.toObject()])
  res.json(enriched)
}))

domainRouter.delete('/:id', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'domain')
  const doc = await Domain.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw new ApiError(404, 'Domain not found')
  // unlink hosting plans
  await HostingPlan.updateMany({ domain: doc._id, isDeleted: { $ne: true } }, { $set: { domain: null } })
  // hard delete to follow Skew conventions but support isDeleted fallback
  await Domain.deleteOne({ _id: doc._id })
  res.json({ id: String(doc._id), message: 'Domain deleted' })
}))

// ---------------- HOSTING ROUTER ----------------
export const hostingRouter = Router()
hostingRouter.use(protect, authorize(...INFRA_WRITE))

hostingRouter.get('/', asyncHandler(async (req, res) => {
  const { search = '', status = '', client: clientFilter = '', page = 1, limit = 10, sortBy = 'expiresOn', order = 'asc' } = req.query
  const pageNum = clampPage(page)
  const limitNum = clampLimit(limit, 50)
  const filter = { isDeleted: { $ne: true } }
  if (clientFilter && mongoose.Types.ObjectId.isValid(String(clientFilter))) {
    filter.client = new mongoose.Types.ObjectId(String(clientFilter))
  }
  const sort = {}
  const allowed = ['expiresOn', 'provider', 'planName', 'renewalCost', 'createdAt']
  const sf = allowed.includes(String(sortBy)) ? String(sortBy) : 'expiresOn'
  sort[sf] = order === 'desc' ? -1 : 1
  if (sf !== 'expiresOn') sort.expiresOn = 1

  let all = await HostingPlan.find(filter).sort(sort).lean()

  const term = String(search || '').trim()
  if (term) {
    const re = new RegExp(escapeRegex(term, 100), 'i')
    const clientIds = [...new Set(all.map((h) => String(h.client)))]
    const domainIds = [...new Set(all.map((h) => h.domain && String(h.domain)).filter(Boolean))]
    const [clients, domains] = await Promise.all([
      clientIds.length ? Client.find({ _id: { $in: clientIds } }).select('company').lean() : [],
      domainIds.length ? Domain.find({ _id: { $in: domainIds } }).select('domainName').lean() : [],
    ])
    const cMap = new Map(clients.map((c) => [String(c._id), c.company || '']))
    const dMap = new Map(domains.map((d) => [String(d._id), d.domainName || '']))
    all = all.filter((h) => re.test(h.provider || '') || re.test(h.planName || '') || re.test(cMap.get(String(h.client)) || '') || re.test(dMap.get(String(h.domain)) || ''))
  }

  const st = String(status || '').trim().toLowerCase()
  if (st && ['expiring', 'expired', 'active'].includes(st)) {
    all = all.filter((h) => statusMatches(h, st))
  }

  const total = all.length
  const totalPages = Math.max(1, Math.ceil(total / limitNum))
  const curPage = Math.min(pageNum, totalPages)
  const start = (curPage - 1) * limitNum
  const slice = all.slice(start, start + limitNum)
  const data = await enrichHosting(slice)
  res.json({ data, total, page: curPage, limit: limitNum, totalPages })
}))

hostingRouter.get('/summary', asyncHandler(async (_req, res) => {
  const all = await HostingPlan.find({ isDeleted: { $ne: true } }).lean()
  const today = todayStart()
  const windowEnd = addDays(today, WINDOW_DAYS)
  let expiringSoon = 0, expired = 0, renewalValue = 0, upcomingValue = 0
  for (const h of all) {
    const exp = h.expiresOn ? new Date(h.expiresOn) : null
    if (!exp) continue
    exp.setHours(0, 0, 0, 0)
    const cost = Number(h.renewalCost) || 0
    renewalValue += cost
    if (exp < today) { expired += 1; upcomingValue += cost }
    else if (exp <= windowEnd) { expiringSoon += 1; upcomingValue += cost }
  }
  res.json({ total: all.length, expiringSoon, expired, renewalValue, upcomingValue })
}))

hostingRouter.get('/:id', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'hosting')
  const doc = await HostingPlan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean()
  if (!doc) throw new ApiError(404, 'Hosting plan not found')
  const [enriched] = await enrichHosting([doc])
  res.json(enriched)
}))

hostingRouter.post('/', validateHostingPayload, asyncHandler(async (req, res) => {
  const { client, domain, provider, planName, startsOn, expiresOn, renewalCost } = req.body
  const c = await Client.findById(client).lean()
  if (!c) throw new ApiError(404, 'Client not found')
  let domainId = null
  if (domain && String(domain).trim()) {
    if (!mongoose.Types.ObjectId.isValid(String(domain))) throw new ApiError(400, 'Invalid domain id')
    const d = await Domain.findOne({ _id: domain, isDeleted: { $ne: true } }).lean()
    if (!d) throw new ApiError(404, 'Linked domain not found')
    if (String(d.client) !== String(client)) throw new ApiError(422, 'Linked domain must belong to the same client')
    domainId = d._id
  }
  const providerClean = provider ? String(provider).trim() : ''
  if (providerClean) await ensureRegistrar(providerClean)
  const doc = await HostingPlan.create({
    client,
    domain: domainId,
    provider: providerClean,
    planName: planName ? String(planName).trim() : '',
    startsOn: normalizeDate(startsOn),
    expiresOn: normalizeDate(expiresOn),
    renewalCost: renewalCost != null && String(renewalCost).trim() !== '' ? Number(renewalCost) : 0,
  })
  const [enriched] = await enrichHosting([doc.toObject()])
  res.status(201).json(enriched)
}))

hostingRouter.put('/:id', validateHostingPayload, asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'hosting')
  const existing = await HostingPlan.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!existing) throw new ApiError(404, 'Hosting plan not found')
  const { client, domain, provider, planName, startsOn, expiresOn, renewalCost } = req.body
  const c = await Client.findById(client).lean()
  if (!c) throw new ApiError(404, 'Client not found')
  let domainId = null
  if (domain && String(domain).trim()) {
    if (!mongoose.Types.ObjectId.isValid(String(domain))) throw new ApiError(400, 'Invalid domain id')
    const d = await Domain.findOne({ _id: domain, isDeleted: { $ne: true } }).lean()
    if (!d) throw new ApiError(404, 'Linked domain not found')
    if (String(d.client) !== String(client)) throw new ApiError(422, 'Linked domain must belong to the same client')
    domainId = d._id
  }
  const providerClean = provider != null ? String(provider).trim() : existing.provider
  if (providerClean && providerClean !== existing.provider) await ensureRegistrar(providerClean)
  existing.client = client
  existing.domain = domainId
  existing.provider = providerClean || ''
  existing.planName = planName ? String(planName).trim() : ''
  existing.startsOn = normalizeDate(startsOn)
  existing.expiresOn = normalizeDate(expiresOn)
  if (renewalCost != null && String(renewalCost).trim() !== '') existing.renewalCost = Number(renewalCost)
  await existing.save()
  const [enriched] = await enrichHosting([existing.toObject()])
  res.json(enriched)
}))

hostingRouter.patch('/:id/renew', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'hosting')
  const doc = await HostingPlan.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw new ApiError(404, 'Hosting plan not found')
  const months = Number(req.body?.months) || 12
  const safeMonths = Math.max(1, Math.min(60, Math.floor(months)))
  const today = todayStart()
  const base = doc.expiresOn && new Date(doc.expiresOn) >= today ? new Date(doc.expiresOn) : today
  base.setHours(0, 0, 0, 0)
  const next = new Date(base)
  next.setMonth(next.getMonth() + safeMonths)
  doc.expiresOn = next
  await doc.save()
  const [enriched] = await enrichHosting([doc.toObject()])
  res.json(enriched)
}))

hostingRouter.delete('/:id', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'hosting')
  const doc = await HostingPlan.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
  if (!doc) throw new ApiError(404, 'Hosting plan not found')
  await HostingPlan.deleteOne({ _id: doc._id })
  res.json({ id: String(doc._id), message: 'Hosting plan deleted' })
}))

// ---------------- REGISTRAR / PROVIDER ROUTER (shared) ----------------
export const registrarRouter = Router()
registrarRouter.use(protect, authorize(...INFRA_WRITE))

registrarRouter.get('/', asyncHandler(async (_req, res) => {
  await ensureDefaultRegistrars()
  const rows = await Registrar.find().sort({ name: 1 }).lean()
  // also merge any distinct registrar/provider values already stored in Domain/Hosting that are not in collection (for backwards compat)
  const domainRegs = await Domain.distinct('registrar', { isDeleted: { $ne: true }, registrar: { $ne: '' } })
  const hostingProvs = await HostingPlan.distinct('provider', { isDeleted: { $ne: true }, provider: { $ne: '' } })
  const existingNames = new Set(rows.map((r) => String(r.name).toLowerCase()))
  const extra = [...new Set([...domainRegs, ...hostingProvs].map((s) => String(s).trim()).filter(Boolean))].filter((n) => !existingNames.has(n.toLowerCase()))
  if (extra.length) {
    try {
      await Registrar.insertMany(extra.map((name) => ({ name })), { ordered: false })
      const refreshed = await Registrar.find().sort({ name: 1 }).lean()
      return res.json(refreshed)
    } catch {}
  }
  res.json(rows)
}))

registrarRouter.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) throw new ApiError(422, 'Registrar name is required')
  if (name.length > 120) throw new ApiError(422, 'Registrar name must be 120 characters or fewer')
  const exists = await Registrar.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } }).lean()
  if (exists) throw new ApiError(409, 'This registrar already exists')
  const doc = await Registrar.create({ name })
  res.status(201).json(doc)
}))

registrarRouter.put('/:id', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'registrar')
  const name = String(req.body?.name || '').trim()
  if (!name) throw new ApiError(422, 'Registrar name is required')
  if (name.length > 120) throw new ApiError(422, 'Registrar name must be 120 characters or fewer')
  const existing = await Registrar.findById(req.params.id)
  if (!existing) throw new ApiError(404, 'Registrar not found')
  const dup = await Registrar.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }, _id: { $ne: req.params.id } }).lean()
  if (dup) throw new ApiError(409, 'This registrar already exists')
  existing.name = name
  await existing.save()
  res.json(existing)
}))

registrarRouter.delete('/:id', asyncHandler(async (req, res) => {
  assertValidId(req.params.id, 'registrar')
  const doc = await Registrar.findById(req.params.id)
  if (!doc) throw new ApiError(404, 'Registrar not found')
  await Registrar.deleteOne({ _id: doc._id })
  res.json({ id: String(doc._id), message: 'Registrar deleted' })
}))
