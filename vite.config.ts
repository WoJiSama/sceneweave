import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { blankSceneArchive } from './tools/blank-scene-archive'

export default defineConfig({
  // GitHub Pages 项目站点部署在 /sceneweave/ 子路径下；仅生产构建带前缀，
  // dev/测试保持根路径（e2e 与性能工具按根路径访问模块）。素材加载统一走 import.meta.env.BASE_URL
  base: process.env.NODE_ENV === 'production' ? '/sceneweave/' : '/',
  plugins: [react(), blankSceneArchive()],
  // Image work packages, model environments and review outputs are data. They
  // must not trigger source watching while the local editor is being used.
  server: { watch: { ignored: ['**/work/**', '**/local-data/**'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
