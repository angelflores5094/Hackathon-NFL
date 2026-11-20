import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' para que el build funcione desde cualquier ruta (subpath de AWS)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
