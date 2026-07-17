// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    proxy: {
      // This tells Vite: "If the URL starts with /api, send it to Django"
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
      // Also proxy static files if needed (images, etc)
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Chat WebSocket (school/routing.py) — the client currently connects direct to
      // :8000 like axiosInstance.ts does, but this proxy entry is kept for parity in
      // case a same-origin ws:// path is preferred later.
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      }
    }
  }
})