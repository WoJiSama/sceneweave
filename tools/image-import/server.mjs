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

const usage = 'node tools/image-import/server.mjs (--image ABS_IMAGE --license-file ABS_LICENSE --attribution TEXT | --resume ABS_WORK_PACKAGE) --output EXISTING_OUTPUT_DIRECTORY [--local-model-dir ABS_DIR --python ABS_PYTHON [--python-path ABS_DEPENDENCY_DIR]]'

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

/** The browser session owns one captured image and applies tools serially. */
async function executeInBrowser({ name, input }) {
  let result
  try { result = await window.imageImportTools.execute(name, input) }
  catch (error) {
    return { toolError: { code: typeof error?.code === 'string' ? error.code : error?.name === 'AbortError' ? 'cancelled' : 'image-import-failed', message: error instanceof Error ? error.message : String(error) } }
  }
  const encode = bytes => {
    let text = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(text)
  }
  if (name === 'image_import_export_work') return { workBase64: encode(result.bytes), generation: result.generation }
  if (name === 'image_import_enhancement_candidates') {
    const { sourceBytes, candidates, ...metadata } = result
    return { enhancements: { ...metadata, sourceBase64: encode(sourceBytes), candidates: candidates.map(candidate => {
      const { bytes, reviewBytes, ...info } = candidate
      return { ...info, pngBase64: encode(bytes), reviewBase64: encode(reviewBytes) }
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
    generation: result.generation,
    sourceFidelity: result.sourceFidelity,
  }
}

async function saveCandidate(response, output, context, tooling) {
  const directory = path.join(output, 'candidate-' + response.generation + '-' + randomUUID())
  await fs.mkdir(directory, { mode: 0o700 })
  const record = { status: 'running', generation: response.generation, projectHash: response.projectHash, sourceFidelity: response.sourceFidelity }
  try {
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 })
    const archive = await writeVerified(directory, 'map.sceneweave', Buffer.from(response.archiveBase64, 'base64'))
    const preview = await writeVerified(directory, 'preview.png', Buffer.from(response.previewBase64, 'base64'))
    await writeVerified(directory, 'recipe.json', Buffer.from(JSON.stringify(response.recipe, null, 2) + '\n'))
    const coldPage = await context.newPage()
    let verification
    try {
      await coldPage.goto(tooling.url)
      verification = await coldPage.evaluate(verifyDiskDelivery, {
        archiveBase64: archive.bytes.toString('base64'),
        previewBase64: preview.bytes.toString('base64'),
        expectedProjectHash: response.projectHash,
      })
    } finally {
      await coldPage.close()
    }
    const completed = { ...record, status: 'complete', verification }
    await replaceResult(directory, completed)
    return [{ type: 'text', text: JSON.stringify({ ...completed, directory }) }]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Candidate verification failed'
    await replaceResult(directory, { ...record, status: 'failed', error: message }).catch(() => {})
    throw new Error('工程候选写入或冷读失败，记录保留于 ' + directory + '。' + message)
  }
}

async function serve(options) {
  const work = options.resume ? await readBounded(options.resume, 100 * 1024 * 1024) : null
  const image = work ? null : await readBounded(options.image, 20 * 1024 * 1024)
  const licenseBytes = work ? null : await readBounded(options.licenseFile, 256 * 1024)
  const licenseText = licenseBytes ? new TextDecoder('utf-8', { fatal: true }).decode(licenseBytes) : ''
  if (!(await fs.stat(options.output)).isDirectory() || !work && (!licenseText.trim() || !options.attribution.trim())) {
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
    const definitions = await page.evaluate(async ({ base64, workBase64, rights, originalName }) => {
      const sessionPath = '/src/platform/browser/content/image-import-session.ts'
      const schemaPath = '/src/shared/image-import/recipe.ts'
      const { ImageImportToolSession, loadImageImportSource, loadImageImportWorkSource } = await import(sessionPath)
      const unpack = value => Uint8Array.from(atob(value), character => character.charCodeAt(0))
      if (workBase64) {
        const { readBrowserImageWorkPackage } = await import('/src/platform/browser/content/image-workflow-store.ts')
        const work = await readBrowserImageWorkPackage(unpack(workBase64))
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
    }, { base64: image?.toString('base64'), workBase64: work?.toString('base64'), rights: { licenseText, attribution: options.attribution }, originalName: options.image ? path.basename(options.image) : '' })
    if (options.localModelDir) definitions.push(LOCAL_SEGMENTATION_TOOL)

    const saveWork = async () => {
      const response = await page.evaluate(executeInBrowser, { name: 'image_import_export_work', input: {} })
      if (response.toolError) throw new Error(response.toolError.message)
      const filename = `work-${response.generation}-${randomUUID()}.sceneweave-image-work`
      const written = await writeVerified(options.output, filename, Buffer.from(response.workBase64, 'base64'))
      return { path: path.join(options.output, filename), sha256: written.record.sha256, generation: response.generation }
    }

    const handleLine = async line => {
      if (!line.trim()) return
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) {
        sendError(null, -32600, 'Tool request exceeds 8MiB')
        return
      }
      let request
      try {
        request = JSON.parse(line)
      } catch {
        sendError(null, -32700, 'Invalid JSON')
        return
      }
      if (!request || Array.isArray(request) || typeof request !== 'object'
        || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
        || (request.id !== undefined && request.id !== null && !['string', 'number'].includes(typeof request.id))
        || (typeof request.id === 'number' && !Number.isFinite(request.id))) {
        sendError(null, -32600, 'Invalid JSON-RPC request')
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
        if (params.name === LOCAL_SEGMENTATION_TOOL.name) {
          const content = await executeLocalSegmentation(page, options, params.arguments ?? {})
          send({ jsonrpc: '2.0', id: request.id, result: { content } })
          return
        }
        const response = await page.evaluate(executeInBrowser, { name: params.name, input: params.arguments ?? {} })
        if (response.toolError) {
          send({ jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(response.toolError) }] } })
          return
        }
        let content
        if (response.enhancements) {
          const { sourceBase64, candidates, ...metadata } = response.enhancements
          const directory = path.join(options.output, `enhancement-${metadata.generation}-${randomUUID()}`)
          await fs.mkdir(directory, { mode: 0o700 })
          const source = await writeVerified(directory, 'source.png', Buffer.from(sourceBase64, 'base64'))
          const records = [], images = []
          for (const [index, candidate] of candidates.entries()) {
            const { pngBase64, reviewBase64, ...info } = candidate
            const png = await writeVerified(directory, `candidate-${index}.png`, Buffer.from(pngBase64, 'base64'))
            const review = await writeVerified(directory, `candidate-${index}-review.png`, Buffer.from(reviewBase64, 'base64'))
            if (png.record.sha256 !== info.pngSha256) throw new Error('增强候选落盘摘要不一致。')
            records.push({ ...info, png: png.record, review: review.record })
            images.push({ type: 'image', mimeType: 'image/png', data: reviewBase64 })
          }
          if (source.record.sha256 !== metadata.sourceItemSha256) throw new Error('增强原件落盘摘要不一致。')
          const record = { ...metadata, source: source.record, candidates: records }
          const written = await writeVerified(directory, 'candidates.json', Buffer.from(JSON.stringify(record, null, 2)+'\n'))
          content = [{ type: 'text', text: JSON.stringify({ path: path.join(directory, 'candidates.json'), sha256: written.record.sha256, ...record }) }, ...images]
        } else if (response.workBase64) {
          const filename = `work-${response.generation}-${randomUUID()}.sceneweave-image-work`
          const written = await writeVerified(options.output, filename, Buffer.from(response.workBase64, 'base64'))
          content = [{ type: 'text', text: JSON.stringify({ path: path.join(options.output, filename), sha256: written.record.sha256, generation: response.generation }) }]
        } else if (response.archiveBase64) {
          content = await saveCandidate(response, options.output, context, tooling)
        } else if (response.previewBase64) {
          content = [
            { type: 'image', mimeType: 'image/png', data: response.previewBase64 },
            { type: 'text', text: JSON.stringify(Object.fromEntries(Object.entries(response).filter(([key]) => key !== 'previewBase64'))) },
          ]
        } else {
          content = [{ type: 'text', text: JSON.stringify(response.value) }]
        }
        if (Object.hasOwn(params.arguments ?? {}, 'generation') && params.name !== 'image_import_build_project'
          && !(params.name === 'image_import_guided_selection' && !params.arguments?.target)) {
          try { content.push({ type: 'text', text: JSON.stringify({ checkpoint: await saveWork() }) }) }
          catch (error) { content.push({ type: 'text', text: JSON.stringify({ checkpointError: String(error), nextAction: '当前候选仍在进程中；先导出工作包再结束会话。' }) }) }
        }
        send({ jsonrpc: '2.0', id: request.id, result: { content } })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image import tool failed'
        send({ jsonrpc: '2.0', id: request.id, result: { isError: true, content: [{ type: 'text', text: message }] } })
      }
    }
    // Queue line events before awaiting browser work so EOF cannot discard
    // pipelined requests. Each tool still observes the previous tool's generation.
    let pending = Promise.resolve()
    lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    await new Promise((resolve, reject) => {
      lines.on('line', line => {
        pending = pending.then(() => handleLine(line))
        pending.catch(reject)
      })
      lines.once('close', resolve)
      lines.once('error', reject)
    })
    await pending
  } finally {
    lines?.close()
    try { await browser?.close() } finally { await tooling.close() }
  }
}

const options = parseOptions(process.argv.slice(2))
if (options) await serve(options)
else process.stdout.write(usage + '\n')
