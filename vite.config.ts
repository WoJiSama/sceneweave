import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: {
    'react-vendor': ['react', 'react-dom', 'zustand'],
    'canvas-vendor': ['konva', 'react-konva'],
    'document-vendor': ['zod', 'dexie', 'fflate'],
  } } } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
