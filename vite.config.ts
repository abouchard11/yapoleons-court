import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isVitest = process.env.VITEST === 'true'

export default defineConfig({
  plugins: isVitest ? [] : [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
