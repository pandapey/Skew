import { createSlice } from '@reduxjs/toolkit'
import { setAuthToken, clearAuthToken } from '@/api/client'
import { resetSocket } from '@/api/socket'

const initialState = {
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action) => {
      const { user, token, refreshToken } = action.payload
      state.user = user
      state.token = token
      state.refreshToken = refreshToken
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
      state.isAuthenticated = false
      clearAuthToken()
      resetSocket()
    },
  },
})

export const { setCredentials, updateUser, setTokens, logout } = authSlice.actions
export default authSlice.reducer
