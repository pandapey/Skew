import { useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  reorderWidget, setWidgetHidden, toggleWidgetPin, resetDashboardLayout, ensureWidgetIds,
  addNote, updateNote, removeNote, toggleBookmark, togglePinnedTask, toggleFavoriteProject,
  setFocusMode, startTimer, stopTimer,
} from '@/redux/slices/workspaceSlice'

// Public API for employee personalization (dashboard layout, notes,
// bookmarks, favorites, pins, focus mode, work timer).
// Phase 6.2 (Task 8): `recentPages` / `pageVisitCounts` / `trackVisit` removed -
// their only consumers were the deleted Frequently-Visited / Continue-Last cards.
//
// This is the ONLY module Dashboard/My-Work components should import for
// personalization state — never `workspaceSlice` or `useSelector(s => s.workspace)`
// directly. Today this is backed by redux-persist (localStorage); a future
// phase can swap the internals for a server-synced store (e.g. TanStack Query
// against `GET/PUT /api/workspace/me`) without changing any consumer, because
// every consumer only ever sees this hook's return shape.
export function useWorkspace() {
  const dispatch = useDispatch()
  const state = useSelector((s) => s.workspace)

  const reorderWidgetAction = useCallback((id, direction) => dispatch(reorderWidget({ id, direction })), [dispatch])
  const setWidgetHiddenAction = useCallback((id, hidden) => dispatch(setWidgetHidden({ id, hidden })), [dispatch])
  const pinWidget = useCallback((id) => dispatch(toggleWidgetPin(id)), [dispatch])
  const resetLayout = useCallback(() => dispatch(resetDashboardLayout()), [dispatch])
  const registerWidgetIds = useCallback((ids) => dispatch(ensureWidgetIds(ids)), [dispatch])

  const addNoteAction = useCallback(
    (text) => dispatch(addNote({ id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, ts: Date.now() })),
    [dispatch]
  )
  const updateNoteAction = useCallback((id, text) => dispatch(updateNote({ id, text })), [dispatch])
  const removeNoteAction = useCallback((id) => dispatch(removeNote(id)), [dispatch])

  const toggleBookmarkAction = useCallback((kind, id) => dispatch(toggleBookmark({ kind, id })), [dispatch])
  const togglePinnedTaskAction = useCallback((id) => dispatch(togglePinnedTask(id)), [dispatch])
  const toggleFavoriteProjectAction = useCallback((id) => dispatch(toggleFavoriteProject(id)), [dispatch])

  const setFocusModeAction = useCallback((on) => dispatch(setFocusMode(on)), [dispatch])

  const startTimerAction = useCallback((taskId) => dispatch(startTimer({ taskId, startedAt: Date.now() })), [dispatch])
  const stopTimerAction = useCallback(() => {
    if (!state.activeTimer) return
    const { taskId, startedAt } = state.activeTimer
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    const dateISO = new Date().toISOString().slice(0, 10)
    dispatch(stopTimer({ taskId, dateISO, seconds }))
  }, [dispatch, state.activeTimer])

  return {
    layout: state.dashboardLayout,
    notes: state.quickNotes,
    bookmarks: state.bookmarks,
    pinnedTaskIds: state.pinnedTaskIds,
    favoriteProjectIds: state.favoriteProjectIds,
    focusMode: state.focusMode,
    timeLog: state.timeLog,
    activeTimer: state.activeTimer,

    actions: {
      reorderWidget: reorderWidgetAction,
      setWidgetHidden: setWidgetHiddenAction,
      pinWidget,
      resetLayout,
      registerWidgetIds,
      addNote: addNoteAction,
      updateNote: updateNoteAction,
      removeNote: removeNoteAction,
      toggleBookmark: toggleBookmarkAction,
      togglePinnedTask: togglePinnedTaskAction,
      toggleFavoriteProject: toggleFavoriteProjectAction,
      setFocusMode: setFocusModeAction,
      startTimer: startTimerAction,
      stopTimer: stopTimerAction,
    },
  }
}

// Pure helper (no hook) so non-component code (e.g. selectors) can compute
// today's total tracked seconds for a given timeLog without re-deriving the
// date format logic everywhere.
export function todaysTrackedSeconds(timeLog) {
  const todayISO = new Date().toISOString().slice(0, 10)
  return Object.values(timeLog || {}).reduce((sum, byDate) => sum + (byDate[todayISO] || 0), 0)
}
