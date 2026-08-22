// SPDX-License-Identifier: MPL-2.0

import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

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
    // @material/material-color-utilities 和 colorthief 是 ESM-only 包，externalize 后运行时报
    // ERR_MODULE_NOT_FOUND 或浏览器 API 缺失。通过 exclude 将其打包进主进程产物，避免运行时
    // Node.js ESM 解析问题。colorthief 的 Node 入口依赖 document.createElement("canvas")，
    // 在主进程无法运行，必须打包后由 Vite 的 browser condition 解析到正确入口。
    plugins: [
      externalizeDepsPlugin({ exclude: ['@material/material-color-utilities', 'colorthief'] }),
    ],
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
        '@shared': path.resolve(__dirname, 'src/shared'),
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
    // Vite 不会在渲染进程注入 Node.js 的 process 全局变量，但部分 shared 模块
    // （theme-mapping.ts、workspaceStore.ts）在模块顶层访问了 process.env.*。
    // 通过 define 在编译时将这些字面量替换为字符串常量，避免运行时 ReferenceError。
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
      'process.env.VITEST': JSON.stringify(process.env.VITEST ?? ''),
    },
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
          // 简化为三个 chunk：react 核心生态 / base-ui / hugeicons
          // 避免多 chunk 导致的循环引用崩溃。vendor 不再单独分块，
          // 与 vendor-react 合并后总大小约 800KB，gzip 后约 200KB，
          // 对 Electron 首屏影响可忽略。
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('@hugeicons')) return 'vendor-hugeicons';
            if (id.includes('@base-ui')) return 'vendor-base-ui';
            return 'vendor-react';
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
