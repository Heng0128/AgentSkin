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
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          testTimeout: 15000,
          pool: 'forks',
        },
        resolve: {
          alias: {
            '@agentskin/engine': corePkg,
          },
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'node',
          include: ['src/ui/**/*.test.ts', 'src/ui/**/*.test.tsx'],
          testTimeout: 15000,
          pool: 'forks',
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
          name: 'visual-regression',
          environment: 'node',
          include: ['tests/visual-regression/**/*.test.ts'],
          testTimeout: 30000,
          pool: 'forks',
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
