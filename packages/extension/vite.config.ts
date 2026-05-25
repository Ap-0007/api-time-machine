import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        if (!existsSync('dist')) mkdirSync('dist', { recursive: true });
        copyFileSync('manifest.json', 'dist/manifest.json');
      },
    },
  ],
  resolve: {
    alias: {
      '@atm/shared': resolve(__dirname, '../shared/types.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        injected: resolve(__dirname, 'src/injected.ts'),
        devtools: resolve(__dirname, 'src/devtools.ts'),
        panel: resolve(__dirname, 'panel.html'),
        popup: resolve(__dirname, 'popup.html'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
      preserveEntrySignatures: 'allow-extension',
    },
  },
});
