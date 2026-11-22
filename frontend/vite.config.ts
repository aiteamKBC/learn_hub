import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // `npm run build -- --mode analyze` writes dist/stats.html (what is in each chunk)
    mode === 'analyze' && visualizer({ filename: 'dist/stats.html', gzipSize: true }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Keep lazy route chunks compatible with mobile Safari/Chromium versions that
  // are still common on phones. This does not change desktop layout or behaviour.
  build: { target: 'es2020' },
  server: {
    // Invitation emails are often opened on a phone during local testing. Bind to
    // the LAN interface so a configured FRONTEND_URL can reach this dev server.
    host: '0.0.0.0',
    port: 5173,
    // Same-origin in dev: session cookies + CSRF work without CORS tricks.
    proxy: {
      '/api': 'http://localhost:8000',
      '/_allauth': 'http://localhost:8000',
    },
  },
}))
