import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20_000,
    environment: 'node',
    // Sem `include` no topo: com `extends: true` ele vazaria para os dois
    // projetos e o teste de main rodaria tambem em jsdom (ambiente errado).
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: ['tests/main/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
