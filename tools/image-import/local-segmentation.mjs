import childProcess from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOCAL_SEGMENTATION_PROTOCOL = 'sceneweave-local-segmentation/1'
export const LOCAL_SEGMENTATION_MODEL = Object.freeze({
  id: 'Xenova/slimsam-77-uniform', revision: '5850ab45f587c112167512ffef949107115e26a0',
  files: Object.freeze([
    Object.freeze({ name: 'vision_encoder.onnx', sha256: '9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0' }),
    Object.freeze({ name: 'prompt_encoder_mask_decoder.onnx', sha256: 'f4514391764fbd56e08e119060d874ecd7d52994bfb1968af159e12d4943b5bb' }),
  ]),
})
const MAX_INPUT_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const script = fileURLToPath(new URL('./local-segmentation.py', import.meta.url))
const fail = message => { throw new Error(message) }
const requireValue = (condition, message) => { if (!condition) fail(message) }
const integer = (number, minimum, maximum) => Number.isSafeInteger(number) && number >= minimum && number <= maximum
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))

function exact(value, required, optional = []) {
  requireValue(isPlain(value) && required.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => typeof key === 'string' && [...required, ...optional].includes(key)), 'Unexpected or missing local segmentation fields')
}

/** Capture data before the first await; do not execute accessors or toJSON. */
function capture(value, depth = 0, budget = { nodes: 0 }) {
  requireValue(depth <= 16 && ++budget.nodes <= 16_384, 'Local segmentation JSON is too complex')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') { requireValue(Number.isFinite(value), 'Nonfinite local segmentation number'); return value }
  requireValue(Array.isArray(value) || isPlain(value), 'Local segmentation expects plain JSON data')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  requireValue(Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && 'value' in descriptors[key]
    && (Array.isArray(value) && key === 'length' || descriptors[key].enumerable)), 'Accessors, symbols and hidden fields are not accepted')
  if (Array.isArray(value)) {
    requireValue(value.length <= 16_384 && Object.keys(descriptors).length === value.length + 1
      && Object.keys(descriptors).every(key => key === 'length' || /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length), 'Expected a dense JSON array')
    return Array.from({ length: value.length }, (_, index) => capture(descriptors[index].value, depth + 1, budget))
  }
  const output = Object.create(null)
  for (const [key, descriptor] of Object.entries(descriptors)) output[key] = capture(descriptor.value, depth + 1, budget)
  return output
}

function bounds(value) {
  exact(value, ['x', 'y', 'width', 'height'])
  requireValue(['x', 'y'].every(key => integer(value[key], 0, 8191))
    && ['width', 'height'].every(key => integer(value[key], 1, 8192))
    && value.x + value.width <= 8192 && value.y + value.height <= 8192, 'Invalid original-image pixel bounds')
  return value
}
const contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
const pointIn = (point, area) => point.x >= area.x && point.y >= area.y
  && point.x < area.x + area.width && point.y < area.y + area.height
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const sameBounds = (left, right) => ['x', 'y', 'width', 'height'].every(key => left[key] === right[key])

export function validateLocalSegmentationRequest(input) {
  const value = capture(input)
  exact(value, ['protocol', 'imagePath', 'contextBounds', 'targetBounds', 'points'], ['postprocess'])
  requireValue(value.protocol === LOCAL_SEGMENTATION_PROTOCOL, 'Unsupported local segmentation protocol')
  requireValue(typeof value.imagePath === 'string' && value.imagePath.length > 0 && value.imagePath.length <= 4096
    && !value.imagePath.includes('\0') && path.isAbsolute(value.imagePath), 'Expected an explicit absolute source PNG path')
  const context = bounds(value.contextBounds), target = bounds(value.targetBounds)
  requireValue(context.width * context.height <= 32_000_000, 'Context exceeds 32 million pixels')
  requireValue(target.width * target.height <= 250_000, 'Target exceeds 250000 pixels')
  requireValue(contains(context, target), 'Target must be entirely inside context')
  requireValue(Array.isArray(value.points) && value.points.length >= 1 && value.points.length <= 32, 'Expected 1 to 32 positive/negative points')
  for (const point of value.points) {
    exact(point, ['x', 'y', 'label'])
    requireValue(Number.isFinite(point.x) && Number.isFinite(point.y) && [0, 1].includes(point.label)
      && typeof point.label === 'number' && pointIn(point, context), 'Every point must be finite and inside context')
    requireValue(point.label !== 1 || pointIn(point, target), 'Positive points must be inside target')
  }
  requireValue(value.points.some(point => point.label === 1), 'At least one positive point is required')
  const cleanup = value.postprocess ?? { fillHolesMaxPixels: 0, removeIslandsMaxPixels: 0 }
  exact(cleanup, ['fillHolesMaxPixels', 'removeIslandsMaxPixels'])
  requireValue(Object.values(cleanup).every(number => integer(number, 0, 4)), 'Postprocess limits must be integers from 0 to 4')
  value.postprocess = { ...cleanup }
  requireValue(Buffer.byteLength(JSON.stringify(value)) <= MAX_INPUT_BYTES, 'Local segmentation input exceeds 64 KiB')
  return value
}

/** Child output is untrusted data: validate every mask, binding and budget. */
export function validateLocalSegmentationResponse(value, request, threads = 4) {
  exact(value, ['protocol', 'model', 'source', 'parameters', 'candidates', 'timing'])
  requireValue(value.protocol === LOCAL_SEGMENTATION_PROTOCOL, 'Unexpected local segmentation response protocol')
  exact(value.model, ['id', 'revision', 'files'])
  requireValue(value.model.id === LOCAL_SEGMENTATION_MODEL.id && value.model.revision === LOCAL_SEGMENTATION_MODEL.revision
    && Array.isArray(value.model.files) && value.model.files.length === 2, 'Unrecognized local segmentation model')
  value.model.files.forEach((file, index) => {
    exact(file, ['name', 'sha256'])
    requireValue(file.name === LOCAL_SEGMENTATION_MODEL.files[index].name && file.sha256 === LOCAL_SEGMENTATION_MODEL.files[index].sha256,
      'Local segmentation model hash mismatch')
  })
  exact(value.source, ['sha256', 'width', 'height'])
  requireValue(typeof value.source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.source.sha256)
    && integer(value.source.width, 1, 8192) && integer(value.source.height, 1, 8192)
    && value.source.width * value.source.height <= 32_000_000, 'Invalid source PNG binding')
  const image = { x: 0, y: 0, width: value.source.width, height: value.source.height }
  requireValue(contains(image, request.contextBounds) && contains(image, request.targetBounds), 'Bounds exceed the actual source PNG')
  exact(value.parameters, ['contextBounds', 'targetBounds', 'points', 'postprocess', 'threshold', 'resizedSize', 'provider', 'threads', 'maskEncoding', 'alphaMode', 'boxPrompt'])
  const parameters = value.parameters
  bounds(parameters.contextBounds); bounds(parameters.targetBounds)
  requireValue(sameBounds(parameters.contextBounds, request.contextBounds) && sameBounds(parameters.targetBounds, request.targetBounds)
    && same(parameters.points, request.points) && same(parameters.postprocess, request.postprocess), 'Local segmentation response changed the request')
  exact(parameters.resizedSize, ['width', 'height'])
  const longest = Math.max(request.contextBounds.width, request.contextBounds.height)
  requireValue(parameters.resizedSize.width === Math.max(1, Math.floor(request.contextBounds.width * 1024 / longest + 0.5))
    && parameters.resizedSize.height === Math.max(1, Math.floor(request.contextBounds.height * 1024 / longest + 0.5))
    && parameters.threshold === 0 && parameters.provider === 'CPUExecutionProvider' && parameters.threads === threads
    && parameters.maskEncoding === 'row-major-count-alpha-rle' && parameters.alphaMode === 'binary' && parameters.boxPrompt === false,
  'Unexpected local segmentation inference parameters')
  requireValue(Array.isArray(value.candidates) && value.candidates.length === 3, 'Expected all three segmentation candidates')
  const area = request.targetBounds.width * request.targetBounds.height
  value.candidates.forEach((candidate, index) => {
    exact(candidate, ['index', 'score', 'mask', 'foregroundPixels', 'postprocess'])
    requireValue(candidate.index === index && Number.isFinite(candidate.score), 'Invalid candidate index or predicted score')
    exact(candidate.mask, ['x', 'y', 'width', 'height', 'runs'])
    requireValue(sameBounds(candidate.mask, request.targetBounds), 'Candidate mask left the requested original pixel grid')
    const runs = candidate.mask.runs
    requireValue(Array.isArray(runs) && runs.length >= 2 && runs.length <= 200_000 && runs.length % 2 === 0, 'Invalid or over-budget mask RLE')
    let total = 0, visible = 0, previous
    for (let offset = 0; offset < runs.length; offset += 2) {
      const count = runs[offset], alpha = runs[offset + 1]
      requireValue(integer(count, 1, area) && (alpha === 0 || alpha === 255) && alpha !== previous, 'Invalid or noncanonical binary mask RLE')
      total += count
      if (alpha === 255) visible += count
      requireValue(total <= area, 'Mask RLE exceeds target pixel count')
      previous = alpha
    }
    requireValue(total === area && candidate.foregroundPixels === visible, 'Mask RLE dimensions or foreground count mismatch')
    exact(candidate.postprocess, ['filledPixels', 'removedPixels'])
    requireValue(Object.values(candidate.postprocess).every(number => integer(number, 0, area))
      && (request.postprocess.fillHolesMaxPixels !== 0 || candidate.postprocess.filledPixels === 0)
      && (request.postprocess.removeIslandsMaxPixels !== 0 || candidate.postprocess.removedPixels === 0), 'Unexpected postprocess accounting')
  })
  exact(value.timing, ['loadSeconds', 'encodeSeconds', 'decodeSeconds', 'totalSeconds'])
  requireValue(Object.values(value.timing).every(number => Number.isFinite(number) && number >= 0), 'Invalid local inference timing')
  return value
}

/** An isolated short-lived process releases the substantial encoder memory.
 * No shell, dependency installation, network/model discovery or retry is used.
 */
export async function runLocalSegmentation(options, input) {
  const request = validateLocalSegmentationRequest(input)
  exact(options, ['python', 'modelDir'], ['pythonPath', 'timeoutMs', 'threads', 'signal'])
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(options))) {
    requireValue('value' in descriptor && descriptor.enumerable, 'Local segmentation options must be data fields')
  }
  for (const key of ['python', 'modelDir', ...(options.pythonPath === undefined ? [] : ['pythonPath'])]) {
    requireValue(typeof options[key] === 'string' && path.isAbsolute(options[key]) && !options[key].includes('\0'), `Expected explicit absolute ${key}`)
  }
  const timeoutMs = options.timeoutMs ?? 30_000, threads = options.threads ?? 4, signal = options.signal
  requireValue(integer(timeoutMs, 1, 120_000) && integer(threads, 1, 4), 'Invalid local inference time/thread budget')
  requireValue(signal === undefined || signal instanceof AbortSignal, 'Expected an AbortSignal')
  signal?.throwIfAborted()
  const environment = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
    HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }
  delete environment.PYTHONPATH
  if (options.pythonPath !== undefined) environment.PYTHONPATH = options.pythonPath
  const raw = Buffer.from(JSON.stringify(request))
  const text = await new Promise((resolve, reject) => {
    let child, timer, failure, settled = false, outputBytes = 0, errorBytes = 0
    const output = [], errors = []
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result)
    }
    const stop = error => {
      if (failure) return
      failure = error
      // Settle on close, after the one Python process has actually ended.
      child?.kill('SIGKILL')
    }
    const abort = () => stop(signal.reason instanceof Error ? signal.reason : new Error('Local segmentation cancelled'))
    try {
      child = childProcess.spawn(options.python, [script, '--model-dir', options.modelDir, '--threads', String(threads)],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: environment })
    } catch (error) { finish(error); return }
    child.once('error', error => finish(error))
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) { stop(new Error('Local segmentation output exceeds 8 MiB')); return }
      output.push(chunk)
    })
    child.stderr.on('data', chunk => {
      errorBytes += chunk.length
      if (errorBytes > MAX_STDERR_BYTES) { stop(new Error('Local segmentation diagnostics exceed 64 KiB')); return }
      errors.push(chunk)
    })
    child.stdout.once('error', stop)
    child.stderr.once('error', stop)
    child.stdin.on('error', error => stop(error))
    child.once('close', (code, terminationSignal) => {
      if (failure) { finish(failure); return }
      const stdout = Buffer.concat(output).toString('utf8')
      if (code !== 0) {
        let detail
        try {
          const parsed = JSON.parse(stdout)
          if (parsed?.protocol === LOCAL_SEGMENTATION_PROTOCOL && typeof parsed.error?.message === 'string') detail = parsed.error.message.slice(0, 1024)
        } catch { /* Never treat an incomplete child response as success. */ }
        finish(new Error(detail ?? `Local segmentation process failed (${code ?? terminationSignal}): ${Buffer.concat(errors).toString('utf8').slice(0, 1024)}`))
      } else finish(undefined, stdout)
    })
    timer = setTimeout(() => stop(new Error('Local segmentation timed out')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdin.end(raw)
  })
  let response
  try { response = JSON.parse(text) } catch { fail('Local segmentation returned invalid JSON') }
  return validateLocalSegmentationResponse(response, request, threads)
}
