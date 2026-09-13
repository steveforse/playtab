import { defineConfig } from 'vite';
import RubyPlugin from 'vite-plugin-ruby';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [RubyPlugin(), react(), alphaTab({ assetOutputDir: fileURLToPath(new URL('./public/notation', import.meta.url)) })],
  server: { host: '0.0.0.0', hmr: { host: 'localhost' }, allowedHosts: ['vite', 'localhost'], watch: { usePolling: true, interval: 500 } },
});
