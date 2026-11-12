import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startNativeFixtureTooling } from './prepare-native-m2-fixture.mjs'

// Tooling-only browser. It closes before any normal-production measurement.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const argument = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const output = argument('--output', null)
const channel = argument('--channel', 'chrome')
const mode = argument('--mode', 'all')
if (args.includes('--help')) {
  console.log('node tools/performance/prepare-current-formal.mjs --output ABS [--mode all|capacity|visual] [--channel chrome] [--cases mixed-2000,building-500]')
  process.exit(0)
}
const selectedCases = argument('--cases', null)?.split(',')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
check(output && path.isAbsolute(output), 'Expected --output ABS_DIRECTORY')
check(['all', 'capacity', 'visual'].includes(mode), 'Expected --mode all/capacity/visual')
check(!selectedCases || mode !== 'visual' && selectedCases.length > 0 && new Set(selectedCases).size === selectedCases.length
  && selectedCases.every(name => /^(building|natural|mixed)-(500|2000)$/.test(name) || ['mixed-500-remote', 'mixed-500-local-ports'].includes(name)), 'Invalid capacity --cases')
await fs.mkdir(output, { recursive: true })
check((await fs.readdir(output)).length === 0, 'Output must be empty; retained evidence cannot be overwritten')
const record = { format: 'sceneweave-current-formal-preparation', version: 1, status: 'running', startedAt: new Date().toISOString(), node: process.version,
  scope: 'Isolated tooling preparation of complete current-v1 archives with actual byte/pixel/license validation. No product performance observations.', results: [] }
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2))
await write('preparation.json', record)
let tooling, browser
try {
  tooling = await startNativeFixtureTooling({ root })
  browser = await chromium.launch({ channel, headless: true })
  record.browser = browser.version()
  const capacity = { format: 'sceneweave-current-formal-fixtures', version: 1, status: 'running', cases: [] }
  const visual = { format: 'sceneweave-formal-visual-fixtures', version: 1, status: 'running', cases: [] }
  async function prepare(modulePath, exportName, parameters) {
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1, locale: 'zh-CN' })
    try {
      const page = await context.newPage()
      await page.goto(tooling.url)
      return await page.evaluate(async ({ modulePath, exportName, parameters }) => {
        const module = await import(modulePath)
        const result = await module[exportName](...parameters)
        async function encode(value) {
          const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(reader.error)
            reader.onload = () => resolve(String(reader.result).split(',')[1])
            reader.readAsDataURL(new Blob([bytes]))
          })
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
          return { base64, sha256: digest, byteLength: bytes.length }
        }
        const transfer = async value => { const { bytes, ...meta } = value; return { ...meta, ...await encode(bytes) } }
        if (result.bytes) return transfer(result)
        return { ...result, variants: Object.fromEntries(await Promise.all(Object.entries(result.variants).map(async ([key, value]) => [key, await transfer(value)]))),
          views: await Promise.all((result.views ?? []).map(transfer)) }
      }, { modulePath, exportName, parameters })
    } finally { await context.close() }
  }
  async function saveBlob(file, item) {
    const { base64, ...metadata } = item
    const bytes = Buffer.from(base64, 'base64')
    check(sha(bytes) === metadata.sha256 && bytes.length === metadata.byteLength, `Transferred bytes mismatch: ${file}`)
    await fs.writeFile(path.join(output, file), bytes, { flag: 'wx' })
    check(sha(await fs.readFile(path.join(output, file))) === metadata.sha256, `Disk reread mismatch: ${file}`)
    return { ...metadata, file }
  }
  if (mode !== 'visual') {
    const requests = ['building', 'natural', 'mixed'].flatMap(kind => [500, 2000].map(count => ({ kind, count, name: `${kind}-${count}`, variant: {} })))
    requests.push({ kind: 'mixed', count: 500, name: 'mixed-500-remote', variant: { remoteExtraProps: 500 } },
      { kind: 'mixed', count: 500, name: 'mixed-500-local-ports', variant: { localExternalPorts: 16 } })
    for (const { kind, count, name, variant } of requests.filter(item => !selectedCases || selectedCases.includes(item.name))) {
      console.log(`Prepare full-Prop capacity: ${name}`)
      const item = await prepare('/tools/testing/formal-capacity-fixtures.ts', 'prepareFormalCapacityFixture', [kind, count, variant])
      const saved = await saveBlob(`${name}.sceneweave`, item)
      capacity.cases.push({ ...saved, name })
      record.results.push({ kind: 'capacity', name, sha256: saved.sha256 })
      await write('preparation.json', record)
    }
    capacity.status = 'complete'
    await write('manifest.json', capacity)
  }
  if (mode !== 'capacity') {
    for (const kind of ['interior', 'island', 'coast', 'mixed', 'current-island']) {
      console.log(`Prepare fixed visual: ${kind}`)
      const item = await prepare('/tools/testing/formal-visual-fixtures.ts', 'prepareFormalVisualFixture', [kind])
      const variants = {}
      for (const [name, variant] of Object.entries(item.variants)) variants[name] = await saveBlob(`visual-${kind}-${name}.sceneweave`, variant)
      const views = []
      for (const view of item.views ?? []) {
        check(/^[a-zA-Z0-9_-]+$/.test(view.name), 'Unsafe view name')
        views.push(await saveBlob(`visual-${kind}-view-${view.name}.sceneweave`, view))
      }
      const entry = { name: kind, kind, controls: item.controls, summary: item.summary, variants, views }
      visual.cases.push(entry)
      record.results.push({ kind: 'visual', name: kind, variants: Object.keys(variants), views: views.length })
      await write('preparation.json', record)
    }
    visual.status = 'complete'
    await write('formal-visual-fixtures.json', visual)
  }
  record.status = 'complete'
} catch (error) {
  record.status = 'failed'; record.error = error.stack ?? String(error); process.exitCode = 1
  console.error(error)
} finally {
  const errors = []
  for (const [owner, action] of [['browser', () => browser?.close()], ['tooling', () => tooling?.close()]]) {
    try { await action() } catch (error) { errors.push({ owner, error: String(error) }) }
  }
  if (errors.length) { record.cleanupErrors = errors; record.status = 'failed'; process.exitCode = 1 }
  record.endedAt = new Date().toISOString()
  await write('preparation.json', record)
}
