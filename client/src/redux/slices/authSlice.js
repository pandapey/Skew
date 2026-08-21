import { createSlice } from '@reduxjs/toolkit'
import { setAuthToken, clearAuthToken } from '@/api/client'
import { resetSocket } from '@/api/socket'

const initialState = {
  user: null,
  token: null,
  refreshToken: null,
  // Id of the Activity session the server opened for THIS login (returned by
  // POST /auth/login). Sent back on logout so only this browser's session is
  // closed - never another device's open session.
  sessionId: null,
  isAuthenticated: false,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action) => {
      const { user, token, refreshToken, sessionId } = action.payload
      state.user = user
      state.token = token
      state.refreshToken = refreshToken
      state.sessionId = sessionId || null
      state.isAuthenticated = true
      setAuthToken(token, refreshToken)
    },
    updateUser: (state, action) => {
      state.user = { ...state.user, ...action.payload }
    },
    // Replace the access token after a successful silent refresh, keeping the
    // user and (optionally) the refresh token intact.
    setTokens: (state, action) => {
      const { token, refreshToken } = action.payload
      state.token = token
      if (refreshToken) state.refreshToken = refreshToken
      setAuthToken(token, refreshToken)
    },
    logout: (state) => {
      state.user = null
      state.token = null
      state.refreshToken = null
      state.sessionId = null
      state.isAuthenticated = false
      clearAuthToken()
      resetSocket()
    },
  },
})

export const { setCredentials, updateUser, setTokens, logout } = authSlice.actions
export default authSlice.reducer
