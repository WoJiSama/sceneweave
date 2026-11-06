import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tools/testing/aggregate-capacity-fixtures.test.ts'],
    environment: 'node',
    maxWorkers: 1,
  },
})
