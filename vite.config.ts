import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    proxy: {
      // En développement, le serveur de demandes tourne sur le port 8080
      '/api': 'http://localhost:8080',
    },
  },
});
