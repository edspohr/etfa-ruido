import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'lucide-react',
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/storage',
    ],
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/storage',
          ],
          'vendor-lucide': ['lucide-react'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['pdfjs-dist', 'jspdf', 'jspdf-autotable'],
          'vendor-xlsx': ['xlsx'],
          'vendor-motion': ['framer-motion'],
          'vendor-dnd': ['@hello-pangea/dnd'],
        },
      },
    },
  },
})
