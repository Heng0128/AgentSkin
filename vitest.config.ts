import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const corePkg = path.resolve(root, 'src/engine');

export default defineConfig({
  resolve: {
    alias: {
      '@agentskin/core': corePkg,
      '@agentskin/core/adapters': path.join(corePkg, 'src/adapters/index.mjs'),
      '@agentskin/core/theme': path.join(corePkg, 'src/theme/index.mjs'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 15000,
    pool: 'forks',
    server: {
      deps: {
        inline: [/@agentskin\/core/],
      },
    },
  },
});
