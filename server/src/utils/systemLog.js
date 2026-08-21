// PHASE ADMIN ATTENDANCE (TASK 4) — the missing SystemLog PRODUCER.
//
// INVESTIGATION (Admin -> Admin Panel -> System Log):
//   route      client/src/routes/index.jsx  -> '/admin/system-logs'
//   component  client/src/pages/admin/SystemLogs.jsx
//   service    client/src/api/adminApi.js   -> adminApi.systemLogs.query()
//   endpoint   GET /api/admin/system-logs   (routes/adminRoutes.js, Admin-only)
//   model      SystemLog { level, source, message, at }  (models/adminModels.js)
//
// Every one of those layers existed and worked. The page was empty for one
// reason: NOTHING IN THE CODEBASE EVER CREATED A SystemLog DOCUMENT. `grep -rn
// SystemLog server/src` returns the model, the read route, the analytics
// aggregation and the cleanup migration - and no `.create(...)` anywhere. The
// seed does not seed it either. So the collection was permanently empty and the
// page permanently blank.
//
// DECISION — the page is FIXED, not removed. System Log is NOT a duplicate of
// Audit Log and is not a placeholder:
//   * Audit Log answers "which USER performed which BUSINESS action?"
//     (user / actor / action / module / severity).
//   * System Log answers "what did the APPLICATION do?"
//     (level / source / message) - technical runtime events with no actor.
//   * Two other live Admin features already read this collection and were
//     therefore also reporting zero: the "Log Volume" chart on Admin -> Analytics
//     (GET /admin/analytics -> SystemLog.aggregate) and the "System Errors" tile
//     on the Admin hub (GET /admin/stats -> SystemLog.countDocuments({ level:
//     'ERROR' })). Deleting the model would have broken both.
//
// This module is that missing producer. It records REAL runtime events only -
// API failures that actually occurred, database connection transitions that
// actually happened, and process start/stop. Nothing is seeded, sampled or
// fabricated to make the page look populated.

import { SystemLog } from '../models/adminModels.js'

// The sources this application actually emits. Exported so the level/source
// filter options and the writers cannot drift apart.
export const SYSTEM_LOG_SOURCES = Object.freeze({
  API: 'api-gateway',
  AUTH: 'auth-service',
  DB: 'db-connector',
  CRON: 'cron-scheduler',
})

// Longest message we will persist. A Mongoose validation error or a stack-laden
// message can be very long; truncating keeps one bad request from writing a
// megabyte-sized document.
const MAX_MESSAGE = 2000

// Append one system log line.
//
// Deliberately fire-and-forget and fully swallowed: observability must never
// break, delay or fail the operation being observed - the same policy the
// existing audit helper (utils/password.js) uses. In particular, the database
// being unreachable is itself something we try to log, and that write will fail;
// it must fail silently rather than throw inside an error handler.
export function systemLog(level, message, source = SYSTEM_LOG_SOURCES.API) {
  if (!message) return
  SystemLog.create({
    level,
    source,
    message: String(message).slice(0, MAX_MESSAGE),
    at: new Date(),
  }).catch(() => {})
}
