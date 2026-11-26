import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { assert, digest, MAX_ARCHIVE_BYTES, MAX_MAP_REQUEST_BYTES, readBounded, readRequest, replaceResult, writeVerified } from './io.mjs'
import { openHarnessContext, startHarnessTooling } from './tooling.mjs'
import { runMapInBrowser } from './browser.mjs'
import { captureMapCandidate, compareMapPng } from './map-verification.mjs'
import { checkMapInEditor } from './map-editor.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const budgetIds = ['small', 'standard', 'expanded']
const json = value => `${JSON.stringify(value, null, 2)}\n`
const milliseconds = start => Math.round(performance.now() - start)
const allowance = 'map-authoring'
const referenceImageLimit = 20 * 1024 * 1024
const compactMapReference = ({ regions, lakes, ...report }) => {
  const countPoints = ({ boundary, ...row }) => ({ ...row, points: boundary.length })
  return { ...report, regions: regions.map(countPoints), lakes: lakes.map(countPoints) }
}

export const mapUsage = `Sceneweave map authoring
  node tools/harness/sceneweave.mjs map capabilities
  node tools/harness/sceneweave.mjs map schema reference|generate|inspect|edit
  node tools/harness/sceneweave.mjs map reference --image ABS_IMAGE --input ABS_GUIDE_JSON --output NEW_ABS_DIR --allow map-authoring [--stage draft|complete] [--budget standard]
  node tools/harness/sceneweave.mjs map diagnose --input ABS_JSON --allow map-authoring [--budget standard] [--geometry full]
  node tools/harness/sceneweave.mjs map example [landscape-reference|landscape-ascent|landscape|interior|forest|volcano|mixed|island|coast|layout]
  node tools/harness/sceneweave.mjs map generate --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring [--stage draft|complete] [--budget standard]
  node tools/harness/sceneweave.mjs map inspect --project ABS_SCENEWEAVE --allow map-authoring [--floor ID] [--query TEXT] [--limit N] [--offset N]
  node tools/harness/sceneweave.mjs map edit --project ABS_SCENEWEAVE --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring [--stage draft|complete] [--budget standard]
  node tools/harness/sceneweave.mjs map verify --candidate ABS_DIR --output NEW_ABS_DIR --allow map-authoring [--previews keep|redraw] [--editor reopen] [--budget standard]

Use reference --stage draft for an editable map and reference overlay in one call.
Use diagnose to check geometry without drawing or packaging.
Use draft for a quick real preview, then verify the saved candidate for delivery.
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
    const flags = readMapFlags(args, ['--allow', '--input', '--budget', ...(action === 'reference' ? ['--image', '--output', '--stage'] : ['--geometry'])])
    assert(flags.get('--allow') === allowance, 'Expected explicit --allow map-authoring')
    assert(!flags.has('--geometry') || flags.get('--geometry') === 'full', 'Choose --geometry full for detailed coordinates.')
    return { action, input: absolute(flags, '--input'), budget: mapBudget(flags.get('--budget')),
      ...(flags.has('--geometry') ? { geometry: true } : {}),
      ...(action === 'reference' ? { image: absolute(flags, '--image'), output: absolute(flags, '--output'),
        referenceStage: flags.has('--stage') ? mapStage(flags.get('--stage')) : undefined } : {}) }
  }
  if (action === 'verify') {
    const flags = readMapFlags(args, ['--allow', '--candidate', '--output', '--budget', '--previews', '--editor'])
    assert(flags.get('--allow') === allowance, 'Expected explicit --allow map-authoring')
    assert(!flags.has('--editor') || flags.get('--editor') === 'reopen', 'Choose --editor reopen.')
    return { action, candidate: absolute(flags, '--candidate'), output: absolute(flags, '--output'),
      budget: mapBudget(flags.get('--budget')), previews: mapPreviews(flags.get('--previews')), ...(flags.has('--editor') ? { editor: true } : {}) }
  }
  const flags = readMapFlags(args, ['--allow', ...(action !== 'generate' ? ['--project'] : []),
    ...(action === 'inspect' ? ['--floor', '--query', '--offset', '--limit'] : ['--input', '--output', '--budget', '--stage'])])
  assert(flags.get('--allow') === allowance, 'Expected explicit --allow map-authoring')
  const project = action !== 'generate' ? absolute(flags, '--project') : undefined
  if (action === 'inspect') return { action, project, request: Object.fromEntries([
    ['floorId', flags.get('--floor')], ['query', flags.get('--query')],
    ['offset', flags.has('--offset') ? Number(flags.get('--offset')) : undefined],
    ['limit', flags.has('--limit') ? Number(flags.get('--limit')) : undefined],
  ].filter(([, value]) => value !== undefined)) }
  return { action, project, input: absolute(flags, '--input'), output: absolute(flags, '--output'),
    stage: mapStage(flags.get('--stage')), budget: mapBudget(flags.get('--budget')) }
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
  referenceStage, previews = 'keep', editor = false, geometry = false, signal, progress }) {
  assert(['reference', 'diagnose', 'generate', 'inspect', 'edit', 'verify'].includes(action), 'Unknown map operation')
  mapStage(stage)
  mapPreviews(previews)
  assert(stage === 'complete' || action === 'generate' || action === 'edit', 'This operation requires the complete stage.')
  assert(referenceStage === undefined || action === 'reference', '只可从参考图生成时指定参考图阶段。')
  assert(previews === 'keep' || action === 'verify', 'Redraw requires a saved candidate.')
  assert(typeof editor === 'boolean' && (!editor || action === 'verify'), 'Editor reopening requires a saved candidate.')
  const started = performance.now()
  let tooling, browser, outputOwned = false, record, stopReason, published = false, phase = 'input'
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
    const captured = action === 'verify' ? await captureMapCandidate(candidate, previews) : undefined
    let requestBytes = captured?.request ?? Buffer.from(JSON.stringify(raw) ?? '')
    assert(requestBytes.length > 0 && requestBytes.length <= MAX_MAP_REQUEST_BYTES,
      `制图请求字节数 ${requestBytes.length}，允许 1–${MAX_MAP_REQUEST_BYTES} 字节。`)
    const archive = project ? await readBounded(project, MAX_ARCHIVE_BYTES) : undefined
    tooling = await startHarnessTooling(root, true, editor)
    const definitions = await tooling.mapAuthoring()
    let request = captured ? schemaRequest(captured.source.action, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requestBytes)), definitions)
      : schemaRequest(action, raw, definitions)
    const browserInput = { action, request, archiveBase64: archive?.toString('base64'), budget, draft: stage === 'draft' }
    if (action === 'inspect') return (await call(await open(), browserInput)).result
    if (action === 'diagnose') {
      const { result } = await call(await open(), browserInput)
      const { geometry: shapes, scene, ...report } = result
      return { ...report, scene: { boundsMm: scene.boundsMm, counts: scene.counts },
        ...(geometry ? { geometry: shapes } : {}), elapsedMs: milliseconds(started) }
    }
    let traced, referenceOverlay, openedReference
    if (action === 'reference') {
      assert(image !== undefined && output !== undefined, '请指定本地原图和新输出目录。')
      const reference = await readBounded(image, referenceImageLimit)
      openedReference = await open()
      const { result, overlayBase64 } = await call(openedReference, { ...browserInput, referenceBase64: reference.toString('base64') })
      const { request: reusable, ...report } = result
      traced = { ...report, sourceSha256: digest(reference), elapsedMs: milliseconds(started) }
      referenceOverlay = Buffer.from(overlayBase64, 'base64')
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
      const saved = await writeVerified(output, 'request.json', requestBytes, MAX_MAP_REQUEST_BYTES)
      const overlay = await writeVerified(output, 'overlay.png', referenceOverlay, referenceImageLimit)
      const receipt = { format: 'sceneweave-map-authoring-result', version: 1, action, status: 'traced',
        ...traced, files: { request: saved.record, overlay: overlay.record }, elapsedMs: milliseconds(started) }
      checkCurrent()
      await fs.writeFile(path.join(output, 'result.json'), json(receipt), { flag: 'wx', mode: 0o600 })
      return { ...receipt, ...compactMapReference(traced), output,
        paths: { request: path.join(output, 'request.json'), overlay: path.join(output, 'overlay.png') } }
    }
    const { workflowBinding } = await tooling.workflows()
    const workflow = workflowBinding(definitions.MAP_AUTHORING_WORKFLOW)
    const { assertTaskBudget } = await tooling.budget()
    assert(output !== undefined, '需要新输出目录。')
    checkCurrent()
    await fs.mkdir(output, { mode: 0o700 })
    outputOwned = true
    record = { format: 'sceneweave-map-authoring-result', version: 1, action, status: 'running',
      startedAt: new Date().toISOString(), workflow, budget, modelRequests: 0, review: 'pending',
      ...(archive ? { parentArchiveSha256: digest(archive) } : {}), ...(captured ? { source: captured.source } : {}) }
    await fs.writeFile(path.join(output, 'result.json'), json(record), { flag: 'wx', mode: 0o600 })
    const savedRequest = await writeVerified(output, 'request.json', requestBytes, MAX_MAP_REQUEST_BYTES)
    record.files = { request: savedRequest.record }
    if (traced) {
      const overlay = await writeVerified(output, 'overlay.png', referenceOverlay, referenceImageLimit)
      record = { ...record, reference: traced, files: { ...record.files, overlay: overlay.record } }
      await replaceResult(output, record, { checkCurrent })
      const unresolved = traced.issues.filter(issue => issue.kind === 'design')
      if (stage === 'complete' && unresolved.length) throw Object.assign(new Error('参考图仍有未落在有效陆地上的设计标记。请按叠图调整后重试。'),
        { code: 'reference_design_unresolved', details: { issues: unresolved } })
    }
    let projectBytes, previewBytes, obliqueBytes, diagnosticBytes, previewFailure, displayWorkMs = 0
    let savedProject, savedTop
    if (captured) {
      projectBytes = captured.project; previewBytes = captured.preview; obliqueBytes = captured.oblique
      record = { ...record, projectHash: captured.projectHash, floorId: captured.floorId, expectedOblique: captured.expectedOblique,
        source: { ...captured.source, previews } }
      if (previews === 'redraw') {
        phase = 'preview'
        const drawing = performance.now(), opened = await open()
        record.browser = opened.info
        const fresh = await call(opened, { action: 'verify', budget, request, archiveBase64: projectBytes.toString('base64'),
          verify: { projectHash: captured.projectHash, floorId: captured.floorId, sourceAction: captured.source.action, redraw: true } })
        await closeBrowser()
        displayWorkMs = Math.ceil(performance.now() - drawing)
        previewBytes = Buffer.from(fresh.previewBase64, 'base64')
        obliqueBytes = fresh.obliqueBase64 && Buffer.from(fresh.obliqueBase64, 'base64')
        record.expectedOblique = fresh.review.oblique
      } else if (captured.expectedOblique && !obliqueBytes) {
        previewFailure = { code: 'oblique_render_failed', message: '候选缺少请求的斜俯视。使用 map verify --previews redraw 从同一工程重绘。' }
      }
    } else {
      phase = action
      const opened = openedReference ?? await open()
      record.browser = opened.info
      if (stage === 'draft' || traced) await opened.page.exposeFunction('__sceneweavePublishMapTop', async partial => {
        checkCurrent()
        assert(!savedProject && !savedTop, '制图草稿的首图已落盘。')
        savedProject = await writeVerified(output, 'map.sceneweave', Buffer.from(partial.archiveBase64, 'base64'))
        savedTop = await writeVerified(output, 'preview.png', Buffer.from(partial.previewBase64, 'base64'))
        const { projectHash, floorId, title, revision, expectedOblique } = partial
        const firstPreviewMs = milliseconds(started)
        record = { ...record, projectHash, floorId, title, revision, expectedOblique, topReadyAt: new Date().toISOString(), firstPreviewMs,
          files: { ...record.files, project: savedProject.record, preview: savedTop.record } }
        await replaceResult(output, record, { checkCurrent })
        progress?.({ phase: 'top', preview: path.join(output, 'preview.png'), project: path.join(output, 'map.sceneweave'),
          elapsedMs: firstPreviewMs })
      })
      const generated = await call(opened, browserInput)
      const { profile, usage, timings } = generated.result
      displayWorkMs = Math.ceil(timings.packageExportMs + timings.previewMs)
      record = { ...record, ...generated.result,
        usage: assertTaskBudget(profile, { ...usage, activeExecutionMs: usage.activeExecutionMs + displayWorkMs }) }
      projectBytes = savedProject ? undefined : Buffer.from(generated.archiveBase64, 'base64')
      previewBytes = savedTop ? undefined : Buffer.from(generated.previewBase64, 'base64')
      obliqueBytes = generated.obliqueBase64 && Buffer.from(generated.obliqueBase64, 'base64')
      diagnosticBytes = generated.diagnosticBase64 && Buffer.from(generated.diagnosticBase64, 'base64')
      previewFailure = generated.previewFailure
      // A separate process starts from the same on-disk bytes after both
      // generation canvases and the earlier graphics/runtime state are gone.
      await closeBrowser()
    }
    phase = 'save'
    checkCurrent()
    savedProject ??= await writeVerified(output, 'map.sceneweave', projectBytes)
    savedTop ??= await writeVerified(output, 'preview.png', previewBytes)
    const savedOblique = obliqueBytes && await writeVerified(output, 'oblique.png', obliqueBytes)
    const savedDiagnostic = diagnosticBytes && await writeVerified(output, 'diagnostic.png', diagnosticBytes)
    record = { ...record, candidateReadyAt: new Date().toISOString(),
      files: { ...record.files, project: savedProject.record, preview: savedTop.record, ...(savedOblique ? { oblique: savedOblique.record } : {}),
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
        const { oblique: _oblique, usage, ...review } = redrawn.review
        record = { ...record, ...review, usage: record.usage ?? usage, profile: redrawn.profile }
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
        activeExecutionMs: record.usage.activeExecutionMs + verificationWorkMs + (previews === 'redraw' ? displayWorkMs : 0) })
    }
    checkCurrent()
    record = { ...record, status: stage, completedAt: new Date().toISOString(),
      timings: { ...record.timings, ...(traced ? { throughReferenceMs: traced.elapsedMs } : {}),
        deliveryWorkMs: displayWorkMs + verificationWorkMs, commandTotalMs: milliseconds(started) },
    }
    await replaceResult(output, record, { checkCurrent, onPublished: () => { published = true } })
    const paths = { project: path.join(output, 'map.sceneweave'), preview: path.join(output, 'preview.png'), request: path.join(output, 'request.json'),
      ...(savedOblique ? { oblique: path.join(output, 'oblique.png') } : {}),
      ...(savedDiagnostic ? { diagnostic: path.join(output, 'diagnostic.png') } : {}),
      ...(traced ? { overlay: path.join(output, 'overlay.png') } : {}), result: path.join(output, 'result.json') }
    const blockingChecks = [...(record.routeChecks ?? []), ...(record.heightChecks ?? []), ...(record.ascentChecks ?? [])]
      .filter(row => !row.ok && row.required !== false).map(row => ({ id: row.id, issues: row.issues ?? [], ...(!row.issues ? { riseMm: row.riseMm, minRiseMm: row.minRiseMm } : {}) }))
    for (const issue of traced?.issues ?? []) if (issue.kind === 'design') blockingChecks.push({ id: issue.id, issues: [issue] })
    const fileLink = file => '<' + file.split(path.sep).join('/') + '>'
    const markdown = [`![地图正俯视](${fileLink(paths.preview)})`,
      ...(paths.oblique ? [`![地图斜俯视](${fileLink(paths.oblique)})`] : []),
      `[可编辑工程](${fileLink(paths.project)})`].join('\n\n')
    return { ...record, ...(traced ? { reference: compactMapReference(traced) } : {}), output, paths,
      delivery: { verified: stage === 'complete', editorReopened: !!record.editorVerification, blockingChecks, markdown,
        ...(stage !== 'complete' ? { candidate: output, next: blockingChecks.length ? 'revise' : 'verify' } : {}) } }
  } catch (error) {
    const message = stopReason ?? (error.message || '浏览器或制图工具中止。请检查此阶段回执和可用内存。')
    if (outputOwned && record && !published) {
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
