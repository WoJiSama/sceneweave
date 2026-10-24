// Explicit, bounded live check. Never retries or prints credentials/prompt/response text.
// Build services first, then run with a server-only environment file.
import { writeFile } from 'node:fs/promises'
import { loadAiConfig } from '../../dist-ai/services/ai/config.js'
import { createChatProvider } from '../../dist-ai/services/ai/chat-provider.js'
import { connectionInfo } from '../../dist-ai/services/ai/app.js'

const args = process.argv.slice(2), out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined
const config = loadAiConfig(), provider = createChatProvider(config.provider)
const report = { kind: 'live-chat-provider-probe', model: config.provider.model, protocol: 'chat-completions',
  endpointOrigin: new URL(config.provider.baseUrl).origin, automaticRetries: 0, checks: [], complete: false }
const tool = { name: 'sceneweave_connection_info', description: 'Read actual capabilities of this Sceneweave connection.',
  parameters: { type: 'object', properties: { topic: { type: 'string', enum: ['connection'] } }, required: ['topic'], additionalProperties: false } }
async function request(name, messages, tools, maxOutputTokens) {
  const start = performance.now(); let chunks = 0, chars = 0
  const result = await provider.complete({ messages, tools, maxOutputTokens, signal: AbortSignal.timeout(30_000), onText: text => { chunks++; chars += text.length } })
  report.checks.push({ name, durationMs: Math.round(performance.now() - start), textChunks: chunks, textCharacters: chars,
    finishReason: result.finishReason, toolCalls: result.toolCalls.length, usage: result.usage, requestIdPresent: result.requestId !== null })
  return result
}
try {
  if (args.includes('--interrupt-and-error')) {
    const abort = new AbortController(); let receivedText = false, interrupted = false
    try {
      await provider.complete({ messages: [{ role: 'user', content: '请只回复“连接成功”。' }], tools: [], maxOutputTokens: 64,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]), onText: () => { receivedText = true; abort.abort() } })
    } catch (error) { if (error.name !== 'AbortError' || !receivedText) throw error; interrupted = true }
    if (!interrupted) throw new Error('interruption_probe_failed')
    report.checks.push({ name: 'interrupt-after-first-text', receivedText, localStreamAborted: true, upstreamBilling: 'unknown' })
    const rejected = createChatProvider({ ...config.provider, apiKey: 'invalid-connection-probe-token' })
    let failedSafely = false
    try { await rejected.complete({ messages: [{ role: 'user', content: 'Connection test.' }], tools: [], maxOutputTokens: 1, signal: AbortSignal.timeout(15_000), onText: () => {} }) }
    catch (error) { if (error.code !== 'provider_response') throw error; failedSafely = true }
    if (!failedSafely) throw new Error('error_probe_failed')
    report.checks.push({ name: 'invalid-provider-credential', safeError: true })
    report.complete = true
  } else {
  const text = await request('streamed-text', [{ role: 'user', content: '连接测试：请只回复“连接成功”。' }], [], 64)
  if (!text.text.trim() || text.finishReason !== 'stop') throw new Error('text_probe_failed')
  const messages = [{ role: 'user', content: '这是工具连接测试。你必须先调用 sceneweave_connection_info，参数为 {"topic":"connection"}，取得真实结果后再用中文简短回答是否支持场景修改。请勿跳过工具直接作答。' }]
  const calls = await request('streamed-tool-call', messages, [tool], 256)
  if (calls.toolCalls.length !== 1 || calls.toolCalls[0].name !== tool.name || JSON.stringify(JSON.parse(calls.toolCalls[0].arguments)) !== '{"topic":"connection"}') throw new Error('tool_probe_failed')
  messages.push({ role: 'assistant', content: calls.text || null, toolCalls: calls.toolCalls })
  messages.push({ role: 'tool', toolCallId: calls.toolCalls[0].id, content: JSON.stringify(connectionInfo(config)) })
  const continued = await request('tool-result-continuation', messages, [], 128)
  if (!continued.text.trim() || continued.finishReason !== 'stop') throw new Error('continuation_probe_failed')
  report.complete = true
  }
} catch (error) {
  report.failure = { code: typeof error.code === 'string' && /^[a-z_]{1,64}$/.test(error.code) ? error.code : error.name === 'AbortError' ? 'aborted' : 'probe_failed', requestState: error.requestState ?? 'unknown' }
  process.exitCode = 1
} finally {
  if (out) await writeFile(out, JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report))
}
