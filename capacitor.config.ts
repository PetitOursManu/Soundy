import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.soundy.app',
  appName: 'Soundy',
  webDir: 'dist',
  backgroundColor: '#e6ebf5',
  server: {
    androidScheme: 'https',
    // Autorise un serveur Emby en http:// (réseau local par ex.)
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
