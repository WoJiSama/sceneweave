import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { assert, digest, MAX_ARCHIVE_BYTES, MAX_MAP_REQUEST_BYTES, readBounded, readRequest, replaceResult, writeVerified } from './io.mjs'
import { openHarnessContext, startHarnessTooling } from './tooling.mjs'
import { runMapInBrowser } from './browser.mjs'
import { captureMapCandidate, compareMapPng, retainAscentWidthAttempts } from './map-verification.mjs'
import { cacheMapPreviews, describeMapArtifact, MAP_PREVIEW_CACHE_BYTES } from './map-preview-cache.mjs'
import { checkMapInEditor } from './map-editor.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const budgetIds = ['small', 'standard', 'expanded']
const json = value => `${JSON.stringify(value, null, 2)}\n`
const milliseconds = start => Math.round(performance.now() - start)
const allowance = 'map-authoring'
const referenceImageLimit = 20 * 1024 * 1024
const compactMapReference = ({ regions, lakes, coastFeatures, ...report }) => {
  const countPoints = ({ boundary, ...row }) => ({ ...row, points: boundary.length })
  return { ...report, regions: regions.map(countPoints), lakes: lakes.map(countPoints),
    ...(coastFeatures ? { coastFeatures: { ...coastFeatures, shallows: coastFeatures.shallows.map(countPoints) } } : {}) }
}

export const mapUsage = `Sceneweave map authoring
  node tools/harness/sceneweave.mjs map capabilities
  node tools/harness/sceneweave.mjs map schema reference|generate|inspect|edit
  node tools/harness/sceneweave.mjs map reference --image ABS_IMAGE --input ABS_GUIDE_JSON --output NEW_ABS_DIR --allow map-authoring [--stage draft|complete] [--delivery receipt|copy] [--budget standard]
  node tools/harness/sceneweave.mjs map diagnose --input ABS_JSON --allow map-authoring [--budget standard] [--geometry full] [--output NEW_ABS_DIR]
  node tools/harness/sceneweave.mjs map example [landscape-reference|landscape-ascent|landscape|interior|forest|volcano|mixed|island|coast|layout]
  node tools/harness/sceneweave.mjs map generate --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring [--stage draft|complete] [--delivery receipt|copy] [--budget standard]
  node tools/harness/sceneweave.mjs map inspect --project ABS_SCENEWEAVE --allow map-authoring [--floor ID] [--query TEXT] [--limit N] [--offset N]
  node tools/harness/sceneweave.mjs map edit --project ABS_SCENEWEAVE --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring [--stage draft|complete] [--delivery receipt|copy] [--budget standard]
  node tools/harness/sceneweave.mjs map verify --candidate ABS_DIR --output NEW_ABS_DIR --allow map-authoring [--previews keep|redraw] [--editor reopen] [--delivery receipt|copy] [--budget standard]

Use reference --stage draft for an editable map and reference overlay in one call.
Use diagnose to check geometry without drawing. Add --output to save the checked project for verify.
Preview images share a bounded cache. Use --delivery copy to save independent map images, or with trace-only reference to save the overlay.
For edits, copy projectHash
and floorId from inspect or the candidate result and use a fresh output directory.
The harness launches an isolated browser. It checks Playwright Chromium, Chrome and Edge.
Use SCENEWEAVE_BROWSER_CHANNEL to select a specific installed channel.`

export function readMapFlags(args, allowed) {
  const flags = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const [name, value] = args.slice(index, index + 2)
    assert(allowed.includes(name) && !flags.has(name) && value && !value.startsWith('--'), `Unknown, repeated or incomplete option: ${name}`)
    flags.set(name, value)
  }
  return flags
}

function absolute(flags, key) {
  const value = flags.get(key)
  assert(value && path.isAbsolute(value), `Expected an absolute path for ${key}`)
  return path.resolve(value)
}

export function mapBudget(value) {
  const budget = value ?? 'standard'
  assert(budgetIds.includes(budget), 'Choose --budget small, standard or expanded')
  return budget
}

export function mapStage(value = 'complete') {
  assert(value === 'draft' || value === 'complete', 'Choose --stage draft or complete')
  return value
}

export function mapPreviews(value = 'keep') {
  assert(value === 'keep' || value === 'redraw', 'Choose --previews keep or redraw')
  return value
}

export function mapDelivery(value = 'receipt') {
  assert(value === 'receipt' || value === 'copy', 'Choose --delivery receipt or copy')
  return value
}

export function parseMapCli([action, ...args]) {
  if (action === 'capabilities') {
    assert(!args.length, mapUsage)
    return { action }
  }
  if (action === 'example' || action === 'schema') {
    assert(args.length <= 1 && (action === 'example' || ['reference', 'generate', 'edit', 'inspect'].includes(args[0])), mapUsage)
    return { action, value: args[0] }
  }
  assert(['reference', 'diagnose', 'generate', 'edit', 'inspect', 'verify'].includes(action), mapUsage)
  if (action === 'reference' || action === 'diagnose') {
    const flags = readMapFlags(args, ['--allow', '--input', '--budget', '--output', ...(action === 'reference' ? ['--image', '--stage', '--delivery'] : ['--geometry'])])
    assert(flags.get('--allow') === allowance, 'Expected explicit --allow map-authoring')
    assert(!flags.has('--geometry') || flags.get('--geometry') === 'full', 'Choose --geometry full for detailed coordinates.')
    return { action, input: absolute(flags, '--input'), budget: mapBudget(flags.get('--budget')),
      ...(flags.has('--geometry') ? { geometry: true } : {}),
      ...(action === 'reference' ? { image: absolute(flags, '--image'), output: absolute(flags, '--output'), deliveryMode: mapDelivery(flags.get('--delivery')),
        referenceStage: flags.has('--stage') ? mapStage(flags.get('--stage')) : undefined }
        : flags.has('--output') ? { output: absolute(flags, '--output') } : {}) }
  }
  if (action === 'verify') {
    const flags = readMapFlags(args, ['--allow', '--candidate', '--output', '--budget', '--previews', '--editor', '--delivery'])
    assert(flags.get('--allow') === allowance, 'Expected explicit --allow map-authoring')
    assert(!flags.has('--editor') || flags.get('--editor') === 'reopen', 'Choose --editor reopen.')
    return { action, candidate: absolute(flags, '--candidate'), output: absolute(flags, '--output'),
      budget: mapBudget(flags.get('--budget')), previews: mapPreviews(flags.get('--previews')),
      deliveryMode: mapDelivery(flags.get('--delivery')), ...(flags.has('--editor') ? { editor: true } : {}) }
  }
  const flags = readMapFlags(args, ['--allow', ...(action !== 'generate' ? ['--project'] : []),
    ...(action === 'inspect' ? ['--floor', '--query', '--offset', '--limit'] : ['--input', '--output', '--budget', '--stage', '--delivery'])])
  assert(flags.get('--allow') === allowance, 'Expected explicit --allow map-authoring')
  const project = action !== 'generate' ? absolute(flags, '--project') : undefined
  if (action === 'inspect') return { action, project, request: Object.fromEntries([
    ['floorId', flags.get('--floor')], ['query', flags.get('--query')],
    ['offset', flags.has('--offset') ? Number(flags.get('--offset')) : undefined],
    ['limit', flags.has('--limit') ? Number(flags.get('--limit')) : undefined],
  ].filter(([, value]) => value !== undefined)) }
  return { action, project, input: absolute(flags, '--input'), output: absolute(flags, '--output'),
    stage: mapStage(flags.get('--stage')), budget: mapBudget(flags.get('--budget')), deliveryMode: mapDelivery(flags.get('--delivery')) }
}

export async function useMapDefinitions(action) {
  const tooling = await startHarnessTooling(root)
  try { return await action(await tooling.mapAuthoring(), await tooling.workflows()) } finally { await tooling.close() }
}

async function launchBrowser(channelPreference) {
  const requested = channelPreference ?? process.env.SCENEWEAVE_BROWSER_CHANNEL
  const bundled = !requested && await fs.access(chromium.executablePath()).then(() => true, () => false)
  const channels = requested ? [requested === 'chromium' ? null : requested] : [...(bundled ? [null] : []), 'chrome', 'msedge']
  let failure
  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}),
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas'] })
      return { browser, channel: channel ?? 'chromium' }
    }
    catch (error) { failure = error }
  }
  throw new Error(requested ? `浏览器 ${requested} 无法启动：${failure?.message}`
    : '找不到可启动的 Chromium、Chrome 或 Edge。运行 npx playwright install chromium，或设置 SCENEWEAVE_BROWSER_CHANNEL 选择已安装的浏览器。')
}

function schemaRequest(action, raw, definitions) {
  try {
    return action === 'reference' ? definitions.parseMapReference(raw)
      : action === 'generate' || action === 'diagnose' ? definitions.parseMapGenerate(raw)
        : action === 'edit' ? definitions.parseMapEdit(raw) : definitions.parseMapInspect(raw)
  } catch (error) {
    if (!Array.isArray(error.issues)) throw error
    const issues = error.issues.slice(0, 12).map(({ path, message, maximum, minimum }) => ({
      path: path.map(String).join('.') || 'request', message, maximum, minimum,
    }))
    throw Object.assign(new Error(issues.map(issue => `${issue.path}：${issue.message}`).join('\n')), { code: 'invalid_request', issues })
  }
}

/** CLI and MCP exercise the same immutable input, candidate and cold delivery. */
export async function executeMap({ action, request: raw, image, project, candidate, output, budget = 'standard', stage = 'complete',
  referenceStage, previews = 'keep', deliveryMode = 'receipt', editor = false, geometry = false, workspace, signal, progress }) {
  assert(['reference', 'diagnose', 'generate', 'inspect', 'edit', 'verify'].includes(action), 'Unknown map operation')
  mapStage(stage)
  mapPreviews(previews)
  mapDelivery(deliveryMode)
  assert(stage === 'complete' || action === 'generate' || action === 'edit', 'This operation requires the complete stage.')
  assert(referenceStage === undefined || action === 'reference', '只可从参考图生成时指定参考图阶段。')
  assert(previews === 'keep' || action === 'verify', 'Redraw requires a saved candidate.')
  const copyDelivery = deliveryMode === 'copy'
  assert(!copyDelivery || ['reference', 'generate', 'edit', 'verify'].includes(action), '该操作没有可另存的图片。')
  assert(typeof editor === 'boolean' && (!editor || action === 'verify'), 'Editor reopening requires a saved candidate.')
  const deferPreview = action === 'diagnose' && output !== undefined
  if (deferPreview) { action = 'generate'; stage = 'draft' }
  const started = performance.now()
  let tooling, browser, outputDirectory, outputOwned = false, record, beforeDelivery, stopReason, published = false, phase = 'input'
  const storage = { writtenBytes: 0, reusedBytes: 0, cacheWrittenBytes: 0, cacheReclaimedBytes: 0, cacheLimitBytes: MAP_PREVIEW_CACHE_BYTES }
  const deliveryFiles = []
  const saveFile = async (file, bytes, maximum, onCreated) => {
    const saved = await writeVerified(output, file, bytes, maximum, onCreated)
    storage.writtenBytes += saved.record.byteLength
    return { ...saved, path: path.join(output, file) }
  }
  const cachePreviews = async images => {
    const cached = await cacheMapPreviews(output, images)
    storage.cacheWrittenBytes += cached.addedBytes
    storage.cacheReclaimedBytes += cached.reclaimedBytes
    storage.reusedBytes += cached.reusedBytes
    return cached.images
  }
  const useCandidate = artifact => {
    storage.reusedBytes += artifact.record.byteLength
    return { ...artifact, record: { ...artifact.record, sourceDirectory: path.relative(outputDirectory, artifact.directory) } }
  }
  const abort = reason => {
    if (published) return
    stopReason ??= reason
    void browser?.close().catch(() => {})
  }
  const onCancel = () => abort('制图操作已取消。')
  const checkCurrent = () => {
    if (signal?.aborted) onCancel()
    assert(!stopReason, stopReason)
  }
  signal?.addEventListener('abort', onCancel, { once: true })
  const timer = setTimeout(() => abort('制图操作超过 360 秒执行时限。'), 360000)
  const open = async (channel) => {
    checkCurrent()
    const launched = await launchBrowser(channel)
    browser = launched.browser
    checkCurrent()
    const info = { channel: launched.channel, version: browser.version(), rendering: 'isolated-software' }
    const { context, errors } = await openHarnessContext(browser, tooling.origin)
    const page = await context.newPage()
    const requests = new Map()
    const recordRequest = (url, problem) => {
      if (requests.size >= 8 || !url.startsWith(`${tooling.origin}/`)) return
      requests.set(new URL(url).pathname, problem)
    }
    page.on('requestfailed', request => recordRequest(request.url(), request.failure()?.errorText ?? 'request failed'))
    page.on('response', response => { if (response.status() >= 400) recordRequest(response.url(), `HTTP ${response.status()}`) })
    await page.goto(tooling.url)
    return { page, requests, errors, info }
  }
  const call = async (opened, input) => {
    try {
      const outcome = await opened.page.evaluate(runMapInBrowser, input)
      checkCurrent()
      if (outcome.failure) throw Object.assign(new Error(outcome.failure.message), { code: outcome.failure.code, details: outcome.failure.details })
      assert(!opened.errors.length, opened.errors.join('\n'))
      return outcome
    } catch (error) {
      if (opened.requests.size && !error.code) {
        error.code = 'browser_asset_load'
        error.details = { requests: [...opened.requests].map(([path, problem]) => ({ path, problem })) }
      }
      throw error
    }
  }
  const closeBrowser = async () => {
    await browser?.close()
    browser = undefined
  }
  try {
    checkCurrent()
    const captured = action === 'verify' ? await captureMapCandidate(candidate, previews, workspace) : undefined
    let requestBytes = captured?.request.bytes ?? Buffer.from(JSON.stringify(raw) ?? '')
    assert(requestBytes.length > 0 && requestBytes.length <= MAX_MAP_REQUEST_BYTES,
      `制图请求字节数 ${requestBytes.length}，允许 1–${MAX_MAP_REQUEST_BYTES} 字节。`)
    const archive = project ? await readBounded(project, MAX_ARCHIVE_BYTES) : undefined
    tooling = await startHarnessTooling(root, true, editor)
    const definitions = await tooling.mapAuthoring()
    let request = captured ? schemaRequest(captured.source.action, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requestBytes)), definitions)
      : schemaRequest(action, raw, definitions)
    const browserInput = { action, request, archiveBase64: archive?.toString('base64'), budget, draft: stage === 'draft', deferPreview, geometry }
    if (action === 'inspect') return (await call(await open(), browserInput)).result
    if (action === 'diagnose') {
      const { result } = await call(await open(), browserInput)
      const { geometry: shapes, scene, ...report } = result
      return { ...report, scene: { boundsMm: scene.boundsMm, counts: scene.counts },
        ...(geometry ? { geometry: shapes } : {}), elapsedMs: milliseconds(started) }
    }
    let traced, referenceOverlay, openedReference, savedOverlay
    if (action === 'reference') {
      assert(image !== undefined && output !== undefined, '请指定本地原图和新输出目录。')
      const reference = await readBounded(image, referenceImageLimit)
      openedReference = await open()
      const { result, overlayBase64 } = await call(openedReference, { ...browserInput, referenceBase64: reference.toString('base64') })
      const { request: reusable, ...report } = result
      traced = { ...report, sourceSha256: digest(reference), elapsedMs: milliseconds(started) }
      referenceOverlay = Buffer.from(overlayBase64, 'base64')
      assert(referenceOverlay.length > 0 && referenceOverlay.length <= referenceImageLimit, '参考叠图超过图片字节预算。')
      requestBytes = Buffer.from(json(reusable))
      if (referenceStage !== undefined) {
        action = 'generate'
        stage = mapStage(referenceStage)
        request = schemaRequest(action, reusable, definitions)
        requestBytes = Buffer.from(json(request))
        Object.assign(browserInput, { action, request, draft: stage === 'draft' })
      }
    }
    if (action === 'reference') {
      await closeBrowser()
      checkCurrent()
      await fs.mkdir(output, { mode: 0o700 })
      const saved = await saveFile('request.json', requestBytes, MAX_MAP_REQUEST_BYTES)
      const overlay = copyDelivery ? await saveFile('overlay.png', referenceOverlay, referenceImageLimit)
        : (await cachePreviews({ overlay: referenceOverlay })).overlay
      const receipt = { format: 'sceneweave-map-authoring-result', version: 1, action, status: 'traced',
        ...traced, files: { request: saved.record, overlay: overlay.record }, storage, elapsedMs: milliseconds(started) }
      checkCurrent()
      await fs.writeFile(path.join(output, 'result.json'), json(receipt), { flag: 'wx', mode: 0o600 })
      return { ...receipt, ...compactMapReference(traced), output, storage: { ...storage, receiptBytes: Buffer.byteLength(json(receipt)) },
        paths: { request: saved.path, overlay: overlay.path } }
    }
    const { workflowBinding } = await tooling.workflows()
    const workflow = workflowBinding(definitions.MAP_AUTHORING_WORKFLOW)
    const { assertTaskBudget } = await tooling.budget()
    assert(output !== undefined, '需要新输出目录。')
    checkCurrent()
    await fs.mkdir(output, { mode: 0o700 })
    outputOwned = true
    outputDirectory = await fs.realpath(output)
    record = { format: 'sceneweave-map-authoring-result', version: 1, action, status: 'running',
      startedAt: new Date().toISOString(), workflow, budget, modelRequests: 0, review: 'pending',
      storage, ...(deferPreview ? { previewState: 'deferred' } : {}),
      ...(archive ? { parentArchiveSha256: digest(archive) } : {}), ...(captured ? { source: captured.source } : {}) }
    await fs.writeFile(path.join(output, 'result.json'), json(record), { flag: 'wx', mode: 0o600 })
    let savedRequest = captured ? useCandidate(captured.request) : await saveFile('request.json', requestBytes, MAX_MAP_REQUEST_BYTES)
    record.files = { request: savedRequest.record }
    if (traced) {
      savedOverlay = (await cachePreviews({ overlay: referenceOverlay })).overlay
      record = { ...record, reference: traced, files: { ...record.files, overlay: savedOverlay.record } }
      await replaceResult(output, record, { checkCurrent })
      const unresolved = traced.issues.filter(issue => issue.kind === 'design')
      if (stage === 'complete' && unresolved.length) throw Object.assign(new Error('参考图仍有未落在有效陆地上的设计标记。请按叠图调整后重试。'),
        { code: 'reference_design_unresolved', details: { issues: unresolved } })
    }
    let projectBytes, previewBytes, obliqueBytes, diagnosticBytes, previewFailure, diagnosisGeometry, displayWorkMs = 0
    let savedProject, savedTop, savedOblique, savedDiagnostic
    if (captured) {
      savedProject = useCandidate(captured.project)
      if (captured.preview) savedTop = useCandidate(captured.preview)
      if (captured.oblique) savedOblique = useCandidate(captured.oblique)
      record = { ...record, projectHash: captured.projectHash, floorId: captured.floorId, expectedOblique: captured.expectedOblique,
        source: { ...captured.source, previews: captured.cacheMiss ? 'redraw' : previews } }
      if (previews === 'redraw' || captured.cacheMiss) {
        phase = 'preview'
        const drawing = performance.now(), opened = await open()
        record.browser = opened.info
        const fresh = await call(opened, { action: 'verify', budget, request, archiveBase64: savedProject.bytes.toString('base64'),
          verify: { projectHash: captured.projectHash, floorId: captured.floorId, sourceAction: captured.source.action, redraw: true } })
        await closeBrowser()
        displayWorkMs = Math.ceil(performance.now() - drawing)
        previewBytes = savedTop ? undefined : Buffer.from(fresh.previewBase64, 'base64')
        obliqueBytes = !savedOblique && fresh.obliqueBase64 ? Buffer.from(fresh.obliqueBase64, 'base64') : undefined
        if (previews === 'keep') {
          for (const [key, bytes] of Object.entries({ preview: previewBytes, oblique: obliqueBytes })) {
            const expected = captured.previews[key]
            if (bytes && expected) assert(bytes.length === expected.byteLength && digest(bytes) === expected.sha256,
              '已回收的草稿图与重绘不同。若要复核新画面，请使用 --previews redraw。')
          }
        }
        record.expectedOblique = fresh.review.oblique
      }
      if (captured.expectedOblique && !savedOblique && !obliqueBytes) {
        previewFailure = { code: 'oblique_render_failed', message: '候选缺少请求的斜俯视。使用 map verify --previews redraw 从同一工程重绘。' }
      }
    } else {
      phase = action
      const opened = openedReference ?? await open()
      record.browser = opened.info
      if (!deferPreview && (stage === 'draft' || traced)) await opened.page.exposeFunction('__sceneweavePublishMapTop', async partial => {
        checkCurrent()
        assert(!savedProject && !savedTop, '制图草稿的首图已落盘。')
        savedProject = await saveFile('map.sceneweave', Buffer.from(partial.archiveBase64, 'base64'))
        const top = Buffer.from(partial.previewBase64, 'base64')
        savedTop = (await cachePreviews({ preview: top, overlay: savedOverlay?.bytes })).preview
        const { projectHash, floorId, title, revision, expectedOblique } = partial
        const firstPreviewMs = milliseconds(started)
        record = { ...record, projectHash, floorId, title, revision, expectedOblique, topReadyAt: new Date().toISOString(), firstPreviewMs,
          files: { ...record.files, project: savedProject.record, preview: savedTop.record } }
        await replaceResult(output, record, { checkCurrent })
        progress?.({ phase: 'top', preview: savedTop.path, project: savedProject.path,
          elapsedMs: firstPreviewMs })
      })
      const generated = await call(opened, browserInput)
      const { profile, usage, timings, geometry: shapes, ...report } = generated.result
      diagnosisGeometry = shapes
      displayWorkMs = Math.ceil(timings.packageExportMs + timings.previewMs)
      record = { ...record, ...report, profile, timings,
        usage: assertTaskBudget(profile, { ...usage, activeExecutionMs: usage.activeExecutionMs + displayWorkMs }) }
      projectBytes = savedProject ? undefined : Buffer.from(generated.archiveBase64, 'base64')
      previewBytes = savedTop || deferPreview ? undefined : Buffer.from(generated.previewBase64, 'base64')
      obliqueBytes = generated.obliqueBase64 && Buffer.from(generated.obliqueBase64, 'base64')
      diagnosticBytes = generated.diagnosticBase64 && Buffer.from(generated.diagnosticBase64, 'base64')
      previewFailure = generated.previewFailure
      // A separate process starts from the same on-disk bytes after both
      // generation canvases and the earlier graphics/runtime state are gone.
      await closeBrowser()
    }
    phase = 'save'
    checkCurrent()
    savedProject ??= await saveFile('map.sceneweave', projectBytes)
    if (captured) {
      if (previewBytes) savedTop = { bytes: previewBytes, record: describeMapArtifact('preview.png', previewBytes, 'cache') }
      if (obliqueBytes) savedOblique = { bytes: obliqueBytes, record: describeMapArtifact('oblique.png', obliqueBytes, 'cache') }
    } else {
      if (previewBytes || obliqueBytes || diagnosticBytes) {
        const cached = await cachePreviews({ preview: previewBytes ?? savedTop?.bytes,
          oblique: obliqueBytes, diagnostic: diagnosticBytes, overlay: savedOverlay?.bytes })
        savedTop ??= cached.preview
        savedOblique ??= cached.oblique
        savedDiagnostic = cached.diagnostic
      }
    }
    assert(savedTop || deferPreview, '候选缺少可复核的正俯视预览。')
    record = { ...record, candidateReadyAt: new Date().toISOString(),
      files: { ...record.files, project: savedProject.record, ...(savedTop?.path ? { preview: savedTop.record } : {}),
        ...(savedOblique?.path ? { oblique: savedOblique.record } : {}),
        ...(savedDiagnostic ? { diagnostic: savedDiagnostic.record } : {}) } }
    projectBytes = previewBytes = obliqueBytes = diagnosticBytes = undefined
    if (previewFailure) {
      phase = 'preview'
      throw Object.assign(new Error(previewFailure.message), { code: previewFailure.code })
    }
    let verificationWorkMs = 0
    if (stage === 'complete') {
      phase = 'verify'
      await replaceResult(output, { ...record, status: 'verifying' }, { checkCurrent })
      const verificationStarted = performance.now(), cold = await open(record.browser?.channel)
      record.verificationBrowser = cold.info
      const redrawn = await call(cold, { action: 'verify', budget, request,
        archiveBase64: savedProject.bytes.toString('base64'),
        verify: { projectHash: record.projectHash, floorId: record.floorId, oblique: !!savedOblique, sourceAction: captured?.source.action ?? action } })
      await closeBrowser()
      if (redrawn.review) {
        const { oblique: _oblique, usage, ascentChecks, ...review } = redrawn.review
        const checkedAscents = retainAscentWidthAttempts(ascentChecks, captured?.ascentChecks ?? record.ascentChecks)
        record = { ...record, ...review, ...(checkedAscents && { ascentChecks: checkedAscents }),
          usage: record.usage ?? usage, profile: redrawn.profile }
      }
      const { decodeCanonicalPng } = await tooling.png()
      const compare = (saved, base64, limit) => compareMapPng(saved.bytes, Buffer.from(base64, 'base64'), limit, decodeCanonicalPng)
      const proof = { projectHash: redrawn.projectHash, coldImportMs: redrawn.coldImportMs,
        ...compare(savedTop, redrawn.previewBase64, 2048),
        ...(savedOblique ? { oblique: { projectHash: redrawn.projectHash, ...compare(savedOblique, redrawn.obliqueBase64, 1440) } } : {}) }
      verificationWorkMs = Math.ceil(performance.now() - verificationStarted)
      record.diskVerification = { ...proof, coldRenderAndImportMs: redrawn.renderMs, coldImportAndPixelComparisonMs: verificationWorkMs }
      const firstMismatch = proof.changedPixels ? 'top' : proof.oblique?.changedPixels ? 'oblique' : undefined
      if (firstMismatch) {
        const result = firstMismatch === 'top' ? proof : proof.oblique
        throw Object.assign(new Error(`${firstMismatch} 冷读重绘相差 ${result.changedPixels} 像素。候选文件已保留，可用 map verify 复核原文件。`),
          { code: 'preview_mismatch', details: { view: firstMismatch, audience: 'player', ...result } })
      }
      if (editor) {
        phase = 'editor'
        const editorStarted = performance.now(), launched = await launchBrowser(cold.info.channel)
        browser = launched.browser
        checkCurrent()
        try {
          const reopened = await checkMapInEditor(browser, tooling.origin, savedProject.bytes, !!savedOblique)
          record.editorVerification = { ...reopened, browser: browser.version(), elapsedMs: milliseconds(editorStarted) }
        } catch (error) {
          throw Object.assign(new Error(`普通编辑器重开失败：${error.message}`), { code: 'editor_reopen_failed' })
        }
        await closeBrowser()
        verificationWorkMs += milliseconds(editorStarted)
      }
      record.usage = assertTaskBudget(record.profile, { ...record.usage,
        activeExecutionMs: record.usage.activeExecutionMs + verificationWorkMs + (record.source?.previews === 'redraw' ? displayWorkMs : 0) })
    }
    if (captured && !copyDelivery && (!savedTop.path || savedOblique && !savedOblique.path)) {
      checkCurrent()
      const cached = await cachePreviews({ preview: savedTop.bytes, oblique: savedOblique?.bytes })
      savedTop = cached.preview
      savedOblique = cached.oblique
      record = { ...record, files: { ...record.files, preview: savedTop.record, ...(savedOblique ? { oblique: savedOblique.record } : {}) } }
    }
    if (copyDelivery) {
      phase = 'delivery'
      checkCurrent()
      beforeDelivery = { record, writtenBytes: storage.writtenBytes }
      const copyFile = (name, bytes, maximum) => saveFile(name, bytes, maximum, () => deliveryFiles.push(name))
      if (captured) {
        savedRequest = await copyFile('request.json', savedRequest.bytes, MAX_MAP_REQUEST_BYTES)
        savedProject = await copyFile('map.sceneweave', savedProject.bytes)
      }
      savedTop = await copyFile('preview.png', savedTop.bytes)
      if (savedOblique) savedOblique = await copyFile('oblique.png', savedOblique.bytes)
      if (stage === 'draft') {
        if (savedDiagnostic) savedDiagnostic = await copyFile('diagnostic.png', savedDiagnostic.bytes)
        if (savedOverlay) savedOverlay = await copyFile('overlay.png', savedOverlay.bytes, referenceImageLimit)
      }
      record = { ...record, files: { ...record.files, request: savedRequest.record, project: savedProject.record,
        preview: savedTop.record, ...(savedOblique ? { oblique: savedOblique.record } : {}),
        ...(savedDiagnostic ? { diagnostic: savedDiagnostic.record } : {}), ...(savedOverlay ? { overlay: savedOverlay.record } : {}) } }
    }
    checkCurrent()
    record = { ...record, status: stage, completedAt: new Date().toISOString(),
      timings: { ...record.timings, ...(traced ? { throughReferenceMs: traced.elapsedMs } : {}),
        deliveryWorkMs: displayWorkMs + verificationWorkMs, commandTotalMs: milliseconds(started) },
    }
    await replaceResult(output, record, { checkCurrent, onPublished: () => { published = true } })
    const paths = { project: savedProject.path, ...(savedTop ? { preview: savedTop.path } : {}), request: savedRequest.path,
      ...(savedOblique ? { oblique: savedOblique.path } : {}),
      ...(savedDiagnostic ? { diagnostic: savedDiagnostic.path } : {}),
      ...(savedOverlay ? { overlay: savedOverlay.path } : {}), result: path.join(output, 'result.json') }
    const blockingChecks = [...(record.routeChecks ?? []), ...(record.heightChecks ?? []), ...(record.ascentChecks ?? [])]
      .filter(row => !row.ok && row.required !== false).map(row => ({ id: row.id, issues: row.issues ?? [], ...(!row.issues ? { riseMm: row.riseMm, minRiseMm: row.minRiseMm } : {}) }))
    for (const issue of traced?.issues ?? []) if (issue.kind === 'design') blockingChecks.push({ id: issue.id, issues: [issue] })
    const fileLink = file => '<' + file.split(path.sep).join('/') + '>'
    const markdown = [...(paths.preview ? [`![地图正俯视](${fileLink(paths.preview)})`] : []),
      ...(paths.oblique ? [`![地图斜俯视](${fileLink(paths.oblique)})`] : []),
      `[可编辑工程](${fileLink(paths.project)})`].join('\n\n')
    return { ...record, ...(traced ? { reference: compactMapReference(traced) } : {}), ...(diagnosisGeometry ? { geometry: diagnosisGeometry } : {}), output, paths,
      storage: { ...storage, receiptBytes: Buffer.byteLength(json(record)) },
      delivery: { verified: stage === 'complete', editorReopened: !!record.editorVerification, blockingChecks, markdown,
        ...(stage !== 'complete' ? { candidate: output, next: blockingChecks.length ? 'revise' : 'verify' } : {}) } }
  } catch (error) {
    const message = stopReason ?? (error.message || '浏览器或制图工具中止。请检查此阶段回执和可用内存。')
    if (outputOwned && record && !published) {
      if (deliveryFiles.length) {
        for (const file of deliveryFiles) await fs.rm(path.join(output, file), { force: true }).catch(() => {})
        record = beforeDelivery.record
        // Keep the accounting accurate even if the filesystem prevented cleanup.
        const remaining = await Promise.all(deliveryFiles.map(file => fs.stat(path.join(output, file)).then(value => value.size, () => 0)))
        storage.writtenBytes = beforeDelivery.writtenBytes + remaining.reduce((sum, size) => sum + size, 0)
      }
      await replaceResult(output, { ...record, status: 'failed', completedAt: new Date().toISOString(),
        error: { phase, code: stopReason ? 'map_interrupted' : error.code ?? 'map_authoring_failed', message,
          ...(error.details ? { details: error.details } : {}),
          ...(error.issues ? { issues: error.issues } : {}) },
        timings: { ...record.timings, commandTotalMs: milliseconds(started) } }).catch(() => {})
    }
    if (stopReason || !error.message) throw new Error(message)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCancel)
    try { await browser?.close() } finally { await tooling?.close() }
  }
}

export async function runMapCli(args) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(`${mapUsage}\n`); return }
  const options = parseMapCli(args), { action, value } = options
  if (['example', 'schema', 'capabilities'].includes(action)) {
    const output = await useMapDefinitions(definitions => {
      if (action === 'example') return definitions.mapAuthoringExample(value)
      if (action === 'schema') return definitions.mapAuthoringCapabilities().schemas[value]
      const { schemas: _schemas, ...description } = definitions.mapAuthoringCapabilities()
      return { ...description, schemaCommand: 'node tools/harness/sceneweave.mjs map schema reference|generate|inspect|edit' }
    })
    process.stdout.write(json(output))
    return
  }
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  try {
    const request = options.input ? await readRequest(options.input, MAX_MAP_REQUEST_BYTES) : options.request
    if (options.output) await fs.mkdir(path.dirname(options.output), { recursive: true })
    process.stdout.write(json(await executeMap({ ...options, request, signal: controller.signal,
      progress: ({ preview, elapsedMs }) => process.stderr.write(`首张实际预览已保存（${elapsedMs} ms） ${preview}\n`) })))
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
  }
}
