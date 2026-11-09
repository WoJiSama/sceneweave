import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium } from '@playwright/test'
import { assert, MAX_ARCHIVE_BYTES, parseArguments, readRequest, replaceResult, usage, writeVerified } from './io.mjs'
import { startHarnessTooling } from './tooling.mjs'
import { generateInBrowser, verifyDiskDelivery } from './browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function run(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(`${usage}\n`); return }
  const options = parseArguments(args), started = performance.now()
  let tooling, browser, context, record, output, stopReason, timer, publicationComplete = false
  const stop = reason => {
    if (publicationComplete) return
    stopReason ??= reason; void browser?.close().catch(() => {})
  }
  const checkStopped = () => assert(!stopReason, stopReason)
  const interrupt = () => stop('Operation cancelled by user')
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  try {
    const raw = options.command === 'generate' ? await readRequest(options.input) : undefined
    tooling = await startHarnessTooling(root, options.command === 'generate')
    const sdk = await tooling.sdk()
    if (options.command === 'capabilities' || options.command === 'example') {
      const value = options.command === 'capabilities' ? sdk.semanticGenerationCapabilities() : sdk.semanticGenerationExample()
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
      return
    }
    const request = sdk.parseSemanticGenerationRequest(raw), requestHash = sdk.semanticGenerationRequestHash(request)
    const authorization = { capabilityId: 'sceneweave-forest-building@1', contentId: 'builtin-mixed-forest@1', requestHash }
    assert(!stopReason, stopReason)
    // mkdir is exclusive; no recursive creation, reuse, truncation or overwrite.
    await fs.mkdir(options.output, { mode: 0o700 }); output = options.output
    record = { format: 'sceneweave-local-generation-result', version: 1, status: 'running', startedAt: new Date().toISOString(),
      requestHash, authorization, budget: options.budget, modelRequests: 0, formalAcceptance: false,
      scope: 'Independent new project using built-in fixed content. No current-project or browser database access.',
      timings: {}, files: {} }
    await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    const savedRequest = await writeVerified(output, 'request.json', Buffer.from(`${JSON.stringify(request, null, 2)}\n`))
    record.files.request = savedRequest.record
    // This is a single execution. A late result fails rather than initiating a retry.
    timer = setTimeout(() => stop('Local generation exceeded its 360-second delivery deadline'), 360000)
    const browserStarted = performance.now()
    browser = await chromium.launch({ headless: true })
    assert(!stopReason, stopReason)
    context = await browser.newContext({ serviceWorkers: 'block' })
    const browserErrors = []
    context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)))
    await context.route('**/*', route => route.request().url().startsWith(`${tooling.origin}/`) ? route.continue() : route.abort('blockedbyclient'))
    await context.addInitScript(() => {
      // Importing runtime modules may construct repositories; opening or changing
      // any database is forbidden for this file-only adapter.
      IDBFactory.prototype.open = () => { throw new Error('Local harness cannot open browser databases') }
      IDBFactory.prototype.deleteDatabase = () => { throw new Error('Local harness cannot delete browser databases') }
    })
    const page = await context.newPage()
    await page.goto(tooling.url)
    const generated = await page.evaluate(generateInBrowser, { request, authorization, budget: options.budget })
    assert(!stopReason, stopReason)
    const archive = Buffer.from(generated.archiveBase64, 'base64'), png = Buffer.from(generated.previewBase64, 'base64')
    assert(archive.length <= MAX_ARCHIVE_BYTES && png.length <= MAX_ARCHIVE_BYTES, 'Generated delivery exceeds file protection limit')
    const savedArchive = await writeVerified(output, 'map.sceneweave', archive)
    const savedPreview = await writeVerified(output, 'preview.png', png)
    const coldPage = await context.newPage()
    await coldPage.goto(tooling.url)
    const diskVerification = await coldPage.evaluate(verifyDiskDelivery, { archiveBase64: savedArchive.bytes.toString('base64'),
      previewBase64: savedPreview.bytes.toString('base64'), expectedProjectHash: generated.result.projectHash })
    assert(!stopReason, stopReason)
    assert(browserErrors.length === 0, `Browser execution errors: ${browserErrors.join('; ')}`)
    const deliveryWorkMs = generated.result.timings.packageExportMs + generated.result.timings.memoryColdImportMs
      + generated.result.timings.previewMs + diskVerification.coldImportAndPixelComparisonMs
    const { assertTaskBudget } = await tooling.budget()
    checkStopped()
    const budgetUsage = assertTaskBudget(generated.result.profile, { ...generated.result.usage,
      activeExecutionMs: generated.result.usage.activeExecutionMs + Math.ceil(deliveryWorkMs) })
    record = { ...record, ...generated.result, status: 'complete', completedAt: new Date().toISOString(),
      usage: budgetUsage,
      browser: { engine: 'chromium', version: browser.version(), isolated: true },
      files: { request: savedRequest.record, project: savedArchive.record, preview: savedPreview.record },
      diskVerification, browserErrors,
      timings: { ...generated.result.timings, deliveryWorkMs: Math.round(deliveryWorkMs * 1000) / 1000,
        browserStartupAndDeliveryMs: Math.round((performance.now() - browserStarted) * 1000) / 1000,
        commandTotalMs: Math.round((performance.now() - started) * 1000) / 1000 } }
    await replaceResult(output, record, { checkCurrent: checkStopped, onPublished: () => { publicationComplete = true } })
    process.stdout.write(`${JSON.stringify({ status: record.status, output, requestHash, projectHash: record.projectHash,
      entities: record.entities, limitations: record.limitations, timings: record.timings }, null, 2)}\n`)
  } catch (error) {
    const message = stopReason ?? (error instanceof Error ? error.message : 'Local generation failed')
    if (record && output) {
      record = { ...record, status: 'failed', completedAt: new Date().toISOString(), error: message,
        timings: { ...record.timings, commandTotalMs: Math.round((performance.now() - started) * 1000) / 1000 } }
      await replaceResult(output, record).catch(() => {})
    }
    throw new Error(message)
  } finally {
    clearTimeout(timer)
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
    try { await context?.close() } finally {
      try { await browser?.close() } finally { await tooling?.close() }
    }
  }
}

run(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Local generation failed'}\n`)
  process.exitCode = 1
})
