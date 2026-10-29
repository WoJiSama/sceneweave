import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createControlledTaskRunner } from './task-runner.js'
import { loadAiConfig } from './config.js'
import { terrainAuthoringFixture } from '../../tests/helpers/terrain-authoring-fixture.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('controlled runner actual local HTTP transport', () => {
  it('does not send at construction and sends the post-cooldown final payload without hidden fetch waits', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sceneweave-runner-http-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const bodies: Record<string, unknown>[] = [], times: number[] = []
    let clock = 1000
    const server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += String(chunk)
      bodies.push(JSON.parse(body)); times.push(performance.now())
      const first = bodies.length === 1
      if (first) clock += 269950
      const delta = first ? { tool_calls: [{ index: 0, id: 'check-before-cooldown', type: 'function', function: { name: 'sceneweave_check_draft', arguments: '{}' } }] } : {}
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }))
    const address = server.address(); if (!address || typeof address === 'string') throw Error('No local address')
    const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ACCESS_TOKEN: 'a'.repeat(40),
      SCENEWEAVE_AI_PROVIDER_BASE_URL: `http://127.0.0.1:${address.port}/v1`, SCENEWEAVE_AI_PROVIDER_API_KEY: 'local-http-only',
      SCENEWEAVE_AI_PROVIDER_MODEL: 'local-model', SCENEWEAVE_AI_PROVIDER_REASONING_EFFORT: 'low' })
    const runner = createControlledTaskRunner(config, { cooldownMs: 100, now: () => clock })
    cleanups.push(() => runner.close())
    expect(bodies).toHaveLength(0); expect(runner.store.count()).toBe(0)
    const source = terrainAuthoringFixture(), snapshot = runner.engine.create('local-owner', { schemaVersion: 1, clientRequestId: randomUUID(),
      prompt: 'Run one check and finish honestly.', context: { sceneId: source.project.document.sceneId, revision: source.project.document.revision, audience: 'public' }, authoring: source })
    await vi.waitFor(() => expect(runner.store.read(snapshot.id).completedRequests).toBe(1), { timeout: 3000, interval: 5 })
    expect(runner.store.read(snapshot.id).snapshot.usage.requests).toBe(1)
    expect(runner.store.remaining(runner.store.read(snapshot.id))).toBe(30050)
    clock += 100
    await vi.waitFor(() => expect(runner.store.read(snapshot.id).snapshot.status).toBe('completed'), { timeout: 3000, interval: 5 })
    expect(bodies).toHaveLength(2)
    expect((bodies[0].tools as unknown[]).length).toBeGreaterThan(0)
    expect(bodies[1]).not.toHaveProperty('tools')
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'low', thinking: { type: 'enabled' } })
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(95)
    expect(runner.store.read(snapshot.id).snapshot.usage).toMatchObject({ requests: 2, unknown: false, inputTokens: 8, outputTokens: 6 })
    expect(runner.store.read(snapshot.id).snapshot.error).toBeNull()
  })
})
