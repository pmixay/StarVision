import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]react-dom[\\/]/.test(id) || /[\\/]react[\\/]/.test(id)) return 'react-vendor';
          if (id.includes('@react-three/fiber')) return 'r3f-vendor';
          if (id.includes('@react-three/drei')) return 'drei-vendor';
          if (/[\\/]three[\\/]/.test(id)) return 'three-vendor';
          if (id.includes('satellite.js')) return 'satellite-vendor';
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
