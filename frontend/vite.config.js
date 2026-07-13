import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: 5033,
    proxy: {
      '/api': {
        target: 'http://localhost:5022',
        changeOrigin: true,
        secure: false
      },
      '/uploads': {
        target: 'http://localhost:5022',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
