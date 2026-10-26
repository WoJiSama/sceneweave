import { randomInt } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { crc32 } from '../../src/shared/project/binary.js'
import { createPublicVisionInput } from '../../src/shared/ai/vision.js'
import { AUTHORING_LIMITS } from '../../src/shared/ai/authoring-protocol.js'
import { createChatProvider } from './chat-provider.js'
import { loadAiConfig } from './config.js'
import { ProviderFailure, type ChatProviderConfig, type ProviderAdapter, type ProviderTokenUsage } from './provider-types.js'

const colors = [{ name: 'red', rgb: [235, 30, 30] }, { name: 'blue', rgb: [30, 60, 235] }, { name: 'green', rgb: [30, 195, 40] }, { name: 'yellow', rgb: [240, 220, 25] }]
function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
  view.setUint32(0, data.length); result.set(new TextEncoder().encode(type), 4); result.set(data, 8); view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8)))
  return result
}
const columns = 4, rows = 3, cellPx = 96
function colorPng(cells: typeof colors) {
  const width = columns * cellPx, height = rows * cellPx, raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(cells[Math.floor(y / cellPx) * columns + Math.floor(x / cellPx)].rgb, y * (width * 3 + 1) + 1 + x * 3)
  const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 2
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', new Uint8Array([0])), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(chunks.reduce((sum, value) => sum + value.length, 0)); let offset = 0
  for (const value of chunks) { bytes.set(value, offset); offset += value.length }
  return bytes
}
interface ProbeOptions { timeoutMs?: number; maxOutputTokens?: number; signal?: AbortSignal; fetchImpl?: typeof fetch }
interface ProbeTransport {
  phase: 'prepared' | 'waiting_headers' | 'response_received' | 'streaming' | 'complete'
  responseMs: number | null
  httpStatus: number | null
  contentType: 'event-stream' | 'json' | 'other' | null
  bodyBytes: number
  textBytes: number
  requestIdPresent: boolean
  networkCode?: string
}
export interface VisionProbeReport {
  kind: 'synthetic-public-vision-probe'
  probeVersion: 2
  protocol: 'chat-completions'
  model: string
  endpointOrigin: string
  configuredCapability: NonNullable<ChatProviderConfig['vision']>
  requests: number
  automaticRetries: 0
  observed: boolean
  outcome: 'observed' | 'mismatch' | 'invalid_answer' | 'timeout' | 'cancelled' | 'provider_failure' | 'configuration_or_validation'
  requestState: 'not_sent' | 'unknown' | 'finished'
  durationMs: number
  limits: { timeoutMs: number; modelRequests: 1; maxOutputTokens: number }
  image: { sha256: string; width: number; height: number; sizeBytes: number }
  challenge: { columns: number; rows: number; expected: string[][]; actual: string[][] | null; matchedCells: number; totalCells: number }
  usage: ProviderTokenUsage
  transport: ProbeTransport
  failure?: { code: string }
  generalVisualQuality: 'unverified'
  capabilityChanged: false
}

const safeNetworkCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'])
function networkCode(error: unknown): string | undefined {
  for (let level = 0; level < 3 && error && typeof error === 'object'; level++) {
    const value = error as { code?: unknown; cause?: unknown }
    if (typeof value.code === 'string' && safeNetworkCodes.has(value.code)) return value.code
    error = value.cause
  }
}
function answerRows(text: string): string[][] | null {
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'rows')) return null
    const grid = (value as { rows?: unknown }).rows
    if (!Array.isArray(grid) || grid.length !== rows || grid.some(row => !Array.isArray(row) || row.length !== columns
      || row.some(name => !colors.some(color => color.name === name)))) return null
    return grid as string[][]
  } catch { return null }
}

/** A fresh, single synthetic-image challenge; never reads user files or enables the configured channel. */
export async function probeProviderVision(config: ChatProviderConfig, adapter?: ProviderAdapter, options: ProbeOptions = {}): Promise<VisionProbeReport> {
  const timeoutMs = options.timeoutMs ?? 60_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90_000) throw new Error('Vision probe timeout must be 1000–90000 ms.')
  const maxOutputTokens = options.maxOutputTokens ?? 128
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > AUTHORING_LIMITS.maxOutputTokensPerRequest) throw new Error(`Vision probe output tokens must be 1–${AUTHORING_LIMITS.maxOutputTokensPerRequest}.`)
  // Three copies of each color, securely shuffled: 369600 possible layouts. The
  // expected order is never in the prompt, metadata, ID or any other text field.
  const cells = Array.from({ length: rows }, () => colors).flat()
  for (let i = cells.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]] }
  const bytes = colorPng(cells), image = createPublicVisionInput(bytes, { sceneId: 'synthetic-vision-probe', revision: 0,
    boundsMm: { x: 0, y: 0, width: columns * cellPx * 100, height: rows * cellPx * 100 } })
  const started = performance.now(), timeout = AbortSignal.timeout(timeoutMs), signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const report: VisionProbeReport = { kind: 'synthetic-public-vision-probe', probeVersion: 2, protocol: 'chat-completions',
    model: config.visionModel ?? config.model, endpointOrigin: new URL(config.baseUrl).origin, configuredCapability: config.vision ?? 'unverified', requests: 0, automaticRetries: 0,
    observed: false, outcome: 'configuration_or_validation', requestState: 'not_sent', durationMs: 0,
    limits: { timeoutMs, modelRequests: 1, maxOutputTokens }, image: { sha256: image.sha256, width: image.width, height: image.height, sizeBytes: bytes.length },
    challenge: { columns, rows, expected: Array.from({ length: rows }, (_, row) => cells.slice(row * columns, (row + 1) * columns).map(color => color.name)), actual: null, matchedCells: 0, totalCells: rows * columns },
    usage: { inputTokens: null, outputTokens: null }, transport: { phase: 'prepared', responseMs: null, httpStatus: null, contentType: null, bodyBytes: 0, textBytes: 0, requestIdPresent: false },
    generalVisualQuality: 'unverified', capabilityChanged: false }
  const observedFetch: typeof fetch = async (url, init) => {
    report.requests++; report.requestState = 'unknown'; report.transport.phase = 'waiting_headers'
    let response: Response
    try { response = await (options.fetchImpl ?? fetch)(url, init) }
    catch (error) { const code = networkCode(error); if (code) report.transport.networkCode = code; throw error }
    report.transport.responseMs = Math.round(performance.now() - started); report.transport.httpStatus = response.status
    const type = response.headers.get('content-type') ?? ''
    report.transport.contentType = /^text\/event-stream(?:\s*;|\s*$)/i.test(type) ? 'event-stream' : /^application\/json(?:\s*;|\s*$)/i.test(type) ? 'json' : 'other'
    report.transport.requestIdPresent = response.headers.has('x-request-id'); report.transport.phase = 'response_received'
    if (!response.body) return response
    // Observe only byte counts, never unsafe provider bodies or authorization.
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(part, controller) {
      report.transport.bodyBytes += part.byteLength; report.transport.phase = 'streaming'; controller.enqueue(part)
    } }))
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
  try {
    signal.throwIfAborted()
    const provider = adapter ?? createChatProvider({ ...config, vision: 'enabled' }, observedFetch)
    if (adapter) { report.requests = 1; report.requestState = 'unknown'; report.transport.phase = 'waiting_headers' }
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Inspect only the attached image. Read its 3 rows and 4 columns of solid color cells, top to bottom and left to right. Reply ONLY JSON {"rows":[["color","color","color","color"],["color","color","color","color"],["color","color","color","color"]]}. Each color must be red, blue, green or yellow. No positions or color order are given in text: determine every cell from the image.', images: [image] }], tools: [], maxOutputTokens, signal,
      onText: text => { report.transport.textBytes += new TextEncoder().encode(text).length } })
    report.requestState = 'finished'; report.transport.phase = 'complete'; report.transport.requestIdPresent ||= result.requestId !== null; report.usage = result.usage
    const actual = answerRows(result.text)
    report.challenge.actual = actual
    if (actual) for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      if (actual[row][column] === report.challenge.expected[row][column]) report.challenge.matchedCells++
    }
    report.observed = result.finishReason === 'stop' && result.toolCalls.length === 0 && actual !== null && report.challenge.matchedCells === report.challenge.totalCells
    report.outcome = report.observed ? 'observed' : actual ? 'mismatch' : 'invalid_answer'
  } catch (error) {
    const timedOut = timeout.aborted, cancelled = signal.aborted && !timedOut
    report.requestState = error instanceof ProviderFailure ? error.requestState : report.requestState
    report.outcome = timedOut ? 'timeout' : cancelled ? 'cancelled' : error instanceof ProviderFailure ? 'provider_failure' : 'configuration_or_validation'
    report.failure = { code: timedOut ? 'probe_timeout' : cancelled ? 'probe_cancelled' : error instanceof ProviderFailure ? error.code : 'probe_configuration_or_validation' }
  }
  report.durationMs = Math.round(performance.now() - started)
  return report
}
if (process.argv.includes('--run-vision-probe')) {
  try {
    const index = process.argv.indexOf('--probe-timeout-ms'), timeoutMs = index >= 0 ? Number(process.argv[index + 1]) : undefined
    const outputIndex = process.argv.indexOf('--probe-max-output-tokens'), maxOutputTokens = outputIndex >= 0 ? Number(process.argv[outputIndex + 1]) : undefined
    const report = await probeProviderVision(loadAiConfig().provider, undefined, { timeoutMs, maxOutputTokens })
    process.stdout.write(JSON.stringify(report) + '\n'); if (!report.observed) process.exitCode = 1
  }
  catch { process.stdout.write(JSON.stringify({ kind: 'synthetic-public-vision-probe', observed: false, requests: 0, automaticRetries: 0,
    failure: 'probe_configuration_or_validation', requestState: 'not_sent', capabilityChanged: false }) + '\n'); process.exitCode = 1 }
}
