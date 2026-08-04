import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 15000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // T1: include src/ui in coverage so hooks / lib / types are measured.
      // Only .ts is included — .tsx (components/pages) is excluded because the
      // test environment is 'node' (no jsdom + RTL setup), so measuring them
      // would tank the threshold without an actionable signal. Add .tsx back
      // when component tests land.
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts', 'src/ui/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/node_modules/**',
        'src/ui/**/*.tsx',
        'src/ui/**/*.d.ts',
      ],
      thresholds: {
        // Floor — never let coverage drop below these values.
        // T1 baseline (with src/ui/**/*.ts included): 29.78% statements,
        // 31.56% branches, 28.59% functions, 30.38% lines. Set slightly below
        // actual to avoid flaky CI on minor changes. Raise these back up once
        // T2 (core UI hook tests) lands.
        statements: 25,
        branches: 28,
        functions: 25,
        lines: 25,
      },
    },
    server: {
      deps: {
        inline: [/@agentskin\/engine/],
      },
    },
  },
});
