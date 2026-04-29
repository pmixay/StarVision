import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_API_TARGET lets the dev server proxy `/api/*` to a non-default
// backend host. Defaults to localhost so a bare `npm run dev` keeps
// working; docker-compose sets it to `http://backend:8000`.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
