// Shared task-timer math for the employee timer UI. Mirrors the server-side
// helpers in server/src/services/projectService.js (pausedSeconds/activeSeconds)
// so the running display and the recorded duration can never disagree: active
// time = wall time since startedAt minus every paused span.
export function pausedSeconds(task, now = Date.now()) {
  let total = 0
  const start = task?.startedAt ? new Date(task.startedAt).getTime() : 0
  for (const iv of task?.pauseIntervals || []) {
    const from = Math.max(new Date(iv.from).getTime(), start)
    const to = iv.to ? new Date(iv.to).getTime() : null
    if (to != null) {
      if (to > from) total += to - from
    } else if (task?.pausedAt) {
      const openEnd = Math.min(new Date(now).getTime(), Date.now())
      if (openEnd > from) total += openEnd - from
    }
  }
  return total
}

// Active working seconds at `now` (live while running, frozen after submit).
export function activeSeconds(task, now = Date.now()) {
  if (!task?.startedAt) return 0
  const start = new Date(task.startedAt).getTime()
  const end = task.completedAt ? new Date(task.completedAt).getTime() : Math.max(new Date(now).getTime(), start)
  return Math.max(0, Math.round((end - start) / 1000) - Math.round(pausedSeconds(task, now) / 1000))
}

export function isTaskRunning(task) {
  return Boolean(task?.startedAt) && !task?.completedAt && !task?.pausedAt
}

export function isTaskPaused(task) {
  return Boolean(task?.startedAt) && !task?.completedAt && Boolean(task?.pausedAt)
}