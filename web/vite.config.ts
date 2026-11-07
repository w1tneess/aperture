import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    // The API runs separately in dev; same-origin in production (served by the Express server).
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
})
