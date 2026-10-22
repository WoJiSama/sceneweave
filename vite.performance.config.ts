import { mergeConfig } from 'vite'
import base from './vite.config'

/** Opt-in tools build. The normal site never exposes the benchmark API. */
export default mergeConfig(base, {
  // 性能采集器以根路径伺服 dist-performance，保持与前缀无关
  base: '/',
  build: {
    outDir: 'dist-performance',
    rollupOptions: { input: { app: 'index.html', performance: 'tools/performance/index.html' } },
  },
})
