import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { startHarnessTooling } from '../harness/tooling.mjs'
import { verifyDiskDelivery } from '../harness/browser.mjs'
import { readBounded, replaceResult, writeVerified } from '../harness/io.mjs'
import { executeLocalSegmentation, LOCAL_SEGMENTATION_TOOL } from './local-tool.mjs'
import { readWorkflowCompanion, writeWorkflowCompanion } from '../harness/workflow-checkpoint.mjs'
import { imageToolEffect, runImageRequestQueue } from './request-queue.mjs'
import { imageCheckpointSuffix, readImageCheckpoint, saveImageCheckpoint } from './checkpoint.mjs'
import { saveReviewImages } from './review-artifacts.mjs'

const usage = 'node tools/image-import/server.mjs (--image ABS_IMAGE --license-file ABS_LICENSE --attribution TEXT | --resume ABS_WORK_PACKAGE_OR_LOCAL_CHECKPOINT) --output EXISTING_OUTPUT_DIRECTORY [--local-model-dir ABS_DIR --python ABS_PYTHON [--python-path ABS_DEPENDENCY_DIR]]'

function parseOptions(args) {
  if (args.length === 1 && args[0] === '--help') return null
  const values = new Map()
  const allowed = ['--image', '--license-file', '--attribution', '--output', '--resume', '--local-model-dir', '--python', '--python-path']
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!allowed.includes(key) || !value || values.has(key)) throw new Error(usage)
    values.set(key, value)
  }
  const resumed = values.has('--resume')
  const local = values.has('--local-model-dir')
  const extras = ['--local-model-dir', '--python', '--python-path'].filter(key => values.has(key)).length
  if ((resumed ? values.size - extras !== 2 || !path.isAbsolute(values.get('--resume')) || !path.isAbsolute(values.get('--output') ?? '')
    : values.size - extras !== 4 || ['--image', '--license-file', '--output'].some(key => !path.isAbsolute(values.get(key) ?? '')))
    || (local ? ['--local-model-dir', '--python'].some(key => !path.isAbsolute(values.get(key) ?? '')) : extras > 0)
    || values.has('--python-path') && !path.isAbsolute(values.get('--python-path'))) {
    throw new Error(usage)
  }
  return {
    image: values.get('--image'),
    licenseFile: values.get('--license-file'),
    attribution: values.get('--attribution'),
    output: values.get('--output'),
    resume: values.get('--resume'),
    localModelDir: values.get('--local-model-dir'), python: values.get('--python'), pythonPath: values.get('--python-path'),
  }
}

const send = value => process.stdout.write(JSON.stringify(value) + '\n')
const sendError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })
const imageWorkflowId = 'sceneweave-image-items'
const previousImageWorkflows = new Map([
  [2, 'a07bc0d66ef8470902074e9883059fd48e8be5d1e14e44ac14d65b55bff272e7'],
  [3, '80e1d16a2fd946693efb6371f6ae7ecf8672a6c4fcef267380a710563a1a541c'],
])
const reviewTools = new Set(['image_import_analyze_repair', 'image_import_enhancement_candidates', 'image_import_matte_candidates',
  'image_import_subject_candidates', 'image_import_surface_candidate', 'image_import_local_segment', 'image_import_build_project'])

function resumeImageWorkflow(raw, sdk) {
  // Earlier retention and delivery instructions use the same work state.
  if (raw?.id === imageWorkflowId && previousImageWorkflows.has(raw.version) && raw.definitionHash === previousImageWorkflows.get(raw.version)
    && Object.keys(raw).sort().join(',') === 'definitionHash,id,version') return sdk.workflowBinding(imageWorkflowId)
  return sdk.assertWorkflowBinding(raw)
}

/** The browser session owns one captured image and applies tools serially. */
async function executeInBrowser({ name, input }) {
  let result
  try { result = await window.imageImportTools.execute(name, input) }
  catch (error) {
    const code = typeof error?.code === 'string' ? error.code : error?.name === 'AbortError' ? 'cancelled' : 'image-import-failed'
    const nextAction = code === 'stale_generation' ? 'read_current_context' : code === 'stale_candidate' ? 'refresh_candidate' : undefined
    return { toolError: { code, message: error instanceof Error ? error.message : String(error), ...(nextAction ? { nextAction } : {}) } }
  }
  const encode = bytes => {
    let text = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(text)
  }
  if (name === 'image_import_export_work') return { workBase64: encode(result.bytes), generation: result.generation }
  if (name === 'image_import_analyze_repair') {
    const { bytes, ...metadata } = result
    return { neighborhood: { ...metadata, reviewBase64: encode(bytes) } }
  }
  if (name === 'image_import_enhancement_candidates' || name === 'image_import_matte_candidates' || name === 'image_import_subject_candidates' || name === 'image_import_surface_candidate') {
    const { sourceBytes, candidates, ...metadata } = result
    return { enhancements: { ...metadata, sourceBase64: encode(sourceBytes), candidates: candidates.map(candidate => {
      const { bytes, reviewBytes, coverageBytes, ...info } = candidate
      return { ...info, pngBase64: encode(bytes), reviewBase64: encode(reviewBytes), ...(coverageBytes ? { coverageBase64: encode(coverageBytes) } : {}) }
    }) } }
  }
  if (name === 'image_import_preview' || name === 'image_import_item_preview') {
    const { bytes, ...metadata } = result
    return { previewBase64: encode(bytes), ...metadata }
  }
  if (name !== 'image_import_build_project') return { value: result }

  const projectPath = '/src/application/workspace/project.ts'
  const filePath = '/src/shared/project/file.ts'
  const validationPath = '/src/platform/browser/project-validation.ts'
  const hashPath = '/src/shared/project/validate.ts'
  const renderPath = '/src/platform/browser/render/renderer.ts'
  const { toBundle } = await import(projectPath)
  const { exportProject } = await import(filePath)
  const { browserProjectValidation } = await import(validationPath)
  const { projectContentHash } = await import(hashPath)
  const { exportPng } = await import(renderPath)
  const bundle = toBundle(result.project)
  const archive = await exportProject(bundle, browserProjectValidation)
  const png = await exportPng(bundle, { audience: 'player', longEdgePx: 2048 })
  const preview = new Uint8Array(await png.arrayBuffer())
  return {
    archiveBase64: encode(archive),
    previewBase64: encode(preview),
    projectHash: projectContentHash(bundle.project),
    recipe: result.recipe,
    taskId: result.taskId,
    generation: result.generation,
    sourceFidelity: result.sourceFidelity,
    ...(result.subjectDerivation ? { subjectDerivation: result.subjectDerivation } : {}),
    ...(result.surfaceDerivation ? { surfaceDerivation: result.surfaceDerivation } : {}),
  }
}

async function saveCandidate(response, output, context, tooling, workflow, saveImages) {
  const directory = path.join(output, 'candidate-' + response.generation + '-' + randomUUID())
  await fs.mkdir(directory, { mode: 0o700 })
  const record = { status: 'running', workflow, taskId: response.taskId, generation: response.generation,
    source: response.recipe.image, projectHash: response.projectHash, sourceFidelity: response.sourceFidelity,
    ...(response.subjectDerivation ? { subjectDerivation: response.subjectDerivation } : {}),
    ...(response.surfaceDerivation ? { surfaceDerivation: response.surfaceDerivation } : {}) }
  try {
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 })
    const archive = await writeVerified(directory, 'map.sceneweave', Buffer.from(response.archiveBase64, 'base64'))
    const recipe = await writeVerified(directory, 'recipe.json', Buffer.from(JSON.stringify(response.recipe, null, 2) + '\n'))
    const coldPage = await context.newPage()
    let verification
    try {
      await coldPage.goto(tooling.url)
      verification = await coldPage.evaluate(verifyDiskDelivery, {
        archiveBase64: archive.bytes.toString('base64'),
        previewBase64: response.previewBase64,
        expectedProjectHash: response.projectHash,
      })
    } finally {
      await coldPage.close()
    }
    const previews = await saveReviewImages(directory, { preview: { bytes: Buffer.from(response.previewBase64, 'base64') } }, saveImages)
    const completed = { ...record, status: 'complete', verification,
      files: { project: archive.record, preview: previews.files.preview, recipe: recipe.record } }
    await replaceResult(directory, completed)
    return [{ type: 'text', text: JSON.stringify({ ...completed, directory, paths: previews.paths }) }]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Candidate verification failed'
    await replaceResult(directory, { ...record, status: 'failed', error: message }).catch(() => {})
    throw new Error('工程候选写入或冷读失败，记录保留于 ' + directory + '。' + message)
  }
}

async function serve(options) {
  const image = options.resume ? null : await readBounded(options.image, 20 * 1024 * 1024)
  const licenseBytes = options.resume ? null : await readBounded(options.licenseFile, 256 * 1024)
  const licenseText = licenseBytes ? new TextDecoder('utf-8', { fatal: true }).decode(licenseBytes) : ''
  if (!(await fs.stat(options.output)).isDirectory() || !options.resume && (!licenseText.trim() || !options.attribution.trim())) {
    throw new Error(usage)
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const stdinEndListeners = new Set(process.stdin.listeners('end'))
  const tooling = await startHarnessTooling(root, true)
  // Vite normally exits the process at stdin EOF. This MCP host owns EOF and
  // must finish queued requests before closing its private tooling server.
  for (const listener of process.stdin.listeners('end')) {
    if (!stdinEndListeners.has(listener)) process.stdin.removeListener('end', listener)
  }
  let browser
  let lines
  try {
    const [workflowSdk, storageSdk] = await Promise.all([tooling.workflows(), tooling.imageWorkStorage()])
    let work, restoredWorkflow = { status: 'new', binding: null }
    if (options.resume?.endsWith(imageCheckpointSuffix)) {
      const saved = await readImageCheckpoint(options.resume, storageSdk, binding => resumeImageWorkflow(binding, workflowSdk))
      work = Buffer.from(saved.bytes)
      restoredWorkflow = saved
    } else if (options.resume) {
      work = await readBounded(options.resume, 100 * 1024 * 1024)
      restoredWorkflow = await readWorkflowCompanion(options.resume, work, binding => resumeImageWorkflow(binding, workflowSdk))
    }
    const workflow = restoredWorkflow.binding ?? workflowSdk.workflowBinding(imageWorkflowId)
    if (workflow.id !== imageWorkflowId) throw new Error('工作包绑定的主工作流与图片制作入口不符。')
    try { browser = await chromium.launch({ headless: true, ...(process.env.SCENEWEAVE_BROWSER_CHANNEL ? { channel: process.env.SCENEWEAVE_BROWSER_CHANNEL } : {}) }) }
    catch (error) {
      if (process.env.SCENEWEAVE_BROWSER_CHANNEL || !String(error).includes("Executable doesn't exist")) throw error
      browser = await chromium.launch({ headless: true, channel: 'chrome' })
    }
    const context = await browser.newContext({ serviceWorkers: 'block' })
    await context.route('**/*', route => route.request().url().startsWith(tooling.origin + '/') ? route.continue() : route.abort())
    await context.addInitScript(() => {
      IDBFactory.prototype.open = () => { throw new Error('Image tool file host cannot open user databases') }
      IDBFactory.prototype.deleteDatabase = () => { throw new Error('Image tool file host cannot delete user databases') }
    })
    const page = await context.newPage()
    await page.goto(tooling.url)
    const definitions = await page.evaluate(async ({ base64, workBase64, rights, originalName, savedGeneration }) => {
      const sessionPath = '/src/platform/browser/content/image-import-session.ts'
      const schemaPath = '/src/shared/image-import/recipe.ts'
      const { ImageImportToolSession, loadImageImportSource, loadImageImportWorkSource } = await import(sessionPath)
      const unpack = value => Uint8Array.from(atob(value), character => character.charCodeAt(0))
      if (workBase64) {
        const { readBrowserImageWorkPackage } = await import('/src/platform/browser/content/image-workflow-store.ts')
        const work = await readBrowserImageWorkPackage(unpack(workBase64))
        if (savedGeneration !== undefined && work.state.revision !== savedGeneration) throw new Error('工作流伴随记录与工作包实际代次不符。')
        const source = await loadImageImportWorkSource(work)
        source.originalName = work.state.original.name
        window.imageImportTools = new ImageImportToolSession(source, work.state.rights)
        window.imageImportSource = source
        window.imageImportTools.restoreWork(work.state)
      } else {
        const source = await loadImageImportSource(unpack(base64))
        source.originalName = originalName
        window.imageImportTools = new ImageImportToolSession(source, rights)
        window.imageImportSource = source
      }
      return (await import(schemaPath)).IMAGE_IMPORT_TOOLS
    }, { base64: image?.toString('base64'), workBase64: work?.toString('base64'), rights: { licenseText, attribution: options.attribution }, originalName: options.image ? path.basename(options.image) : '',
      savedGeneration: restoredWorkflow.status === 'bound' ? restoredWorkflow.generation : undefined })
    if (options.localModelDir) definitions.push(LOCAL_SEGMENTATION_TOOL)
    for (const tool of definitions) {
      if (!reviewTools.has(tool.name)) continue
      tool.inputSchema = { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, saveImages: {
        type: 'boolean', default: false, description: 'Save standalone PNG files in the result directory. By default review images use a shared, reclaimable cache.',
      } } }
    }
    const workflowTools = definitions.map(tool => ({ name: tool.name, parameters: tool.inputSchema }))
    definitions.push({ name: workflowSdk.WORKFLOW_DISCOVERY_TOOL.name, description: workflowSdk.WORKFLOW_DISCOVERY_TOOL.description,
      inputSchema: workflowSdk.WORKFLOW_DISCOVERY_TOOL.parameters })

    const saveWork = async () => {
      const response = await page.evaluate(executeInBrowser, { name: 'image_import_export_work', input: {} })
      if (response.toolError) throw new Error(response.toolError.message)
      return saveImageCheckpoint(options.output, Buffer.from(response.workBase64, 'base64'), workflow, response.generation,
        storageSdk, workflowSdk.assertWorkflowBinding)
    }

    const handleRequest = async ({ request, error }) => {
      if (error) {
        sendError(null, error.code, error.message)
        return
      }
      // Notifications do not receive a response, including notifications/initialized.
      if (request.id === undefined) return
      if (request.method === 'initialize') {
        send({ jsonrpc: '2.0', id: request.id, result: {
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'sceneweave-image-import', version: '1.0.0' },
        } })
        return
      }
      if (request.method === 'ping') {
        send({ jsonrpc: '2.0', id: request.id, result: {} })
        return
      }
      if (request.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: request.id, result: { tools: definitions } })
        return
      }
      if (request.method !== 'tools/call') {
        sendError(request.id, -32601, 'Unsupported MCP method')
        return
      }
      const params = request.params
      if (!params || !definitions.some(tool => tool.name === params.name)) {
        sendError(request.id, -32602, 'Unknown image import tool')
        return
      }
      try {
        if (params.name === workflowSdk.WORKFLOW_DISCOVERY_TOOL.name) {
          const inspection = await page.evaluate(() => ({ ...window.imageImportTools.inspect(), id: window.imageImportTools.captureWorkState().id }))
          const host = workflowSdk.toolWorkflowHost('image-mcp', workflowTools, { hasImageItems: inspection.draft.layers.length > 0, progress: {
            taskId: inspection.id, generation: inspection.generation, status: 'draft', baselineHash: inspection.image.sha256,
            draftRevision: inspection.generation, lastTool: null, unknown: true, remainingToolCalls: null,
          } })
          const value = workflowSdk.queryWorkflow(params.arguments ?? {}, host)
          send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify({ ...value, binding: workflow,
            resumeBindingStatus: restoredWorkflow.status,
            continuation: '本机断点可传给 --resume。跨电脑使用 image_import_export_work，带上完整工作包和 .workflow.json。详细进度见 image_import_workflow。' }) }] } })
          return
        }
        let input = params.arguments ?? {}, saveImages = false
        if (reviewTools.has(params.name) && Object.hasOwn(input, 'saveImages')) {
          const { saveImages: requested, ...toolInput } = input
          if (typeof requested !== 'boolean') throw new Error('saveImages 须为布尔值。')
          saveImages = requested
          input = toolInput
        }
        if (params.name === LOCAL_SEGMENTATION_TOOL.name) {
          const content = await executeLocalSegmentation(page, options, input, saveImages)
          send({ jsonrpc: '2.0', id: request.id, result: { content } })
          return
        }
        const response = await page.evaluate(executeInBrowser, { name: params.name, input })
        if (response.toolError) {
          send({ jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(response.toolError) }] } })
          return
        }
        let content
        if (response.neighborhood) {
          const { reviewBase64, ...metadata } = response.neighborhood
          const directory = path.join(options.output, `neighborhood-${metadata.generation}-${randomUUID()}`)
          await fs.mkdir(directory, { mode: 0o700 })
          const { files, paths } = await saveReviewImages(directory, { review: { bytes: Buffer.from(reviewBase64, 'base64'), sha256: metadata.reviewSha256 } }, saveImages)
          const record = { ...metadata, review: files.review }
          const written = await writeVerified(directory, 'analysis.json', Buffer.from(JSON.stringify(record, null, 2) + '\n'))
          content = [{ type: 'text', text: JSON.stringify({ path: path.join(directory, 'analysis.json'), sha256: written.record.sha256, ...record, paths }) },
            { type: 'image', mimeType: 'image/png', data: reviewBase64 }]
        } else if (response.enhancements) {
          const { sourceBase64, candidates, ...metadata } = response.enhancements
          const directory = path.join(options.output, `enhancement-${metadata.generation}-${randomUUID()}`)
          await fs.mkdir(directory, { mode: 0o700 })
          const previews = { source: { bytes: Buffer.from(sourceBase64, 'base64'), sha256: metadata.sourceItemSha256 } }
          const records = [], images = []
          for (const [index, candidate] of candidates.entries()) {
            const { pngBase64, reviewBase64, coverageBase64, ...info } = candidate
            const key = `candidate-${index}`
            previews[key] = { bytes: Buffer.from(pngBase64, 'base64'), sha256: info.pngSha256 }
            previews[key + '-review'] = { bytes: Buffer.from(reviewBase64, 'base64') }
            if (coverageBase64) previews[key + '-coverage'] = { bytes: Buffer.from(coverageBase64, 'base64'), sha256: info.coverageSha256 }
            records.push({ ...info, key })
            images.push({ type: 'image', mimeType: 'image/png', data: reviewBase64 })
          }
          const { files, paths } = await saveReviewImages(directory, previews, saveImages)
          const record = { ...metadata, source: files.source, candidates: records.map(({ key, ...info }) => ({
            ...info, png: files[key], review: files[key + '-review'],
            ...(files[key + '-coverage'] ? { coverage: files[key + '-coverage'] } : {}),
          })) }
          const written = await writeVerified(directory, 'candidates.json', Buffer.from(JSON.stringify(record, null, 2)+'\n'))
          content = [{ type: 'text', text: JSON.stringify({ path: path.join(directory, 'candidates.json'), sha256: written.record.sha256, ...record, paths }) }, ...images]
        } else if (response.workBase64) {
          const filename = `work-${response.generation}-${randomUUID()}.sceneweave-image-work`
          const written = await writeVerified(options.output, filename, Buffer.from(response.workBase64, 'base64'))
          const companion = await writeWorkflowCompanion(path.join(options.output, filename), written.bytes, workflow, response.generation)
          content = [{ type: 'text', text: JSON.stringify({ path: path.join(options.output, filename), sha256: written.record.sha256, generation: response.generation,
            workflow, workflowCompanion: path.join(options.output, companion.record.file),
            storage: { writtenBytes: written.record.byteLength + companion.record.byteLength, reusedBytes: 0 } }) }]
        } else if (response.archiveBase64) {
          content = await saveCandidate(response, options.output, context, tooling, workflow, saveImages)
        } else if (response.previewBase64) {
          content = [
            { type: 'image', mimeType: 'image/png', data: response.previewBase64 },
            { type: 'text', text: JSON.stringify(Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'previewBase64'))) },
          ]
        } else {
          content = [{ type: 'text', text: JSON.stringify(response.value) }]
        }
        if (imageToolEffect(params.name, params.arguments) === 'checkpoint') {
          try { content.push({ type: 'text', text: JSON.stringify({ checkpoint: await saveWork() }) }) }
          catch (error) { content.push({ type: 'text', text: JSON.stringify({ checkpointError: String(error), nextAction: '当前候选仍在进程中；先导出工作包再结束会话。' }) }) }
        }
        send({ jsonrpc: '2.0', id: request.id, result: { content } })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image import tool failed'
        send({ jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: message }] } })
      }
    }
    lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    await runImageRequestQueue(lines, handleRequest)
  } finally {
    lines?.close()
    try { await browser?.close() } finally { await tooling.close() }
  }
}

const options = parseOptions(process.argv.slice(2))
if (options) await serve(options)
else process.stdout.write(usage + '\n')
