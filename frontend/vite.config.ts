import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'vite'

// A second local backend can be selected without changing production URLs or .env files.
const apiProxyTarget = process.env.LEARNHUB_API_PROXY_TARGET || 'http://localhost:8000'

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
  build: { target: 'es2022' },
  server: {
    // Invitation emails are often opened on a phone during local testing. Bind to
    // the LAN interface so a configured FRONTEND_URL can reach this dev server.
    host: '0.0.0.0',
    port: 5173,
    // Same-origin in dev: session cookies + CSRF work without CORS tricks.
    proxy: {
      '/api': apiProxyTarget,
      '/_allauth': apiProxyTarget,
    },
  },
}))
