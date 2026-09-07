import { ApiError } from '../utils/asyncHandler.js'
import mongoose from 'mongoose'

const isValidObjectId = (v) => mongoose.Types.ObjectId.isValid(String(v))

export const validateDomainPayload = (req, _res, next) => {
  const b = req.body || {}
  const errors = []

  const domainName = String(b.domainName || '').trim()
  if (!domainName) errors.push('Domain name is required')
  else if (domainName.indexOf('.') < 1 || domainName.indexOf(' ') >= 0)
    errors.push('Enter a valid domain such as example.com')
  else if (domainName.length > 256) errors.push('Domain name must be 256 characters or fewer')

  if (!b.client || !isValidObjectId(b.client)) errors.push('Client is required')

  if (b.registrar != null && String(b.registrar).length > 120)
    errors.push('Registrar must be 120 characters or fewer')

  if (!b.expiresOn) errors.push('Expiry date is required')
  else if (isNaN(new Date(b.expiresOn))) errors.push('Expiry date must be a valid date')

  if (b.registeredOn != null && String(b.registeredOn).trim() !== '') {
    if (isNaN(new Date(b.registeredOn))) errors.push('Registered date must be a valid date')
    else if (b.expiresOn && !isNaN(new Date(b.expiresOn))) {
      const reg = new Date(b.registeredOn)
      const exp = new Date(b.expiresOn)
      if (reg > exp) errors.push('Registration date cannot be after the expiry date')
    }
  }

  if (errors.length) return next(new ApiError(422, `Validation failed: ${errors.join(', ')}`))
  next()
}

export const validateHostingPayload = (req, _res, next) => {
  const b = req.body || {}
  const errors = []

  if (!b.client || !isValidObjectId(b.client)) errors.push('Client is required')

  if (b.domain != null && String(b.domain).trim() !== '' && !isValidObjectId(b.domain))
    errors.push('Linked domain must be a valid id')

  if (!b.expiresOn) errors.push('Expiry date is required')
  else if (isNaN(new Date(b.expiresOn))) errors.push('Expiry date must be a valid date')

  if (b.startsOn != null && String(b.startsOn).trim() !== '') {
    if (isNaN(new Date(b.startsOn))) errors.push('Start date must be a valid date')
    else if (b.expiresOn && !isNaN(new Date(b.expiresOn))) {
      const st = new Date(b.startsOn)
      const ex = new Date(b.expiresOn)
      if (st > ex) errors.push('Start date cannot be after the expiry date')
    }
  }

  if (b.provider != null && String(b.provider).length > 120)
    errors.push('Provider must be 120 characters or fewer')
  if (b.planName != null && String(b.planName).length > 120)
    errors.push('Plan name must be 120 characters or fewer')

  if (errors.length) return next(new ApiError(422, `Validation failed: ${errors.join(', ')}`))
  next()
}
