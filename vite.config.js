import { defineConfig } from 'vite';
export default defineConfig({
  base: './',                       // relative paths -> dist/ can be hosted from any static folder
  build: { target: 'es2020', chunkSizeWarningLimit: 1200, assetsInlineLimit: 0 },
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
});
