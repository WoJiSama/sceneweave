import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { LOCAL_SEGMENTATION_MODEL, LOCAL_SEGMENTATION_PROTOCOL, runLocalSegmentation,
  validateLocalSegmentationRequest, validateLocalSegmentationResponse } from './local-segmentation.mjs'

const options = () => ({ python: process.execPath, modelDir: path.resolve(tmpdir(), 'explicit-models'),
  pythonPath: path.resolve(tmpdir(), 'explicit-python-dependencies') })
const request = () => ({ protocol: LOCAL_SEGMENTATION_PROTOCOL, imagePath: path.resolve(tmpdir(), 'source.png'),
  contextBounds: { x: 0, y: 0, width: 10, height: 8 }, targetBounds: { x: 2, y: 2, width: 4, height: 3 },
  points: [{ x: 3, y: 3, label: 1 }, { x: 8, y: 6, label: 0 }] })

function response(input = validateLocalSegmentationRequest(request())) {
  return { protocol: LOCAL_SEGMENTATION_PROTOCOL, model: structuredClone(LOCAL_SEGMENTATION_MODEL),
    source: { sha256: 'a'.repeat(64), width: 10, height: 8 },
    parameters: { contextBounds: input.contextBounds, targetBounds: input.targetBounds, points: input.points,
      postprocess: input.postprocess, threshold: 0, resizedSize: { width: 1024, height: 819 },
      provider: 'CPUExecutionProvider', threads: 4, maskEncoding: 'row-major-count-alpha-rle', alphaMode: 'binary', boxPrompt: false },
    candidates: [0, 1, 2].map(index => ({ index, score: .8 + index / 100, mask: { ...input.targetBounds,
      runs: [2, 0, 2, 255, 2, 0, 2, 255, 4, 0] }, foregroundPixels: 4, postprocess: { filledPixels: 0, removedPixels: 0 } })),
    timing: { loadSeconds: .1, encodeSeconds: 1, decodeSeconds: .03, totalSeconds: 1.2 } }
}

function mockChild(context, handler, autoCloseOnKill = true) {
  let calls = 0, invocation
  const child = new EventEmitter()
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.kill = signal => {
    calls++
    if (autoCloseOnKill) queueMicrotask(() => child.emit('close', null, signal))
    return true
  }
  context.mock.method(childProcess, 'spawn', (...args) => { invocation = args; return child })
  const input = []
  child.stdin.on('data', data => input.push(data))
  child.stdin.on('finish', () => handler?.(child, Buffer.concat(input).toString('utf8')))
  return { child, get calls() { return calls }, get invocation() { return invocation } }
}

test('request capture defaults to no cleanup and refuses hidden execution, sparse points and pixel-budget escape', () => {
  const original = request(), captured = validateLocalSegmentationRequest(original)
  original.points[0].x = 9
  assert.equal(captured.points[0].x, 3)
  assert.deepEqual(captured.postprocess, { fillHolesMaxPixels: 0, removeIslandsMaxPixels: 0 })
  let getterCalls = 0
  const accessor = request()
  Object.defineProperty(accessor, 'points', { enumerable: true, get() { getterCalls++; return [] } })
  assert.throws(() => validateLocalSegmentationRequest(accessor), /Accessors/)
  assert.equal(getterCalls, 0)
  const invalid = [
    { ...request(), points: Array(1) },
    { ...request(), points: [{ x: 3, y: 3, label: true }] },
    { ...request(), points: [{ x: 9, y: 6, label: 1 }] },
    { ...request(), points: [{ x: 3, y: 3, label: 0 }] },
    { ...request(), points: Array.from({ length: 33 }, () => ({ x: 3, y: 3, label: 1 })) },
    { ...request(), targetBounds: { x: 0, y: 0, width: 501, height: 500 } },
    { ...request(), contextBounds: { x: 0, y: 0, width: 8192, height: 4096 } },
    { ...request(), targetBounds: { x: 9, y: 7, width: 2, height: 2 } },
    { ...request(), postprocess: { fillHolesMaxPixels: 5, removeIslandsMaxPixels: 0 } },
    { ...request(), [Symbol('hidden')]: true },
    { ...request(), extra: 'never forwarded' },
  ]
  for (const value of invalid) assert.throws(() => validateLocalSegmentationRequest(value))
})

test('all three original-grid binary masks are retained, including empty candidates; model and RLE tampering fail', () => {
  const input = validateLocalSegmentationRequest(request()), valid = response(input)
  valid.candidates[2].mask.runs = [12, 0]; valid.candidates[2].foregroundPixels = 0
  assert.equal(validateLocalSegmentationResponse(valid, input), valid)
  assert.deepEqual(valid.candidates[0].mask.runs, [2, 0, 2, 255, 2, 0, 2, 255, 4, 0])
  for (const alter of [
    value => { value.model.files[0].sha256 = 'b'.repeat(64) },
    value => { value.model.revision = 'b'.repeat(40) },
    value => { value.source.width = 5 },
    value => { value.parameters.provider = 'CUDAExecutionProvider' },
    value => { value.parameters.postprocess = { fillHolesMaxPixels: 4, removeIslandsMaxPixels: 4 } },
    value => { value.candidates.pop() },
    value => { value.candidates[0].mask.x++ },
    value => { value.candidates[0].mask.runs = [12, 128] },
    value => { value.candidates[0].mask.runs = [11, 255] },
    value => { value.candidates[0].mask.runs = [13, 255] },
    value => { value.candidates[0].mask.runs = [6, 255, 6, 255] },
    value => { value.candidates[0].foregroundPixels++ },
    value => { value.candidates[0].score = NaN },
    value => { value.candidates[0].postprocess.filledPixels = 1 },
  ]) {
    const tampered = structuredClone(valid); alter(tampered)
    assert.throws(() => validateLocalSegmentationResponse(tampered, input))
  }
})

test('wrapper uses explicit Python, shell-free arguments, explicit dependency path and captured request', async context => {
  const fake = mockChild(context, (child, text) => {
    child.stdout.end(JSON.stringify(response(JSON.parse(text))))
    queueMicrotask(() => child.emit('close', 0, null))
  })
  const input = request(), pending = runLocalSegmentation(options(), input)
  input.points[0].x = 9
  const result = await pending
  assert.equal(result.parameters.points[0].x, 3)
  const [command, args, spawned] = fake.invocation
  assert.equal(command, process.execPath)
  assert.equal(args[1], '--model-dir')
  assert.equal(args[2], options().modelDir)
  assert.equal(spawned.shell, false)
  assert.equal(spawned.windowsHide, true)
  assert.equal(spawned.env.PYTHONPATH, options().pythonPath)
  assert.equal(spawned.env.HF_HUB_OFFLINE, '1')
  assert.equal(spawned.env.PYTHONNOUSERSITE, '1')
  assert.equal(fake.calls, 0)
})

test('timeout kills the CPU process and rejects only after it closes', async context => {
  const fake = mockChild(context, undefined, false)
  let settled = false
  const pending = runLocalSegmentation({ ...options(), timeoutMs: 5 }, request())
  pending.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(pending, /timed out/)
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(fake.calls, 1)
  assert.equal(settled, false)
  fake.child.emit('close', null, 'SIGKILL')
  await rejected
})

test('cancellation kills an active job; an already cancelled request never spawns', async context => {
  const fake = mockChild(context)
  const controller = new AbortController()
  const pending = runLocalSegmentation({ ...options(), signal: controller.signal }, request())
  const rejected = assert.rejects(pending, /stop this local job/)
  controller.abort(new Error('stop this local job'))
  await rejected
  assert.equal(fake.calls, 1)
  let executions = 0
  context.mock.method(childProcess, 'spawn', () => { executions++; throw new Error('must not spawn') })
  await assert.rejects(runLocalSegmentation({ ...options(), signal: controller.signal }, request()), /stop this local job/)
  assert.equal(executions, 0)
})

test('stdout and stderr are bounded and malformed/nonzero child replies cannot become candidates', async context => {
  for (const stream of ['stdout', 'stderr']) {
    const fake = mockChild(context, child => child[stream].write(Buffer.alloc((stream === 'stdout' ? 8 * 1024 * 1024 : 64 * 1024) + 1)))
    await assert.rejects(runLocalSegmentation(options(), request()), /exceed/)
    assert.equal(fake.calls, 1)
    context.mock.restoreAll()
  }
  mockChild(context, child => { child.stdout.end('{'); queueMicrotask(() => child.emit('close', 0, null)) })
  await assert.rejects(runLocalSegmentation(options(), request()), /invalid JSON/)
  context.mock.restoreAll()
  mockChild(context, child => { child.stdout.end(JSON.stringify({ protocol: LOCAL_SEGMENTATION_PROTOCOL,
    error: { code: 'model-hash', message: 'Pinned model mismatch' } })); queueMicrotask(() => child.emit('close', 1, null)) })
  await assert.rejects(runLocalSegmentation(options(), request()), /Pinned model mismatch/)
})

const python = process.env.SCENEWEAVE_TEST_PYTHON
test('Python independently rejects duplicate fields and unsafe geometry before dependencies or model access', { skip: !python }, () => {
  const filename = fileURLToPath(new URL('./local-segmentation.py', import.meta.url))
  const duplicate = JSON.stringify(request()).replace('{', `{"protocol":"${LOCAL_SEGMENTATION_PROTOCOL}",`)
  const outOfContext = JSON.stringify({ ...request(), targetBounds: { x: 8, y: 0, width: 4, height: 3 } })
  for (const input of [duplicate, outOfContext, JSON.stringify({ ...request(), extra: true })]) {
    const child = childProcess.spawnSync(python, [filename, '--model-dir', options().modelDir], {
      input, encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    assert.equal(child.status, 1)
    assert.equal(JSON.parse(child.stdout).error.code, 'invalid-request')
  }
})
