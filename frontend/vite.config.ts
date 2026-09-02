import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Listen on 0.0.0.0 so other machines on the LAN can reach the dev server.
    host: true,
    proxy: {
      '/api': 'http://localhost:5000',
      '/LC_': 'http://localhost:5000',
    },
  },
  // `npm run build && npm run preview` — also bind all interfaces.
  preview: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
