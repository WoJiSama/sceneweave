import { resolve } from 'node:path'
import { isProviderModel, isProviderReasoningEffort, type ChatProviderConfig } from './provider-types.js'
import { AI_LIMITS } from '../../src/shared/ai/protocol.js'
import { AUTHORING_LIMITS } from '../../src/shared/ai/authoring-protocol.js'

export interface AiConfig {
  host: string
  port: number
  dataDir: string
  allowedOrigins: ReadonlySet<string>
  accessTokens: ReadonlyMap<string, string>
  provider: ChatProviderConfig
  maxConcurrent: number
  authoringOutputTokens?: number
}
function invalid(name: string): never { throw new Error(`Invalid server configuration: ${name}`) }
const token = (value: unknown): value is string => typeof value === 'string' && value.length >= 32 && value.length <= 512 && /^[\x21-\x7e]+$/.test(value)
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const prefix = 'SCENEWEAVE_AI_'
  const read = (name: string) => env[`${prefix}${name}`]
  const host = read('HOST') ?? '127.0.0.1'
  if (!/^[A-Za-z0-9.:[\]-]+$/.test(host)) invalid('HOST')
  const port = Number(read('PORT') ?? 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid('PORT')
  const allowedOrigins = new Set<string>()
  for (const raw of (read('ALLOWED_ORIGINS') ?? 'http://127.0.0.1:5173').split(',')) {
    let url: URL
    try { url = new URL(raw) } catch { invalid('ALLOWED_ORIGINS') }
    if (!['https:', 'http:'].includes(url!.protocol) || url!.origin !== raw || url!.username || url!.password) invalid('ALLOWED_ORIGINS')
    allowedOrigins.add(raw)
  }
  const accessTokens = new Map<string, string>()
  const single = read('ACCESS_TOKEN')
  if (single !== undefined) { if (!token(single)) invalid('ACCESS_TOKEN'); accessTokens.set(single, 'maintainer') }
  if (read('ACCESS_TOKENS')) {
    let values: unknown
    try { values = JSON.parse(read('ACCESS_TOKENS')!) } catch { invalid('ACCESS_TOKENS') }
    if (!values || typeof values !== 'object' || Array.isArray(values)) invalid('ACCESS_TOKENS')
    const entries = Object.entries(values)
    if (entries.length > 16) invalid('ACCESS_TOKENS')
    for (const [owner, value] of entries) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(owner) || !token(value) || accessTokens.has(value)) invalid('ACCESS_TOKENS')
      accessTokens.set(value, owner)
    }
  }
  if (!accessTokens.size) invalid('ACCESS_TOKEN')
  const base = read('PROVIDER_BASE_URL'), apiKey = read('PROVIDER_API_KEY'), model = read('PROVIDER_MODEL'), visionModel = read('PROVIDER_VISION_MODEL')
  if (!base || !apiKey || !isProviderModel(model) || /[\x00-\x1f\x7f]/.test(apiKey)) invalid('PROVIDER')
  if (visionModel !== undefined && !isProviderModel(visionModel)) invalid('PROVIDER_VISION_MODEL')
  if (accessTokens.has(apiKey)) invalid('ACCESS_TOKEN')
  const vision = read('PROVIDER_VISION') ?? 'unverified'
  if (!['unverified', 'disabled', 'enabled'].includes(vision)) invalid('PROVIDER_VISION')
  const preserveReasoning = read('PROVIDER_PRESERVE_REASONING') ?? 'disabled'
  if (preserveReasoning !== 'enabled' && preserveReasoning !== 'disabled') invalid('PROVIDER_PRESERVE_REASONING')
  const reasoningEffort = read('PROVIDER_REASONING_EFFORT')
  if (reasoningEffort !== undefined && !isProviderReasoningEffort(reasoningEffort)) invalid('PROVIDER_REASONING_EFFORT')
  const outputBudget = read('AUTHORING_OUTPUT_TOKENS')
  const authoringOutputTokens = outputBudget === undefined ? AI_LIMITS.maxOutputTokensPerRequest : Number(outputBudget)
  if ((outputBudget !== undefined && !/^[0-9]+$/.test(outputBudget)) || !Number.isInteger(authoringOutputTokens) || authoringOutputTokens < 1 || authoringOutputTokens > AUTHORING_LIMITS.maxOutputTokensPerRequest) invalid('AUTHORING_OUTPUT_TOKENS')
  let url: URL
  try { url = new URL(base) } catch { invalid('PROVIDER_BASE_URL') }
  if (url!.username || url!.password || url!.search || url!.hash ||
    !(url!.protocol === 'https:' || url!.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url!.hostname))) invalid('PROVIDER_BASE_URL')
  return { host, port, dataDir: resolve(read('DATA_DIR') ?? 'local-data/ai'), allowedOrigins, accessTokens,
    provider: { baseUrl: base.replace(/\/$/, ''), apiKey, model, ...(visionModel !== undefined ? { visionModel } : {}), vision: vision as 'unverified' | 'disabled' | 'enabled', preserveReasoning,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) }, maxConcurrent: 4, authoringOutputTokens }
}
