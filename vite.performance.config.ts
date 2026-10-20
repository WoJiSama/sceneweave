import { mergeConfig } from 'vite'
import base from './vite.config'

/** Opt-in tools build. The normal site never exposes the benchmark API. */
export default mergeConfig(base, {
  build: {
    outDir: 'dist-performance',
    rollupOptions: { input: { app: 'index.html', performance: 'tools/performance/index.html' } },
  },
})
