import axios from 'axios'
import toast from 'react-hot-toast'
import { store } from '@/redux/store'
import { logout as logoutAction, setTokens as setTokensAction } from '@/redux/slices/authSlice'

const baseURL = import.meta.env.VITE_API_BASE_URL || 'https://skew-server-317n.onrender.com/api'

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

const apiClient = axios.create({
  baseURL,
  timeout: 15000,
})

apiClient.interceptors.request.use(
  (config) => {
    if (_token) config.headers.Authorization = `Bearer ${_token}`
    return config
  },
  (error) => Promise.reject(error)
)

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

    if (status === 401 && !original._retry && !_refreshToken) {
      clearAuthToken()
      try { store.dispatch(logoutAction()) } catch {  }
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

        try {
          store.dispatch(setTokensAction({ token: data.token, refreshToken: data.refreshToken }))
        } catch {  }
        processQueue(null, data.token)
        original.headers.Authorization = `Bearer ${data.token}`
        return apiClient(original)
      } catch (err) {
        processQueue(err, null)
        clearAuthToken()

        try { store.dispatch(logoutAction()) } catch {  }
        if (window.location.pathname !== '/login') window.location.href = '/login'
        return Promise.reject(err)
      } finally {
        isRefreshing = false
      }
    }

    if ((!error.response || status >= 500) && !original._retriedOnce) {
      // Never auto-retry file uploads: FormData streams are consumed on
      // the first attempt and Drive/S3 uploads are not idempotent.
      // Retrying turns one timeout into "No image uploaded" + double toasts.
      const isUpload =
        original?.skipRetry ||
        (typeof FormData !== 'undefined' && original?.data instanceof FormData)
      if (!isUpload) {
        original._retriedOnce = true
        return apiClient(original)
      }
    }

    const message = error.response?.data?.message || error.message || 'Something went wrong'

    if (status !== 401 && !original.skipErrorToast) toast.error(message)
    return Promise.reject(error)
  }
)

export default apiClient
