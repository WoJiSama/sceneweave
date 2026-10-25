import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { certificateSummary, inspectCertificate, parseOptions, requestEndpoint, runOnlineChecks } from './check-online.mjs'

const now = Date.parse('2026-10-25T00:00:00Z')
const certificate = {
  valid_from: 'Oct 24 15:54:28 2026 GMT', valid_to: 'Oct 31 07:54:27 2026 GMT',
  issuer: { CN: 'YE2' }, subjectaltname: 'IP Address:124.223.95.142', fingerprint256: 'AB:CD',
}
const argumentsFor = ['--url', 'https://124.223.95.142', '--origin', 'https://wojisama.github.io']
const options = parseOptions(argumentsFor, {})
const inspect = async () => certificateSummary(certificate, 'TLSv1.3', now)
const token = 'private-placeholder-token-1234567890'

function response(status, value, origin) {
  return { status, body: value === undefined ? '' : JSON.stringify(value), headers: {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Accept-Encoding, Origin',
    ...(origin ? { 'access-control-allow-origin': origin } : {}),
  } }
}
function contractRequest(calls) {
  return async (endpoint, path, request) => {
    calls.push({ endpoint, path, ...request })
    const origin = request.headers.Origin
    if (request.method === 'OPTIONS') {
      if (!origin) return response(403, { error: { code: 'origin_rejected' } })
      if (request.headers['Access-Control-Request-Method'] === 'PUT' || request.headers['Access-Control-Request-Headers'] === 'X-Sceneweave-Probe') return response(403, { error: { code: 'invalid_preflight' } }, origin)
      const result = response(204, undefined, origin)
      result.headers['access-control-allow-methods'] = 'DELETE, GET, POST'
      result.headers['access-control-allow-headers'] = 'Content-Type, Authorization'
      return result
    }
    if (origin && origin !== options.origin) return response(403, { error: { code: 'origin_rejected' } })
    if (path === '/healthz') return response(200, { ok: true })
    if (!request.headers.Authorization) return response(401, { error: { code: 'unauthorized' } }, origin)
    return response(200, { schemaVersion: 1, retentionDays: 7, capabilities: { conversation: true, connectionTool: true, sceneDraft: true, svg: true, vision: 'unverified' }, model: 'private-model-value' }, origin)
  }
}

test('CLI requires exact HTTPS origins and never accepts credentials as an argument', () => {
  assert.equal(options.minHours, 48)
  assert.equal(parseOptions([...argumentsFor, '--min-hours', '72', '--timeout-ms', '500'], {}).minHours, 72)
  for (const invalid of [
    [], ['--url', 'http://124.223.95.142', '--origin', options.origin],
    ['--url', `${options.endpoint}/healthz`, '--origin', options.origin],
    ['--url', options.endpoint, '--origin', `${options.origin}/sceneweave/`],
    ['--url', 'https://user:secret@example.com', '--origin', options.origin],
    [...argumentsFor, '--url', options.endpoint], [...argumentsFor, '--token', token],
    [...argumentsFor, '--timeout-ms', 'Infinity'], [...argumentsFor, '--min-hours', '-1'],
  ]) assert.throws(() => parseOptions(invalid, {}), /invalid_arguments/)
  assert.throws(() => parseOptions([...argumentsFor, '--authenticated'], {}), /missing_access_token/)
  assert.equal(parseOptions([...argumentsFor, '--authenticated'], { SCENEWEAVE_AI_ACCESS_TOKEN: token }).token, token)
})

test('certificate report records the trusted public certificate and remaining lifetime', () => {
  assert.deepEqual(certificateSummary(certificate, 'TLSv1.3', now), {
    issuer: 'YE2', subjectAltName: 'IP Address:124.223.95.142', fingerprint256: 'AB:CD',
    validFrom: '2026-10-24T15:54:28.000Z', validTo: '2026-10-31T07:54:27.000Z', remainingHours: 151.91, protocol: 'TLSv1.3',
  })
  for (const invalid of [{ ...certificate, valid_to: 'invalid' }, { ...certificate, valid_to: 'Oct 24 22:00:00 2026 GMT' }, { ...certificate, valid_from: 'Oct 26 00:00:00 2026 GMT' }]) assert.throws(() => certificateSummary(invalid, 'TLSv1.3', now), /invalid_certificate/)
})

test('TLS uses default CA trust, checks the IP SAN and avoids IP SNI', async () => {
  let connectionOptions, destroyed = false
  const socket = new EventEmitter()
  Object.assign(socket, { authorized: true, destroy: () => { destroyed = true }, getPeerCertificate: () => certificate, getProtocol: () => 'TLSv1.3' })
  const connect = value => { connectionOptions = value; queueMicrotask(() => socket.emit('secureConnect')); return socket }
  const value = await inspectCertificate(options.endpoint, { connect, now })
  assert.equal(value.issuer, 'YE2'); assert.equal(destroyed, true)
  assert.equal(connectionOptions.rejectUnauthorized, true); assert.equal(connectionOptions.servername, undefined)
  assert.equal(connectionOptions.checkServerIdentity('ignored', certificate), undefined)
  assert.ok(connectionOptions.checkServerIdentity('ignored', { subjectaltname: 'IP Address:127.0.0.1' }) instanceof Error)
})

test('unauthorized TLS and network errors do not disclose transport exception messages', async () => {
  for (const authorized of [false, undefined]) {
    const socket = new EventEmitter()
    Object.assign(socket, { authorized, destroy() {}, getPeerCertificate: () => certificate })
    await assert.rejects(inspectCertificate(options.endpoint, { now, connect: () => { queueMicrotask(() => socket.emit('secureConnect')); return socket } }), /tls_not_authorized/)
  }
  await assert.rejects(inspectCertificate(options.endpoint, { connect() { throw new Error(token) } }), error => error.message === 'tls_connection_failed')
})

test('HTTP probe validates trust and bounds untrusted response bytes', async () => {
  let requestOptions, outgoing
  const request = (_url, value, callback) => {
    requestOptions = value; outgoing = new EventEmitter()
    Object.assign(outgoing, { destroy() {}, end() {
      const incoming = new EventEmitter()
      Object.assign(incoming, { statusCode: 200, headers: {}, destroy() {} })
      callback(incoming)
      queueMicrotask(() => incoming.emit('data', Buffer.alloc(32 * 1024 + 1)))
    } })
    return outgoing
  }
  await assert.rejects(requestEndpoint(options.endpoint, '/healthz', { request }), /response_too_large/)
  assert.equal(requestOptions.rejectUnauthorized, true)
  assert.equal(requestOptions.servername, undefined)
  assert.equal(requestOptions.headers['Accept-Encoding'], 'identity')
})

test('HTTP probe times out an unresponsive endpoint', async () => {
  let destroyed = false
  const request = () => Object.assign(new EventEmitter(), { end() {}, destroy() { destroyed = true } })
  await assert.rejects(requestEndpoint(options.endpoint, '/healthz', { request, timeoutMs: 5 }), /request_timeout/)
  assert.equal(destroyed, true)
})

test('default online plan performs only anonymous health/auth rejection and OPTIONS checks', async () => {
  const calls = []
  const report = await runOnlineChecks(options, { inspect, request: contractRequest(calls), now })
  assert.equal(report.ok, true)
  assert.equal(report.checks.length, 10)
  assert.equal(report.authenticated, false)
  assert.equal(calls.length, 9)
  assert.ok(calls.every(call => call.method === 'GET' || call.method === 'OPTIONS'))
  assert.ok(calls.every(call => !call.headers.Authorization && !call.body))
  assert.ok(calls.every(call => call.path === '/healthz' || call.path === '/v1/capabilities' || (call.path === '/v1/tasks' && call.method === 'OPTIONS')))
})

test('optional capability check keeps the token and model out of its report', async () => {
  const calls = []
  const report = await runOnlineChecks({ ...options, token }, { inspect, request: contractRequest(calls), now })
  assert.equal(report.ok, true)
  assert.equal(report.checks.length, 11)
  const authorized = calls.filter(call => call.headers.Authorization)
  assert.equal(authorized.length, 1)
  assert.equal(authorized[0].path, '/v1/capabilities')
  assert.equal(JSON.stringify(report).includes(token), false)
  assert.equal(JSON.stringify(report).includes('private-model-value'), false)
})

test('certificate threshold and exact CORS mismatches produce actionable failure codes', async () => {
  const report = await runOnlineChecks({ ...options, minHours: 152 }, { inspect, now, request: async (...args) => {
    const result = await contractRequest([])(...args)
    if (args[2].headers.Origin === options.origin) result.headers['access-control-allow-origin'] = '*'
    return result
  } })
  assert.equal(report.ok, false)
  assert.equal(report.checks.find(value => value.name === 'trusted_tls_and_certificate').error, 'certificate_renewal_due')
  assert.equal(report.checks.find(value => value.name === 'preflight_get').error, 'unexpected_headers')
})

test('exception messages and service response bodies cannot leak into failure output', async () => {
  const report = await runOnlineChecks(options, { now, inspect() { throw new Error(token) }, request() { throw new Error(token) } })
  assert.equal(report.ok, false)
  assert.equal(report.checks.length, 10)
  assert.equal(JSON.stringify(report).includes(token), false)
  assert.ok(report.checks.every(value => value.error === 'request_failed'))
})
