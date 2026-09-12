import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Self-signed HTTPS for `vite dev`/`vite preview` only (never for
    // `vite build` or Vitest). Browser APIs that require a secure context
    // — getUserMedia/RTCPeerConnection for voice mode chief among them —
    // are unavailable on a plain-HTTP LAN address, so testing voice mode
    // from a phone needs this even in dev. The browser will show a
    // one-time "connection not private" warning to click through (a
    // self-signed cert, not a real one) — that's expected.
    ...(command === 'serve' ? [basicSsl()] : []),
  ],
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
}))
