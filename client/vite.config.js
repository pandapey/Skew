import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'scheduler'],
          'vendor-router': ['react-router-dom', '@remix-run/router'],
          'vendor-redux': ['@reduxjs/toolkit', 'react-redux', 'redux-persist'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-motion': ['framer-motion'],
          'vendor-charts': ['recharts'],
          'vendor-export': ['xlsx', 'jspdf', 'jspdf-autotable', 'html2canvas', 'dompurify'],
          'vendor-ui': ['react-icons', 'clsx', 'tailwind-merge', 'react-hot-toast', 'react-dropzone', 'react-hook-form', '@hookform/resolvers', 'zod', 'dayjs', 'mammoth', 'socket.io-client'],
        },
      },
    },
  },
})
