import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

// A phone can keep the previous HTML open while Vite replaces hashed lazy-page
// chunks after a deploy. Recover once instead of leaving every non-home route blank.
// The short guard prevents a reload loop when the problem is genuinely offline.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'learnhub:last-chunk-reload'
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem(key, String(Date.now()))
  } catch {
    // Private browsing can block storage; a single normal reload is still useful.
  }
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
