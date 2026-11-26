import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import packageInfo from './package.json'
import { blankSceneArchive } from './tools/blank-scene-archive'

function writerBuild(): string {
  const version = packageInfo.version
  const options: ExecFileSyncOptionsWithStringEncoding = { cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  try {
    const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], options).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], options).length > 0
    return `${version}+g${commit}${dirty ? '.dirty' : ''}`
  } catch {
    return version
  }
}

export default defineConfig({
  define: { __SCENEWEAVE_BUILD_VERSION__: JSON.stringify(writerBuild()) },
  // GitHub Pages 项目站点部署在 /sceneweave/ 子路径下；仅生产构建带前缀，
  // dev/测试保持根路径（e2e 与性能工具按根路径访问模块）。素材加载统一走 import.meta.env.BASE_URL
  base: process.env.NODE_ENV === 'production' ? '/sceneweave/' : '/',
  plugins: [react(), blankSceneArchive()],
  // Image work packages, model environments and review outputs are data. They
  // must not trigger source watching while the local editor is being used.
  server: { watch: { ignored: ['**/work/**', '**/local-data/**'] } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
