import { afterEach, expect, it, vi } from 'vitest'
import { fixture } from '../../../application/workspace/test-fixtures.js'
import { canonicalProjectCoordinates } from '../../../shared/aggregates/scene-coordinates.js'
import * as json from '../../../shared/project/json.js'
import { cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { createProjectMaterializer, materializeProjectContent, partitionProjectContent, type ProjectBlockManifest } from './content-blocks.js'

afterEach(() => vi.restoreAllMocks())
function setup() {
  const project = fixture().project, first = partitionProjectContent(project)
  const next = cloneJson(project); next.document.revision++; next.document.title = 'another version'
  const second = partitionProjectContent(next)
  const blocks = new Map([...first.blocks, ...second.blocks].map(block => [block.sha256, block]))
  return { first, second, blocks, read: async (hash: string) => blocks.get(hash) }
}

it('reuses strictly parsed actual blocks across different manifests and returns independent runtime fields', async () => {
  const { first, second, read, blocks } = setup(), parse = vi.spyOn(json, 'parseBoundedJson')
  const context = createProjectMaterializer(read)
  try {
    const a = await context.materialize(first.manifest), b = await context.materialize(second.manifest)
    expect(parse).toHaveBeenCalledTimes(blocks.size)
    const expected = canonicalProjectCoordinates(b)
    a.document.props.item.rotationDeg = 91
    a.historyIdentity.lineageId = 'changed'
    expect(canonicalProjectCoordinates(b)).toBe(expected)
    expect(await context.materialize(first.manifest)).toEqual(await materializeProjectContent(first.manifest, read))
    // A verified parse owns its data; mutable input bytes never remain its source.
    for (const block of blocks.values()) block.bytes.fill(0)
    expect(canonicalProjectCoordinates(await context.materialize(second.manifest))).toBe(expected)
    await expect(createProjectMaterializer(read).materialize(first.manifest)).rejects.toThrow(/hash/)
  } finally { context.close() }
  await expect(context.materialize(first.manifest)).rejects.toThrow(/释放/)
})

it('charges each manifest the full distinct-block node budget even on cache hits', async () => {
  const { first, blocks, read } = setup()
  const nodes = [...new Set(first.manifest.fields.flatMap(field => field.blocks.map(ref => ref.sha256)))].reduce((sum, hash) => {
    const budget = { values: 0 }; json.parseBoundedJson(blocks.get(hash)!.bytes, budget); return sum + budget.values
  }, 0)
  const parse = vi.spyOn(json, 'parseBoundedJson'), context = createProjectMaterializer(read, { values: nodes - 1 })
  try {
    await expect(context.materialize(first.manifest)).rejects.toThrow(/累计节点/)
    const count = parse.mock.calls.length
    await expect(context.materialize(first.manifest)).rejects.toThrow(/累计节点/)
    expect(parse).toHaveBeenCalledTimes(count)
  } finally { context.close() }
})

it.each([0, 2048])('falls back safely when parsed entries cannot fit the optional %s byte cache', async retainedBytes => {
  const { first, second, read } = setup(), context = createProjectMaterializer(read, { retainedBytes })
  try {
    for (const manifest of [first.manifest, second.manifest, first.manifest]) {
      expect(await context.materialize(manifest)).toEqual(await materializeProjectContent(manifest, read))
    }
  } finally { context.close() }
})

it('rejects changed reference lengths, complete hashes, missing blocks and duplicate references after a warm parse', async () => {
  const { first, read } = setup(), context = createProjectMaterializer(read)
  try {
    await context.materialize(first.manifest)
    const length = cloneJson(first.manifest); length.fields[0].blocks[0].byteLength++
    await expect(context.materialize(length)).rejects.toThrow(/长度/)
    const hash = cloneJson(first.manifest); hash.contentHash = '0'.repeat(64)
    await expect(context.materialize(hash)).rejects.toThrow(/完整hash/)
    const missing = cloneJson(first.manifest); missing.fields[0].blocks[0].sha256 = '0'.repeat(64)
    await expect(context.materialize(missing)).rejects.toThrow(/块记录/)
    const duplicate = cloneJson(first.manifest); duplicate.fields[0].mode = 'record'; duplicate.fields[0].blocks.push(duplicate.fields[0].blocks[0])
    await expect(context.materialize(duplicate)).rejects.toThrow(/引用无效或重复/)
  } finally { context.close() }
})

it.each([
  ['invalid UTF8', new Uint8Array([0xff])],
  ['noncanonical JSON', encodeUtf8('{ "x":1}')],
  ['decoded duplicate keys', encodeUtf8('{"x":1,"\\u0078":2}')],
  ['excess depth', encodeUtf8('['.repeat(130) + '0' + ']'.repeat(130))],
] as const)('retains strict parsing for %s', async (_name, bytes) => {
  const block = { bytes, sha256: sha256Bytes(bytes) }
  const manifest: ProjectBlockManifest = { format: 'sceneweave-project-content-blocks', version: 1, contentHash: '0'.repeat(64), byteLength: bytes.length,
    fields: [{ path: ['document'], mode: 'value', blocks: [{ sha256: block.sha256, byteLength: bytes.length }] }] }
  const context = createProjectMaterializer(async () => block)
  try { await expect(context.materialize(manifest)).rejects.toThrow() } finally { context.close() }
})
