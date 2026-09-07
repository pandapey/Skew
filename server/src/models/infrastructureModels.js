import mongoose from 'mongoose'

const { Schema, model } = mongoose

const opts = { timestamps: true }

const domainSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    domainName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 256,
      // unique handled via application check to allow soft-deleted duplicates
    },
    registrar: { type: String, default: '', maxlength: 120, trim: true },
    registeredOn: { type: Date, default: null },
    expiresOn: { type: Date, required: true },
    renewalCost: { type: Number, default: 0, min: 0 },
    autoRenew: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  opts
)

domainSchema.index({ domainName: 1 })
domainSchema.index({ expiresOn: 1 })
domainSchema.index({ client: 1, domainName: 1 })

domainSchema.pre('save', function (next) {
  if (this.domainName) this.domainName = String(this.domainName).trim().toLowerCase()
  if (this.registrar) this.registrar = String(this.registrar).trim()
  next()
})

const hostingSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    domain: { type: Schema.Types.ObjectId, ref: 'Domain', default: null, index: true },
    provider: { type: String, default: '', maxlength: 120, trim: true },
    planName: { type: String, default: '', maxlength: 120, trim: true },
    startsOn: { type: Date, default: null },
    expiresOn: { type: Date, required: true },
    renewalCost: { type: Number, default: 0, min: 0 },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  opts
)

hostingSchema.index({ expiresOn: 1 })

export const Domain = model('Domain', domainSchema)
export const HostingPlan = model('HostingPlan', hostingSchema)
