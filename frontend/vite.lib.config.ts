import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/components/chatbot/index.ts'),
      name: 'BibleChatWidget',
      fileName: 'chatbot-widget',
      formats: ['umd'],
    },
    outDir: '../static',
    emptyOutDir: false,
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
        entryFileNames: 'chatbot-widget.umd.js',
      },
    },
  },
})
