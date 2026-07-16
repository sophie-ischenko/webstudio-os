import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Copy Electron main/preload/schema into dist-electron/ after build so
// electron . can find them next to the bundled renderer (dist/).
function copyElectronFiles() {
  const outDir = resolve(__dirname, 'dist-electron');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  for (const f of ['main.cjs', 'preload.cjs', 'schema.sql']) {
    copyFileSync(resolve(__dirname, 'electron', f), resolve(outDir, f));
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-electron',
      closeBundle() {
        copyElectronFiles();
      },
    },
  ],
  // Relative paths so the built index.html works under file:// in Electron.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
