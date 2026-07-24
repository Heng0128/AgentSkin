// SPDX-License-Identifier: MPL-2.0

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Unified Electron + Vite build configuration (replaces forge.config.ts +
 * the three separate vite.{main,preload,renderer}.config.ts files).
 *
 *   electron-vite dev   — dev mode with HMR (replaces `electron-forge start`)
 *   electron-vite build — production build to out/{main,preload,renderer}/
 *
 * electron-builder then consumes `out/` directly (no --prepackaged needed)
 * via the `files` + `extraResources` config in electron-builder.yml.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['electron'],
        input: path.resolve(__dirname, 'src/main.ts'),
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
    resolve: {
      alias: {
        '@agentskin/core': path.resolve(__dirname, 'src/engine/src/index.mjs'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ['electron'],
        input: path.resolve(__dirname, 'src/preload.ts'),
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
  },
  renderer: {
    root: path.resolve(__dirname),
    build: {
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
      },
    },
    plugins: [react()],
    assetsInclude: ['**/*.agentskin-theme'],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/ui'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
  },
});
