// Small production-page diagnostic. It does not enable application debug APIs,
// produce formal performance distributions, or touch a user's browser profile.
import { chromium, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'

const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const url = option('--url', 'http://127.0.0.1:5174/sceneweave/'), out = option('--out', null)
const runs = Number(option('--runs', '2')), delayMs = Number(option('--delay-ms', '0'))
const samples = option('--samples', 'study,island').split(','), names = { study: '书房与露台', island: '双层岩岛', outpost: '海岸哨所' }
if (!Number.isInteger(runs) || runs < 1 || runs > 5 || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 1000 || samples.some(sample => !names[sample])) throw new Error('Invalid diagnostic bounds')
const browser = await chromium.launch({ channel: 'chrome', headless: true }), results = []
try {
  for (const sample of samples) for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 } }), page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    if (delayMs) await page.route('**/*.png', async route => { await new Promise(resolve => setTimeout(resolve, delayMs)); await route.continue().catch(() => {}) })
    await page.addInitScript(() => {
      const data = { started: performance.now(), activity: performance.now(), activeDecodes: 0, decodes: 0, decodeMs: 0, reads: 0, readMs: 0, fetches: [], longTasks: [] }
      globalThis.__sampleLoadDiagnostic = data
      const decode = globalThis.createImageBitmap
      globalThis.createImageBitmap = async (...args) => { const start = performance.now(); data.decodes++; data.activeDecodes++; try { return await decode(...args) } finally { data.decodeMs += performance.now() - start; data.activeDecodes--; data.activity = performance.now() } }
      const getImageData = CanvasRenderingContext2D.prototype.getImageData
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { const start = performance.now(); data.reads++; try { return getImageData.apply(this, args) } finally { data.readMs += performance.now() - start } }
      const fetch = globalThis.fetch
      globalThis.fetch = async (...args) => { const row = { url: String(args[0]), start: performance.now() }; data.fetches.push(row); try { return await fetch(...args) } finally { row.end = performance.now(); data.activity = row.end } }
      new PerformanceObserver(list => { for (const entry of list.getEntries()) data.longTasks.push({ start: entry.startTime, duration: entry.duration }) }).observe({ type: 'longtask', buffered: true })
    })
    try {
      await page.goto(url + '#home'); await expect(page.getByTestId('workspace-home')).toBeVisible()
      for (const mode of ['cold', 'repeat']) {
        if (mode === 'repeat') { await page.getByRole('button', { name: '回到首页', exact: true }).click(); await expect(page.getByTestId('workspace-home')).toBeVisible() }
        const before = await page.evaluate(() => ({ start: performance.now(), decodes: globalThis.__sampleLoadDiagnostic.decodes, reads: globalThis.__sampleLoadDiagnostic.reads }))
        const { start } = before
        await page.getByTestId('workspace-home').getByRole('button', { name: names[sample], exact: true }).click()
        const candidate = page.getByRole('dialog', { name: '确认打开工程', exact: true })
        await expect(candidate).toBeVisible({ timeout: 60_000 })
        const confirmed = await page.evaluate(() => performance.now())
        await candidate.getByRole('button', { name: '保存并打开副本', exact: true }).click()
        await expect(candidate).toHaveCount(0)
        await expect(page.locator('.asset-save')).toHaveText('本地已保存', { timeout: 60_000 })
        await expect(page.locator('.asset-map-wrap')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 })
        await expect.poll(async () => Number(await page.locator('[data-render-count]').getAttribute('data-render-count')), { timeout: 60_000 }).toBeGreaterThan(0)
        const painted = await page.evaluate(() => performance.now())
        // A SPA may already have reached the document's networkidle load state.
        // Observe this operation's actual request/decode quiet period instead.
        await expect.poll(() => page.evaluate(() => { const d = globalThis.__sampleLoadDiagnostic; return d.activeDecodes === 0 && d.fetches.every(row => row.end !== undefined) && performance.now() - d.activity > 500 }), { timeout: 60_000 }).toBe(true)
        const metrics = await page.evaluate(({ start, confirmed, painted, before }) => {
          const data = globalThis.__sampleLoadDiagnostic
          const requests = data.fetches.filter(row => row.start >= start && /\.png(?:$|\?)/.test(row.url))
          const tasks = data.longTasks.filter(row => row.start >= start)
          return { clickToCandidateMs: confirmed - start, adoptToPaintMs: painted - confirmed, clickToPaintMs: painted - start,
            imageRequests: requests.length, longTasks: tasks.length, longestTaskMs: Math.max(0, ...tasks.map(row => row.duration)),
            longTaskTotalMs: tasks.reduce((sum, row) => sum + row.duration, 0), decodes: data.decodes - before.decodes, pixelReads: data.reads - before.reads,
            pixelReadMsTotal: data.readMs, decodeMsTotal: data.decodeMs }
        }, { start, confirmed, painted, before })
        results.push({ sample, run: run + 1, mode, ...metrics, errors: [...errors] })
        if (errors.length) throw new Error('Unexpected page errors: ' + errors.join('; '))
      }
    } finally { await context.close() }
  }
  const report = { kind: 'sample-load-diagnostic', formalPerformance: false, url, runs, delayMs, routingDisablesHttpCache: !!delayMs,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, browser: browser.version(), results }
  if (out) await writeFile(out, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
