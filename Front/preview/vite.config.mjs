import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({ root: here, plugins: [react()],
  server: { host: '127.0.0.1', port: 3617, strictPort: true, proxy: {
    '/api': { target: `http://127.0.0.1:${process.env.DECISION_PORT ?? 48431}`, changeOrigin: false },
  } },
  build: { outDir: resolve(here, '../dist'), emptyOutDir: true },
});
