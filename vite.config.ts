import { defineConfig } from 'vite';
import RubyPlugin from 'vite-plugin-ruby';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function copyPlaytabSoundfont() {
  return {
    name: 'playtab-soundfont',
    enforce: 'post' as const,
    async buildStart() {
      const sourceRoot = fileURLToPath(new URL('./app/frontend/public', import.meta.url));
      const outputRoot = fileURLToPath(new URL('./public/notation', import.meta.url));
      await rm(outputRoot, { recursive: true, force: true });
      await Promise.all(['font', 'soundfont'].map(async directory => {
        const sourceDir = join(sourceRoot, directory);
        const outputDir = join(outputRoot, directory);
        await mkdir(outputDir, { recursive: true });
        const files = await readdir(sourceDir);
        await Promise.all(files.map(file => copyFile(join(sourceDir, file), join(outputDir, file))));
      }));
    },
  };
}

export default defineConfig({
  plugins: [RubyPlugin(), react(), alphaTab({ assetOutputDir: false }), copyPlaytabSoundfont()],
  server: { host: '0.0.0.0', hmr: { host: 'localhost' }, allowedHosts: ['vite', 'localhost'], watch: { usePolling: true, interval: 500 } },
});
