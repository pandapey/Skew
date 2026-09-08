import { ApiError } from '../utils/asyncHandler.js'
import { DomainPlan } from '../models/clientModels.js'

const trimmed = (v) => String(v ?? '').trim()

async function assertNameAvailable(name, excludeId) {
  const filter = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
  if (excludeId) filter._id = { $ne: excludeId }
  const clash = await DomainPlan.findOne(filter).lean()
  if (clash) {
    throw new ApiError(409, `A domain plan named "${clash.name}" already exists. Plan names must be unique.`)
  }
}

export const validateDomainPlan = async (req, _res, next) => {
  try {
    const body = req.body || {}
    const name = trimmed(body.name)

    const isUpdate = Boolean(req.params?.id)
    if (!isUpdate || body.name !== undefined) {
      if (name.length < 2) {
        throw new ApiError(422, 'Validation failed: plan name is required (at least 2 characters)')
      }
      await assertNameAvailable(name, req.params?.id)

      req.body.name = name
    }

    if (body.price !== undefined && body.price !== '' && body.price !== null) {
      const price = Number(body.price)
      if (!Number.isFinite(price) || price < 0) {
        throw new ApiError(422, 'Validation failed: price must be a non-negative number')
      }
      req.body.price = price
    }

    if (body.status !== undefined && !['Active', 'Inactive'].includes(body.status)) {
      throw new ApiError(422, "Validation failed: status must be 'Active' or 'Inactive'")
    }

    next()
  } catch (err) {
    next(err)
  }
}

export default validateDomainPlan
