import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
 build: {
  chunkSizeWarningLimit: 900,
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (!id.includes('node_modules')) return

        if (id.includes('recharts') || id.includes('d3-')) {
          return 'vendor-charts'
        }

        if (
          id.includes('xlsx') ||
          id.includes('jspdf') ||
          id.includes('jspdf-autotable') ||
          id.includes('html2canvas') ||
          id.includes('dompurify')
        ) {
          return 'vendor-export'
        }

        if (id.includes('framer-motion')) {
          return 'vendor-motion'
        }

        if (id.includes('react-router')) {
          return 'vendor-router'
        }

        if (
          id.includes('@reduxjs') ||
          id.includes('react-redux') ||
          id.includes('/redux/')
        ) {
          return 'vendor-redux'
        }

        if (id.includes('@tanstack') || id.includes('react-query')) {
          return 'vendor-query'
        }

        return 'vendor'
      },
    },
  },
},
  })
