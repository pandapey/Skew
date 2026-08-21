// ---------------------------------------------------------------------------
// PHASE SALARY/BILLING (TASK 4) — PAYROLL CONFIGURATION.
//
// WHY THIS REUSES `Setting` RATHER THAN ADDING A MODEL:
// models/adminModels.js already defines a general-purpose, category-keyed
// configuration document:
//     Setting { category: String (unique), data: Object }
// and adminRoutes.js already exposes GET/PUT /admin/settings/:category over it.
// The payroll configuration lives on the `payroll` category of that EXISTING
// collection.
//
// Phase 7.2 (TASK 3) — OVERTIME REMOVED: the `overtimeRatePerHour` key is no
// longer read or written by this service. Any value still stored on existing
// Setting documents is simply ignored; the payroll engine pins overtime to 0.
// ---------------------------------------------------------------------------
import { Setting } from '../models/adminModels.js'

export const PAYROLL_SETTINGS_CATEGORY = 'payroll'

export const PAYROLL_SETTINGS_DEFAULTS = {}

/** Read the payroll configuration, always resolved against the defaults. */
export async function getPayrollSettings() {
  const doc = await Setting.findOne({ category: PAYROLL_SETTINGS_CATEGORY }).lean()
  const data = doc?.data || {}
  return {
    ...PAYROLL_SETTINGS_DEFAULTS,
    ...data,
  }
}

/**
 * Persist the payroll configuration. Only known keys are written, so an
 * arbitrary body cannot inject fields into the shared Setting document.
 * Phase 7.2 (TASK 3): overtimeRatePerHour is no longer a known key — a
 * client that still sends it has it silently dropped.
 */
export async function savePayrollSettings(patch = {}) {
  const current = await getPayrollSettings()
  const next = { ...current }
  await Setting.findOneAndUpdate(
    { category: PAYROLL_SETTINGS_CATEGORY },
    { $set: { data: next } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return next
}