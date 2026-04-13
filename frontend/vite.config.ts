import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8888',
        ws: true,
      },
    },
  },
  // SPA fallback — all routes serve index.html
  appType: 'spa',
})
