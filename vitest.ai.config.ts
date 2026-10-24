import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['services/ai/**/*.test.ts', 'src/shared/ai/**/*.test.ts', 'src/platform/browser/ai/**/*.test.ts'], environment: 'node', maxWorkers: 1 } })
