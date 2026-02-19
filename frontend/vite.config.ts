// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // This tells Vite: "If the URL starts with /api, send it to Django"
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      // Also proxy static files if needed (images, etc)
      '/static': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  }
})