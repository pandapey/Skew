import axios from 'axios'
import toast from 'react-hot-toast'
import { store } from '@/redux/store'
import { logout as logoutAction, setTokens as setTokensAction } from '@/redux/slices/authSlice'

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

// In-memory auth token holder. Per the MongoDB-only migration we no longer
// persist credentials in localStorage; the token lives for the session only.
let _token = null
let _refreshToken = null
export const setAuthToken = (token, refreshToken) => {
  _token = token
  if (refreshToken) _refreshToken = refreshToken
}
export const getAuthToken = () => _token
export const clearAuthToken = () => {
  _token = null
  _refreshToken = null
}

// Central axios instance
const apiClient = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// --- Request interceptor: attach JWT ---
apiClient.interceptors.request.use(
  (config) => {
    if (_token) config.headers.Authorization = `Bearer ${_token}`
    return config
  },
  (error) => Promise.reject(error)
)

// --- Response interceptor: refresh + global error handling + retry ---
let isRefreshing = false
let queue = []

const processQueue = (error, token = null) => {
  queue.forEach((p) => (error ? p.reject(error) : p.resolve(token)))
  queue = []
}

apiClient.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const original = error.config
    const status = error.response?.status

    // Token refresh flow.
    // Guard: with no refresh token in memory there is nothing to refresh, and
    // POSTing /auth/refresh would just return 400 ('Refresh token required')
    // on every single 401 -- the 401 -> 400 -> 401 console loop. Fail straight
    // to the login screen instead.
    if (status === 401 && !original._retry && !_refreshToken) {
      clearAuthToken()
      try { store.dispatch(logoutAction()) } catch { /* ignore */ }
      if (window.location.pathname !== '/login') window.location.href = '/login'
      return Promise.reject(error)
    }

    if (status === 401 && !original._retry) {
      original._retry = true
      if (isRefreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((token) => {
            original.headers.Authorization = `Bearer ${token}`
            return apiClient(original)
          })
      }
      isRefreshing = true
      try {
        const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken: _refreshToken })
        setAuthToken(data.token, data.refreshToken)
        // Keep Redux (and its persisted copy) in sync so a reload doesn't lose
        // the refreshed token.
        try {
          store.dispatch(setTokensAction({ token: data.token, refreshToken: data.refreshToken }))
        } catch { /* ignore */ }
        processQueue(null, data.token)
        original.headers.Authorization = `Bearer ${data.token}`
        return apiClient(original)
      } catch (err) {
        processQueue(err, null)
        clearAuthToken()
        // The session is unrecoverable: also drop the persisted Redux auth so
        // the app stops bouncing between dashboard and login, then go to login.
        try { store.dispatch(logoutAction()) } catch { /* ignore */ }
        if (window.location.pathname !== '/login') window.location.href = '/login'
        return Promise.reject(err)
      } finally {
        isRefreshing = false
      }
    }

    // Simple retry for network / 5xx (once)
    if ((!error.response || status >= 500) && !original._retriedOnce) {
      original._retriedOnce = true
      return apiClient(original)
    }

    const message = error.response?.data?.message || error.message || 'Something went wrong'
    if (status !== 401) toast.error(message)
    return Promise.reject(error)
  }
)

export default apiClient
