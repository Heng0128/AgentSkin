import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const corePkg = path.resolve(root, 'src/engine');

export default defineConfig({
  resolve: {
    alias: {
      '@agentskin/engine': corePkg,
      '@agentskin/engine/adapters': path.join(corePkg, 'src/adapters/index.mjs'),
      '@agentskin/engine/theme': path.join(corePkg, 'src/theme/index.mjs'),
    },
  },
  test: {
    // Use projects to isolate environments:
    // - main/shared tests run in node
    // - ui tests (hooks, lib) can use jsdom when needed
    projects: [
      {
        test: {
          name: 'engine',
          environment: 'node',
          include: ['src/engine/**/*.test.ts'],
          testTimeout: 15000,
          // threads：forks 池在本机（Windows + Node 22）多 worker 并发时
          // teardown 阶段进程不退出（测试跑完 summary 后挂起），threads 干净退出。
          // 排查记录：2026-08-17（engine 15 文件 forks 必挂 / threads 干净）。
          pool: 'threads',
        },
        /* engine runs pure .mjs runtime modules — no jest aliases needed */
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'src/compiler/**/*.test.ts',
          ],
          // 30s timeout: compiler tests include sandbox child-process execution
          // which may exceed 15s on slower machines.
          testTimeout: 30000,
          pool: 'threads',
          setupFiles: ['vitest.setup.main.ts'],
        },
        resolve: {
          alias: {
            '@agentskin/engine': corePkg,
            '@shared': path.resolve(root, 'src/shared'),
            // material-color-utilities@0.4.0 internal import bug: color_spec_2025.js
            // imports './dynamic_color' without .js extension (other imports in the
            // same file correctly use .js). This alias resolves the extensionless
            // import to the actual file on disk so vitest can load the package.
            '@material/material-color-utilities/dynamiccolor/dynamic_color':
              path.resolve(root, 'node_modules/@material/material-color-utilities/dynamiccolor/dynamic_color.js'),
          },
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'node',
          include: ['src/ui/**/*.test.ts', 'src/ui/**/*.test.tsx'],
          testTimeout: 15000,
          pool: 'threads',
          setupFiles: ['vitest.setup.ui.ts'],
        },
        resolve: {
          alias: {
            '@shared': path.resolve(root, 'src/shared'),
            '@': path.resolve(root, 'src/ui'),
          },
        },
      },
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
          testTimeout: 15000,
          pool: 'threads',
        },
      },
      {
        test: {
          name: 'visual-regression',
          environment: 'node',
          include: ['tests/visual-regression/**/*.test.ts'],
          testTimeout: 30000,
          pool: 'threads',
        },
        resolve: {
          alias: {
            '@': path.resolve(root, 'src/ui'),
            '@shared': path.resolve(root, 'src/shared'),
          },
        },
      },
      {
        test: {
          name: 'deep-core',
          environment: 'happy-dom',
          include: [
            'tests/unit/**/*.test.ts',
            'tests/integrate/**/*.test.ts',
            'tests/contract/**/*.test.ts',
          ],
          testTimeout: 10000,
          pool: 'threads',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json'],
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/ui/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/node_modules/**',
        'src/ui/**/*.tsx',
        'src/ui/**/*.d.ts',
      ],
      thresholds: {
        statements: 45,
        branches: 40,
        functions: 35,
        lines: 45,
      },
    },
    server: {
      deps: {
        inline: [/@agentskin\/engine/],
      },
    },
  },
});
