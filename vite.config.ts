import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// Date de compilation, affichée dans les Réglages (pour vérifier la version déployée)
const BUILD = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(BUILD), __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  server: {
    host: true,
    proxy: {
      // En développement, le serveur de demandes tourne sur le port 8080
      '/api': 'http://localhost:8080',
    },
  },
});
