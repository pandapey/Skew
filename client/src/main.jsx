import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { store, persistor } from '@/redux/store'
import { setAuthToken } from '@/api/client'
import { FullPageLoader } from '@/components/ui'
import App from './App'
import '@/styles/index.css'

// Redux (incl. the JWT) is persisted to localStorage, but the axios client keeps
// the token only in memory. After rehydration we must copy the restored token
// back into axios, otherwise every request goes out unauthenticated (401) and
// the app loops between the dashboard and the login page on reload.
// NOTE: `persistStore()` runs at module-load time inside `@/redux/store`, so
// rehydration can finish BEFORE this module gets a chance to subscribe. In that
// case the subscribe callback never fires for the bootstrap transition, the
// token is never copied into axios, and every request goes out unauthenticated
// (401) -> the interceptor then POSTs /auth/refresh with a null refreshToken
// (400) and the app loops. So we restore from all three angles: immediately,
// on any later persistor change, and once more right before PersistGate lifts.
let tokenRestored = false
const restoreToken = () => {
  if (tokenRestored) return
  if (!persistor.getState().bootstrapped) return
  tokenRestored = true
  const { token, refreshToken } = store.getState().auth
  if (token) setAuthToken(token, refreshToken)
}

// 1) Already rehydrated before this line ran (the race described above).
restoreToken()
// 2) Rehydration completes later.
persistor.subscribe(restoreToken)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      {/* 3) Final guarantee: the token is in axios before any component mounts
          and fires its first query. */}
      <PersistGate loading={<FullPageLoader />} persistor={persistor} onBeforeLift={restoreToken}>
        <App />
      </PersistGate>
    </Provider>
  </StrictMode>
)
