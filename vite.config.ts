import { defineConfig } from 'vite';
import RubyPlugin from 'vite-plugin-ruby';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type SoundFontCatalogEntry = { id: string; label: string; filename: string; description: string; source: string };
const soundFontCatalog = JSON.parse(readFileSync(new URL('./soundfont-catalog.json', import.meta.url), 'utf8')) as SoundFontCatalogEntry[];
function availableSoundFonts() {
  return soundFontCatalog
    .filter(font => existsSync(fileURLToPath(new URL(`./${font.source}`, import.meta.url))))
    .map(({ source: _source, ...font }) => font);
}

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
      await Promise.all(soundFontCatalog
        .filter(font => !font.source.startsWith('app/frontend/public/'))
        .filter(font => availableSoundFonts().some(available => available.id === font.id))
        .map(async font => {
          await copyFile(fileURLToPath(new URL(`./${font.source}`, import.meta.url)), join(outputRoot, 'soundfont', font.filename));
        }));
    },
  };
}

export default defineConfig({
  plugins: [RubyPlugin(), react(), alphaTab({ assetOutputDir: false }), copyPlaytabSoundfont()],
  define: { __PLAYTAB_SOUNDFONTS__: JSON.stringify(availableSoundFonts()) },
  server: { host: '0.0.0.0', hmr: { host: 'localhost' }, allowedHosts: ['vite', 'localhost'], watch: { usePolling: true, interval: 500 } },
});
