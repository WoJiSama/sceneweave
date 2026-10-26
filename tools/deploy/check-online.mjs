import https from 'node:https'
import { isIP } from 'node:net'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 32 * 1024
const SAFE_ERRORS = new Set(['invalid_arguments', 'missing_access_token', 'tls_connection_failed', 'tls_not_authorized', 'invalid_certificate', 'certificate_renewal_due', 'request_failed', 'request_timeout', 'response_too_large', 'unexpected_status', 'unexpected_body', 'unexpected_headers'])
class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = code => { throw new ProbeFailure(code) }
const publicError = error => error instanceof ProbeFailure && SAFE_ERRORS.has(error.code) ? error.code : 'request_failed'
const assert = (condition, code) => { if (!condition) fail(code) }
const hostname = url => url.hostname.replace(/^\[|\]$/g, '')

export function parseOptions(args, env = process.env) {
  const values = new Map()
  for (let index = 0; index < args.length; index++) {
    const name = args[index]
    assert(['--url', '--origin', '--min-hours', '--timeout-ms', '--authenticated', '--vision'].includes(name) && !values.has(name), 'invalid_arguments')
    if (name === '--authenticated') values.set(name, true)
    else {
      const value = args[++index]
      assert(typeof value === 'string' && !value.startsWith('--'), 'invalid_arguments')
      values.set(name, value)
    }
  }
  const exactHttpsOrigin = value => {
    let url
    try { url = new URL(value) } catch { fail('invalid_arguments') }
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && (value === url.origin || value === `${url.origin}/`), 'invalid_arguments')
    return url.origin
  }
  const integer = (value, fallback, min, max) => {
    if (value === undefined) return fallback
    assert(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max, 'invalid_arguments')
    return Number(value)
  }
  const endpoint = exactHttpsOrigin(values.get('--url'))
  const origin = exactHttpsOrigin(values.get('--origin'))
  const minHours = integer(values.get('--min-hours'), 48, 0, 8760)
  const timeoutMs = integer(values.get('--timeout-ms'), 10000, 100, 60000)
  const expectedVision = values.get('--vision') ?? 'unverified'
  assert(['unverified', 'disabled', 'enabled'].includes(expectedVision), 'invalid_arguments')
  let token
  if (values.has('--authenticated')) {
    token = env.SCENEWEAVE_AI_ACCESS_TOKEN
    assert(typeof token === 'string' && /^[\x21-\x7e]{32,512}$/.test(token), 'missing_access_token')
  }
  return { endpoint, origin, minHours, timeoutMs, token, expectedVision }
}

export function certificateSummary(certificate, protocol, now = Date.now()) {
  const validFrom = Date.parse(certificate.valid_from), validTo = Date.parse(certificate.valid_to)
  assert(Number.isFinite(validFrom) && Number.isFinite(validTo) && validFrom <= now && validTo > now && validTo > validFrom, 'invalid_certificate')
  assert(typeof certificate.fingerprint256 === 'string' && typeof certificate.subjectaltname === 'string', 'invalid_certificate')
  return {
    issuer: certificate.issuer?.CN ?? 'unknown',
    subjectAltName: certificate.subjectaltname,
    fingerprint256: certificate.fingerprint256,
    validFrom: new Date(validFrom).toISOString(),
    validTo: new Date(validTo).toISOString(),
    remainingHours: Number(((validTo - now) / 3600000).toFixed(2)),
    protocol,
  }
}

export function inspectCertificate(endpoint, { timeoutMs = 10000, now = Date.now(), connect = tls.connect } = {}) {
  const url = new URL(endpoint), expectedHost = hostname(url)
  return new Promise((resolve, reject) => {
    let socket, settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); socket?.destroy()
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => finish(new ProbeFailure('tls_connection_failed')), timeoutMs)
    try {
      socket = connect({ host: expectedHost, port: Number(url.port || 443), servername: isIP(expectedHost) ? undefined : expectedHost,
        rejectUnauthorized: true, checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(expectedHost, certificate) })
      socket.once('error', () => finish(new ProbeFailure('tls_connection_failed')))
      socket.once('secureConnect', () => {
        try {
          assert(socket.authorized === true, 'tls_not_authorized')
          finish(null, certificateSummary(socket.getPeerCertificate(), socket.getProtocol(), now))
        } catch (error) { finish(error) }
      })
    } catch { finish(new ProbeFailure('tls_connection_failed')) }
  })
}

export function requestEndpoint(endpoint, path, { method = 'GET', headers = {}, timeoutMs = 10000, request = https.request } = {}) {
  const url = new URL(path, endpoint), expectedHost = hostname(url)
  return new Promise((resolve, reject) => {
    let outgoing, settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (error) outgoing?.destroy()
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => finish(new ProbeFailure('request_timeout')), timeoutMs)
    try {
      outgoing = request(url, { method, agent: false, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', ...headers },
        rejectUnauthorized: true, servername: isIP(expectedHost) ? undefined : expectedHost,
        checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(expectedHost, certificate) }, response => {
        let length = 0
        const chunks = []
        response.on('data', chunk => {
          length += chunk.byteLength
          if (length > MAX_RESPONSE_BYTES) { response.destroy(); finish(new ProbeFailure('response_too_large')); return }
          chunks.push(Buffer.from(chunk))
        })
        response.once('error', () => finish(new ProbeFailure('request_failed')))
        response.once('aborted', () => finish(new ProbeFailure('request_failed')))
        response.once('end', () => finish(null, { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
      })
      outgoing.once('error', () => finish(new ProbeFailure('request_failed')))
      outgoing.end()
    } catch { finish(new ProbeFailure('request_failed')) }
  })
}

const header = (response, name) => response.headers[name.toLowerCase()]
const headerSet = (response, name) => new Set(String(header(response, name) ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean))
const sameSet = (actual, expected) => actual.size === expected.length && expected.every(value => actual.has(value))
const json = response => { try { return JSON.parse(response.body) } catch { fail('unexpected_body') } }
function commonHeaders(response) {
  assert(header(response, 'cache-control') === 'no-store' && header(response, 'x-content-type-options') === 'nosniff' && headerSet(response, 'vary').has('origin'), 'unexpected_headers')
}
function allowedOrigin(response, origin) { assert(header(response, 'access-control-allow-origin') === origin, 'unexpected_headers') }
function rejectedOrigin(response) { assert(header(response, 'access-control-allow-origin') === undefined, 'unexpected_headers') }

export async function runOnlineChecks(options, { inspect = inspectCertificate, request = requestEndpoint, now = Date.now() } = {}) {
  const { endpoint, origin, minHours, timeoutMs, token, expectedVision = 'unverified' } = options
  const report = { checkedAt: new Date(now).toISOString(), endpoint, frontendOrigin: origin, minCertificateHours: minHours, authenticated: token !== undefined, ok: false, checks: [] }
  const check = async (name, operation) => {
    try { await operation(); report.checks.push({ name, ok: true }) }
    catch (error) { report.checks.push({ name, ok: false, error: publicError(error) }) }
  }
  const send = (path, method = 'GET', headers = {}) => request(endpoint, path, { method, headers, timeoutMs })
  await check('trusted_tls_and_certificate', async () => {
    report.certificate = await inspect(endpoint, { timeoutMs, now })
    assert(Date.parse(report.certificate.validTo) - now >= minHours * 3600000, 'certificate_renewal_due')
  })
  await check('anonymous_health', async () => {
    const response = await send('/healthz')
    assert(response.status === 200, 'unexpected_status'); commonHeaders(response); rejectedOrigin(response)
    const value = json(response)
    assert(value?.ok === true && Object.keys(value).length === 1, 'unexpected_body')
  })
  await check('missing_credential_401', async () => {
    const response = await send('/v1/capabilities', 'GET', { Origin: origin })
    assert(response.status === 401, 'unexpected_status'); commonHeaders(response); allowedOrigin(response, origin)
    assert(json(response)?.error?.code === 'unauthorized', 'unexpected_body')
  })
  await check('wrong_origin_403', async () => {
    const deniedOrigin = origin === 'https://sceneweave-check.invalid' ? 'https://sceneweave-denied.invalid' : 'https://sceneweave-check.invalid'
    const response = await send('/healthz', 'GET', { Origin: deniedOrigin })
    assert(response.status === 403, 'unexpected_status'); commonHeaders(response); rejectedOrigin(response)
    assert(json(response)?.error?.code === 'origin_rejected', 'unexpected_body')
  })
  for (const method of ['GET', 'POST', 'DELETE']) {
    await check(`preflight_${method.toLowerCase()}`, async () => {
      const response = await send('/v1/tasks', 'OPTIONS', { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'Authorization, Content-Type' })
      assert(response.status === 204, 'unexpected_status'); commonHeaders(response); allowedOrigin(response, origin)
      assert(response.body === '' && sameSet(headerSet(response, 'access-control-allow-methods'), ['get', 'post', 'delete']) && sameSet(headerSet(response, 'access-control-allow-headers'), ['authorization', 'content-type']), 'unexpected_headers')
    })
  }
  for (const [name, headers] of [
    ['preflight_rejects_method', { Origin: origin, 'Access-Control-Request-Method': 'PUT' }],
    ['preflight_rejects_header', { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Sceneweave-Probe' }],
    ['preflight_requires_origin', { 'Access-Control-Request-Method': 'GET' }],
  ]) {
    await check(name, async () => {
      const response = await send('/v1/tasks', 'OPTIONS', headers)
      assert(response.status === 403, 'unexpected_status'); commonHeaders(response)
      assert(json(response)?.error?.code === (headers.Origin ? 'invalid_preflight' : 'origin_rejected'), 'unexpected_body')
    })
  }
  if (token !== undefined) {
    await check('authenticated_capabilities', async () => {
      const response = await send('/v1/capabilities', 'GET', { Origin: origin, Authorization: `Bearer ${token}` })
      assert(response.status === 200, 'unexpected_status'); commonHeaders(response); allowedOrigin(response, origin)
      const value = json(response)
      assert(value?.schemaVersion === 1 && value?.retentionDays === 7 && value?.capabilities?.conversation === true && value?.capabilities?.connectionTool === true && value?.capabilities?.sceneDraft === true && value?.capabilities?.svg === true && value?.capabilities?.vision === expectedVision, 'unexpected_body')
    })
  }
  report.ok = report.checks.every(value => value.ok)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await runOnlineChecks(parseOptions(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = report.ok ? 0 : 1
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: publicError(error) })}\n`)
    process.exitCode = 2
  }
}
