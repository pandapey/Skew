import { createSlice } from '@reduxjs/toolkit'

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    theme: 'light',
    sidebarOpen: true,
    sidebarCollapsed: false,
  },
  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === 'light' ? 'dark' : 'light'
    },
    setTheme: (state, action) => {
      state.theme = action.payload
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen
    },
    setSidebarOpen: (state, action) => {
      state.sidebarOpen = action.payload
    },
    toggleCollapse: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed
    },
  },
})

export const { toggleTheme, setTheme, toggleSidebar, setSidebarOpen, toggleCollapse } = uiSlice.actions
export default uiSlice.reducer
