import dayjs from 'dayjs'

export function groupMyTasks(tasks = []) {
  const today = dayjs().startOf('day')

  const isBlocked = (t) =>
    (t.labels || []).some((l) => String(l).toLowerCase() === 'blocked') || t.severity === 'Blocker'
  const due = (t) => (t.dueDate ? dayjs(t.dueDate) : null)
  const notDone = (t) => t.status !== 'Done'

  const blocked = tasks.filter((t) => notDone(t) && isBlocked(t))
  const waitingForReview = tasks.filter((t) => t.status === 'Review' && !isBlocked(t))
  const overdue = tasks.filter((t) => {
    const d = due(t)
    return notDone(t) && !isBlocked(t) && t.status !== 'Review' && d && d.isBefore(today, 'day')
  })
  const todayTasks = tasks.filter((t) => {
    const d = due(t)
    return notDone(t) && !isBlocked(t) && t.status !== 'Review' && d && d.isSame(today, 'day')
  })
  const upcoming = tasks.filter((t) => {
    const d = due(t)
    return (
      notDone(t) && !isBlocked(t) && t.status !== 'Review' &&
      d && d.isAfter(today, 'day') && d.isBefore(today.add(8, 'day'))
    )
  })
  const completedToday = tasks.filter((t) => {
    const updated = t.updatedAt ? dayjs(t.updatedAt) : null
    return t.status === 'Done' && updated && updated.isSame(today, 'day')
  })

  return { today: todayTasks, overdue, upcoming, waitingForReview, blocked, completedToday }
}
