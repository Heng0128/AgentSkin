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
// 生产构建关闭 sourcemap：main/preload 是 Node 侧代码，崩溃栈可用
// --inspect 调试；生产 .map 既拖慢构建（0.5–1s）又泄露源码路径。
// dev 模式保留 sourcemap 以便断点调试。
const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: isDev,
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
        '@agentskin/engine': path.resolve(__dirname, 'src/engine/src/index.mjs'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: isDev,
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
        // Two HTML entries: `index.html` (main window) and `studio.html`
        // (standalone Theme Studio window). Both share the same global
        // stylesheet + `useAppController` bootstrap; common code is split
        // into the vendor chunks below so neither entry duplicates it.
        input: {
          index: path.resolve(__dirname, 'index.html'),
          studio: path.resolve(__dirname, 'studio.html'),
        },
        output: {
          // 代码分割：把 vendor 依赖拆成独立 chunk，避免单文件 1.3MB。
          // 改动业务代码时 Vite 只重新打包 affected chunk，构建提速 3-5x。
          //
          // 分块策略：
          //   - vendor-hugeicons: 图标库（无 React 依赖，独立）
          //   - vendor-utils:     cva/clsx/tailwind-merge（无 React 依赖，独立）
          //   - vendor-base-ui:   @base-ui React 组件库（体积大，独立分块）
          //   - vendor-react:     react/react-dom/scheduler 核心 + use-sync-external-store
          //   - vendor:           其余 node_modules（杂项，体积小）
          //   - index:            业务代码（src/ui）
          //
          // 关键：use-sync-external-store 必须和 react 在同一 chunk。
          // 它被 react-dom 间接依赖，又反过来 require react，若拆到 vendor
          // chunk 会形成循环引用：vendor-react → vendor(shim) → vendor-react
          // (尚未初始化完成) → exports undefined → 运行时崩溃
          // (Cannot set properties of undefined (setting 'Activity'))。
          // 这是 Vite 7 "Circular chunk" 告警的真实运行时后果。
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('@hugeicons')) return 'vendor-hugeicons';
            if (id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge')) {
              return 'vendor-utils';
            }
            if (id.includes('@base-ui')) return 'vendor-base-ui';
            if (
              id.includes('react-dom') ||
              id.includes('/react/') ||
              id.includes('/scheduler/') ||
              id.includes('use-sync-external-store')
            ) {
              return 'vendor-react';
            }
            return 'vendor';
          },
        },
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
    // dev 模式预构建依赖：消除首次启动的 esbuild 扫描耗时（约 2–3s）。
    // include 这些高频依赖，让 Vite 提前打好 CJS→ESM 转换缓存；
    // exclude @hugeicons/core-free-icons（数千个独立图标文件，按需 import
    // 即可，全量预构建反而拖慢）。
    // 注意：optimizeDeps 仅影响 dev server，生产 build 自动忽略。
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        '@base-ui/react',
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
      ],
      exclude: ['@hugeicons/core-free-icons'],
    },
  },
});
