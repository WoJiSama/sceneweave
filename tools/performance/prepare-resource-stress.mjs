import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'
import { fingerprintPaths, MODULE_SOURCE_PATHS, contentSha256, assertFrozen } from './frozen-input.mjs'

const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (args.includes('--help')) {
  console.log('node tools/performance/prepare-resource-stress.mjs --source ABS_FROZEN --output ABS_NEW [--cases image-2048,image-4096,image-near32mp,images-50mp,assets-64,assets-128,assets-256,reject-assets-257,reject-pixels-over64mp]')
  process.exit(0)
}
const source = path.resolve(arg('--source', root)), output = arg('--output'), cases = arg('--cases', 'image-2048,image-4096,image-near32mp,images-50mp,assets-64,assets-128,assets-256,reject-assets-257,reject-pixels-over64mp').split(',')
if (!output || !path.isAbsolute(output) || !cases.length || new Set(cases).size !== cases.length) throw new Error('Expected absolute new output and unique cases')
await fs.mkdir(output, { recursive: true }); if ((await fs.readdir(output)).length) throw new Error('Evidence directory must be empty')
const frozen = await fingerprintPaths(source, MODULE_SOURCE_PATHS), manifest = { format: 'sceneweave-current-formal-fixtures', version: 1, status: 'running',
  measurementClass: 'tooling-resource-stress-preparation', startedAt: new Date().toISOString(), source, frozen, cases: [], rejections: [] }
const toolPaths = ['tools/performance/prepare-resource-stress.mjs', 'tools/performance/frozen-input.mjs', 'tools/performance/prepare-native-m2-fixture.mjs']
manifest.frozenTools = await fingerprintPaths(root, toolPaths)
const write = () => fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
let browser, tooling
try {
  await write(); tooling = await startNativeFixtureTooling({ root: source }); browser = await chromium.launch({ channel: arg('--channel', 'chrome'), headless: true })
  manifest.browser = browser.version()
  for (const name of cases) {
    console.log(`Prepare resource stress: ${name}`)
    const context = await browser.newContext()
    try {
      const page = await context.newPage(); await page.goto(tooling.url)
      const result = await page.evaluate(async name => {
        const modulePath = '/tools/testing/resource-stress-fixtures.ts', module = await import(modulePath)
        const value = await module.prepareResourceStressFixture(name)
        if (value.rejected) return value
        const { bytes, ...meta } = value
        const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error)
          reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(new Blob([bytes])) })
        return { ...meta, base64 }
      }, name)
      if (result.rejected) manifest.rejections.push({ name, ...result })
      else {
        const { base64, ...meta } = result, bytes = Buffer.from(base64, 'base64'), file = `${name}.sceneweave`
        await fs.writeFile(path.join(output, file), bytes, { flag: 'wx' })
        const sha256 = contentSha256(bytes); if (contentSha256(await fs.readFile(path.join(output, file))) !== sha256) throw new Error('Disk reread mismatch')
        manifest.cases.push({ name, file, sha256, byteLength: bytes.length, ...meta })
      }
      assertFrozen(frozen, await fingerprintPaths(source, MODULE_SOURCE_PATHS), 'preparation source'); await write()
      assertFrozen(manifest.frozenTools, await fingerprintPaths(root, toolPaths), 'preparation tools')
    } finally { await context.close() }
  }
  manifest.status = 'complete'
} catch (error) { manifest.status = 'failed'; manifest.error = error.stack ?? String(error); process.exitCode = 1; console.error(error) }
finally { await browser?.close(); await tooling?.close(); manifest.endedAt = new Date().toISOString(); await write() }
