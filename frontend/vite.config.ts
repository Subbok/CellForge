import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8888',
        ws: true,
      },
    },
  },
  // SPA fallback — all routes serve index.html
  appType: 'spa',
  build: {
    // Monaco is ~2.5 MB minified by itself — no point warning about something
    // we can't realistically shrink without dynamic-importing the entire
    // editor, which is the hot path of the app.
    chunkSizeWarningLimit: 3000,
    // Split heavy vendors into their own chunks. Main win is cache stability
    // (Monaco/KaTeX rarely change) and parallel download — not total size.
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) return 'monaco';
          if (id.includes('node_modules/yjs') || id.includes('node_modules/y-monaco') || id.includes('node_modules/y-protocols')) return 'yjs';
          if (id.includes('node_modules/katex')) return 'katex';
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-') || id.includes('node_modules/rehype-')) return 'markdown';
        },
      },
    },
  },
})
