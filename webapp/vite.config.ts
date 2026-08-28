import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  server: {
    host: true,
    port: 5173,
    // En desarrollo el backend se alcanza directo; en produccion el reverse
    // proxy TLS (contenedor 05) enruta /api hacia el contenedor 01.
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: true } },
  },
});
