import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // NodeNext uses .js extensions in imports; strip them so Vitest resolves .ts files
    alias: [{ find: /^(\.{1,2}\/.+)\.js$/, replacement: '$1' }]
  },
  test: {
    environment: 'node',
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/__tests__/**']
    }
  }
});
