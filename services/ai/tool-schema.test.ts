import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { compositionCandidateFixture } from '../../tests/helpers/composition-candidates-fixture.js'
import { CurrentSceneAuthoringOperationKindSchema } from '../../src/shared/ai/authoring-protocol-v4.js'
import { VisualAuthoringKindSchema } from '../../src/shared/ai/visual-protocol.js'
import { getAuthoringTools } from './authoring-tools.js'
import { compactProviderTools } from './tool-schema.js'
import { TaskStore } from './store.js'
import { TaskEngine } from './engine.js'
import { connectionInfo } from './app.js'
import { loadAiConfig } from './config.js'
import type { ProviderCompletion, ProviderInput, ProviderToolDefinition } from './provider-types.js'

function fullCatalogue() {
  const start = compositionCandidateFixture()
  start.scope.operations = ['transform', 'opacity', 'place']
  start.scope.scene!.operations = [...CurrentSceneAuthoringOperationKindSchema.options]
  start.scope.visual!.operations = [...VisualAuthoringKindSchema.options]
  return getAuthoringTools(start.scope, 4)
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const schema = (tools: ProviderToolDefinition[], name: string) => tools.find(tool => tool.name === name)!.parameters
// Expanding every emitted local reference must reproduce the entire original
// JSON schema, not just a hand-picked subset of successful argument examples.
function expand(value: unknown, root?: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(item => expand(item, root))
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>, source = root ?? object
  if ('$ref' in object) {
    expect(Object.keys(object)).toEqual(['$ref'])
    expect(object.$ref).toMatch(/^#\/\$defs\/c\d+$/)
    const key = (object.$ref as string).split('/').at(-1)!
    expect((source.$defs as Record<string, unknown>)[key]).toBeDefined()
    return expand((source.$defs as Record<string, unknown>)[key], source)
  }
  return Object.fromEntries(Object.entries(object).filter(([key]) => value !== source || key !== '$defs')
    .map(([key, item]) => [key, expand(item, source)]))
}

describe('lossless provider-only tool schema compaction', () => {
  it('reduces the full current capability catalogue while preserving every schema after local reference expansion', () => {
    const original = fullCatalogue(), before = JSON.stringify(original), compact = compactProviderTools(original)
    expect(bytes(compact)).toBeLessThan(bytes(original) * .65)
    expect(compact.map(tool => tool.name)).toEqual(original.map(tool => tool.name))
    for (let i = 0; i < original.length; i++) {
      expect(compact[i].description).toBe(original[i].description)
      expect(expand(compact[i].parameters)).toEqual(JSON.parse(JSON.stringify(original[i].parameters)))
      expect(compact[i].parameters.type).toBe(original[i].parameters.type)
      expect(compact[i].parameters.required).toEqual(original[i].parameters.required)
      expect(compact[i].parameters.additionalProperties).toBe(original[i].parameters.additionalProperties)
    }
    expect(JSON.stringify(original)).toBe(before)
    expect(compactProviderTools(original)).toEqual(compact)
  })

  it.each([
    { operations: [{ kind: 'room', id: 'hall', boundaryMm: [{ x: 1000, y: 1000 }, { x: 6000, y: 1000 }, { x: 6000, y: 5000 }], thicknessMm: 200 }] },
    { operations: [{ kind: 'entrance', openingIds: ['door'] }] },
    { operations: [{ kind: 'entrance', id: 'unknown-field', openingIds: ['door'] }] },
    { operations: [{ kind: 'opening', id: 'door', wallId: 'wall', offsetReferenceVertexId: 'vertex', offsetMm: 500.5, widthMm: 1000, openingKind: 'door' }] },
    { operations: [{ kind: 'path', id: 'road', centerlineMm: [{ x: 1000, y: 1000 }, { x: 3000, y: 3000 }], widthMm: 1500, supportRefs: [{ kind: 'floor', id: 'floor' }] }] },
    { operations: [{ kind: 'UNGRANTED_OPERATION', id: 'item' }] },
    { operations: [] },
    { operations: [{ kind: 'opacity', id: 'item', value: 1.1 }] },
  ])('preserves JSON-schema acceptance, integer ranges and strict branch fields for %j', args => {
    const original = fullCatalogue(), compact = compactProviderTools(original)
    const before = z.fromJSONSchema(schema(original, 'sceneweave_edit_scene'))
    const after = z.fromJSONSchema(schema(compact, 'sceneweave_edit_scene'))
    expect(after.safeParse(args).success).toBe(before.safeParse(args).success)
  })

  it('leaves existing local/recursive reference scopes unchanged and never interprets const data as a schema', () => {
    const parameters = { type: 'object', properties: { next: { $ref: '#/$defs/node' } }, $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } } }
    const input = [{ name: 'existing', description: 'existing scoped schema', parameters }]
    expect(compactProviderTools(input)).toEqual(input)
    const literal = { marker: 'x'.repeat(200) }, data = [{ name: 'literal', description: 'data', parameters: { type: 'object', properties: { a: { const: literal }, b: { const: literal } } } }]
    expect(expand(compactProviderTools(data)[0].parameters)).toEqual(data[0].parameters)
  })

  it('sends compact current schemas through the real engine and preserves rejected-step recovery and strict execution', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sceneweave-compact-tools-'))
    const config = loadAiConfig({ SCENEWEAVE_AI_DATA_DIR: directory, SCENEWEAVE_AI_ALLOWED_ORIGINS: 'https://editor.example.test', SCENEWEAVE_AI_ACCESS_TOKEN: 'a'.repeat(40),
      SCENEWEAVE_AI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/v1', SCENEWEAVE_AI_PROVIDER_API_KEY: 'unit-only-private', SCENEWEAVE_AI_PROVIDER_MODEL: 'mock' })
    const store = new TaskStore(directory), inputs: ProviderInput[] = []
    const room = { kind: 'room', id: 'hall', boundaryMm: [{ x: 2000, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 8000 }, { x: 2000, y: 8000 }], thicknessMm: 200 }
    const engine = new TaskEngine(store, { complete: async input => {
      inputs.push(input)
      const operations = inputs.length === 1 ? [room, { kind: 'entrance', id: 'bad', openingIds: ['door'] }] : [room]
      const calls = inputs.length <= 2 ? [{ id: `round-${inputs.length}`, name: 'sceneweave_edit_scene', arguments: JSON.stringify({ operations }) }] : []
      return { text: '', toolCalls: calls, finishReason: calls.length ? 'tool_calls' : 'stop', usage: { inputTokens: 1, outputTokens: 1 }, requestId: 'mock' } as ProviderCompletion
    } }, connectionInfo(config))
    try {
      const authoring = compositionCandidateFixture(), original = getAuthoringTools(authoring.scope, 4)
      const result = engine.create('test', { schemaVersion: 1, clientRequestId: randomUUID(), prompt: 'Build only the granted room.', context: {
        sceneId: authoring.project.document.sceneId, revision: authoring.project.document.revision, audience: 'public' }, authoring })
      await vi.waitFor(() => expect(store.read(result.id).snapshot.status).toBe('waiting_browser'), { timeout: 5000, interval: 10 })
      const task = store.read(result.id)
      expect(inputs).toHaveLength(3)
      const editSchema = schema(inputs[0].tools, 'sceneweave_edit_scene')
      expect(editSchema.$defs).toBeDefined()
      expect(expand(editSchema)).toEqual(JSON.parse(JSON.stringify(schema(original, 'sceneweave_edit_scene'))))
      expect(task.snapshot.tools.map(result => result.success)).toEqual([false, true])
      expect(task.authoring!.state.steps).toHaveLength(1)
      expect(task.authoring!.state.draftRevision).toBe(1)
    } finally { engine.close(); store.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
