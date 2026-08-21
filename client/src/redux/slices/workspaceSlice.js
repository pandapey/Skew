import { createSlice } from '@reduxjs/toolkit'

const DEFAULT_WIDGET_ORDER = [
  'checkin', 'leave-balance', 'today-tasks', 'today-meetings',
  'pending-approvals', 'upcoming-holidays', 'my-projects',
  'team-availability', 'recent-activity', 'frequent-pages', 'continue-last',
  'org-kpis', 'revenue-chart', 'attendance-chart',
]

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState: {
    dashboardLayout: {
      order: DEFAULT_WIDGET_ORDER,
      hidden: [],
      pinned: [],
    },
    recentPages: [], // [{ path, label, ts }], most recent first, capped
    pageVisitCounts: {}, // { [path]: { count, label } }
    quickNotes: [], // [{ id, text, ts }]
    bookmarks: { pages: [], projects: [], files: [] },
    pinnedTaskIds: [],
    favoriteProjectIds: [],
    focusMode: false,
    timeLog: {}, // { [taskId]: { [dateISO]: seconds } }
    activeTimer: null, // { taskId, startedAt } | null
  },
  reducers: {
    setDashboardLayout: (state, action) => {
      state.dashboardLayout = action.payload
    },
    reorderWidget: (state, action) => {
      const { id, direction } = action.payload
      const order = state.dashboardLayout.order
      const idx = order.indexOf(id)
      if (idx === -1) return
      const swapWith = direction === 'up' ? idx - 1 : idx + 1
      if (swapWith < 0 || swapWith >= order.length) return
      ;[order[idx], order[swapWith]] = [order[swapWith], order[idx]]
    },
    setWidgetHidden: (state, action) => {
      const { id, hidden } = action.payload
      const set = new Set(state.dashboardLayout.hidden)
      hidden ? set.add(id) : set.delete(id)
      state.dashboardLayout.hidden = Array.from(set)
    },
    toggleWidgetPin: (state, action) => {
      const id = action.payload
      const set = new Set(state.dashboardLayout.pinned)
      set.has(id) ? set.delete(id) : set.add(id)
      state.dashboardLayout.pinned = Array.from(set)
    },
    resetDashboardLayout: (state) => {
      state.dashboardLayout = { order: DEFAULT_WIDGET_ORDER, hidden: [], pinned: [] }
    },
    ensureWidgetIds: (state, action) => {
      const known = new Set(state.dashboardLayout.order)
      for (const id of action.payload) {
        if (!known.has(id)) state.dashboardLayout.order.push(id)
      }
    },

    trackPageVisit: (state, action) => {
      const { path, label } = action.payload
      const entry = state.pageVisitCounts[path] || { count: 0, label }
      entry.count += 1
      entry.label = label
      state.pageVisitCounts[path] = entry

      state.recentPages = [
        { path, label, ts: action.payload.ts },
        ...state.recentPages.filter((p) => p.path !== path),
      ].slice(0, 20)
    },

    addNote: (state, action) => {
      state.quickNotes.unshift({ id: action.payload.id, text: action.payload.text, ts: action.payload.ts })
    },
    updateNote: (state, action) => {
      const note = state.quickNotes.find((n) => n.id === action.payload.id)
      if (note) note.text = action.payload.text
    },
    removeNote: (state, action) => {
      state.quickNotes = state.quickNotes.filter((n) => n.id !== action.payload)
    },

    toggleBookmark: (state, action) => {
      const { kind, id } = action.payload // kind: 'pages' | 'projects' | 'files'
      const list = state.bookmarks[kind] || []
      state.bookmarks[kind] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    },

    togglePinnedTask: (state, action) => {
      const id = action.payload
      state.pinnedTaskIds = state.pinnedTaskIds.includes(id)
        ? state.pinnedTaskIds.filter((x) => x !== id)
        : [...state.pinnedTaskIds, id]
    },
    toggleFavoriteProject: (state, action) => {
      const id = action.payload
      state.favoriteProjectIds = state.favoriteProjectIds.includes(id)
        ? state.favoriteProjectIds.filter((x) => x !== id)
        : [...state.favoriteProjectIds, id]
    },

    setFocusMode: (state, action) => {
      state.focusMode = action.payload
    },

    startTimer: (state, action) => {
      state.activeTimer = { taskId: action.payload.taskId, startedAt: action.payload.startedAt }
    },
    stopTimer: (state, action) => {
      const { taskId, dateISO, seconds } = action.payload
      if (!state.timeLog[taskId]) state.timeLog[taskId] = {}
      state.timeLog[taskId][dateISO] = (state.timeLog[taskId][dateISO] || 0) + seconds
      state.activeTimer = null
    },
  },
})

export const {
  setDashboardLayout, reorderWidget, setWidgetHidden, toggleWidgetPin, resetDashboardLayout, ensureWidgetIds,
  trackPageVisit, addNote, updateNote, removeNote, toggleBookmark, togglePinnedTask, toggleFavoriteProject,
  setFocusMode, startTimer, stopTimer,
} = workspaceSlice.actions

export default workspaceSlice.reducer
