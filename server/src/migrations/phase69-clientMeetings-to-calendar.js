// Phase 6.9 (Task 17) — ONE-TIME migration: move any legacy ClientMeeting
// documents (from the 'clientmeetings' collection, pre-Phase-6.9) onto the
// shared CalendarEvent collection.
//
//   node src/migrations/phase69-clientMeetings-to-calendar.js              # DRY RUN (default, no writes)
//   node src/migrations/phase69-clientMeetings-to-calendar.js --confirm    # actually migrate
//
// TAKE A BACKUP FIRST:  mongodump --uri "$MONGO_URI"
//
// WHY THIS EXISTS: the ClientMeeting mongoose model + schema were removed in
// Phase 6.9 (see clientModels.js) because meetings now live directly on
// CalendarEvent (clientId/projectId/meetingStatus fields - calendarModels.js).
// On a FRESH database (e.g. a fresh `npm run seed`) there is nothing to
// migrate. This script exists only for an EXISTING database that still has
// documents sitting in the old 'clientmeetings' collection from before this
// upgrade - it reads that raw collection directly (LegacyClientMeeting below
// is bound to the collection name, not to any model exported elsewhere) and
// copies each row onto CalendarEvent. It never drops or deletes
// 'clientmeetings' itself - do that manually once you've verified the
// migration, if you want it gone.
//
// IDEMPOTENT: every migrated CalendarEvent gets a `[migratedFrom:<legacyId>]`
// tag appended to its description. Re-running the script skips any legacy row
// that already has a matching CalendarEvent, so running it twice (or after a
// partial --confirm run) never creates duplicates.

import mongoose from 'mongoose'
import dotenv from 'dotenv'

import { CalendarEvent } from '../models/calendarModels.js'

dotenv.config()

const CONFIRM = process.argv.includes('--confirm')
const say = (msg) => console.log(msg)

// Bound directly to the raw collection name. The old clientMeetingSchema
// lived in clientModels.js and was deleted there in Phase 6.9 - redeclaring a
// minimal, permissive schema here (strict: false) is intentional so this
// script keeps working even if the legacy shape has drifted, and so it never
// re-creates a maintained model elsewhere in the app.
const legacyClientMeetingSchema = new mongoose.Schema({}, { strict: false, collection: 'clientmeetings' })
const LegacyClientMeeting = mongoose.models.LegacyClientMeeting
  || mongoose.model('LegacyClientMeeting', legacyClientMeetingSchema)

function mapStatus(oldStatus) {
  if (oldStatus === 'cancelled') return 'Cancelled'
  // 'upcoming' and 'past' were both already-confirmed meetings under the old
  // model (there was no request/approval step) - treat both as Approved.
  return 'Approved'
}

function toDate(dateStr, timeStr) {
  const base = dateStr ? new Date(dateStr) : new Date()
  const [h, m] = String(timeStr || '00:00').split(':').map((n) => Number(n) || 0)
  base.setHours(h, m, 0, 0)
  return base
}

async function migrate() {
  const legacyRows = await LegacyClientMeeting.find({}).lean()
  say(`Found ${legacyRows.length} legacy document(s) in 'clientmeetings'.`)
  if (!legacyRows.length) return { migrated: 0, skipped: 0 }

  let migrated = 0
  let skipped = 0
  for (const row of legacyRows) {
    const tag = `[migratedFrom:${row._id}]`
    // eslint-disable-next-line no-await-in-loop
    const already = await CalendarEvent.findOne({ description: { $regex: tag.replace(/[[\]]/g, '\\$&') } }).lean()
    if (already) {
      skipped += 1
      say(`      SKIP      ${row._id}  (already migrated -> ${already._id})`)
      continue
    }

    const start = toDate(row.date, row.time)
    const doc = {
      title: row.title || 'Client meeting',
      type: 'meeting',
      start,
      end: new Date(start.getTime() + 60 * 60 * 1000),
      allDay: false,
      location: row.link || '',
      description: `${[row.agenda, row.notes].filter(Boolean).join(' \u2014 ')} ${tag}`.trim(),
      clientId: row.clientId || null,
      projectId: null,
      meetingStatus: mapStatus(row.status),
    }
    if (CONFIRM) {
      // eslint-disable-next-line no-await-in-loop
      await CalendarEvent.create(doc)
    }
    migrated += 1
    say(`      ${CONFIRM ? 'MIGRATED' : 'WOULD MIGRATE'}  ${row._id}  "${doc.title}"  ${doc.meetingStatus}`)
  }
  return { migrated, skipped }
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    console.error('MONGO_URI is not set. Aborting without changes.')
    process.exit(1)
  }
  await mongoose.connect(uri)
  say(`Connected. Mode: ${CONFIRM ? 'APPLY (writes CalendarEvent docs)' : 'DRY RUN (no writes)'}`)
  if (!CONFIRM) say('Re-run with --confirm to actually migrate. Take a mongodump first.')

  const { migrated, skipped } = await migrate()

  say(`\n${migrated} document(s) ${CONFIRM ? 'migrated' : 'would be migrated'}.`)
  say(`${skipped} document(s) skipped (already migrated).`)
  say("\nThe old 'clientmeetings' collection is left untouched by this script.")
  say('Once you have verified the migrated CalendarEvent rows, drop it manually if desired:')
  say('  mongosh "$MONGO_URI" --eval "db.clientmeetings.drop()"')

  await mongoose.disconnect()
  say(`\nDone. ${CONFIRM ? 'Changes applied.' : 'No changes were made (dry run).'}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
