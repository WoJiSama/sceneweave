import { describe, expect, it } from 'vitest'
import { aggregateChunkAddress, aggregatePartitionPointOwner, aggregatePartitionSeed, buildAggregateChunkManifest, generateAggregatePartitionPoints, planAggregateChunks, type AggregatePartitionGenerationInput } from './chunks.js'

describe('aggregate spatial chunks', () => {
  it('stores one entity row with stable references across boundaries, regardless of input order or semantic groups', () => {
    const entries = [
      { id: 'road', floorId: 'ground', boundsMm: { x: -1000, y: 4000, width: 19000, height: 1000 } },
      { id: 'tree', floorId: 'ground', boundsMm: { x: 8500, y: 4200, width: 100, height: 100 } },
    ]
    const manifest = buildAggregateChunkManifest(entries, { modifiedEntityIds: ['tree'] })
    expect(manifest).toEqual(buildAggregateChunkManifest([...entries].reverse(), { modifiedEntityIds: ['tree'] }))
    expect(manifest.entries.filter(row => row.id === 'road')).toHaveLength(1)
    expect(manifest.chunks.filter(chunk => chunk.entityIds.includes('road'))).toHaveLength(4)
    expect(planAggregateChunks(manifest, { floorId: 'ground', boundsMm: { x: 7900, y: 4000, width: 200, height: 200 } }).entityIds).toEqual(['road', 'tree'])
    expect(manifest.chunks.find(chunk => chunk.key.x === 1)?.contentState).toBe('modified')
    expect(manifest.chunks.find(chunk => chunk.key.x === -1)?.contentState).toBe('generated')
  })

  it('includes arbitrary-distance dependencies and explicit offscreen selection without inferring ownership', () => {
    const manifest = buildAggregateChunkManifest([
      { id: 'route', floorId: 'ground', boundsMm: { x: 100, y: 100, width: 100, height: 100 }, dependencies: ['support'] },
      { id: 'support', floorId: 'ground', boundsMm: { x: 80000, y: 100, width: 100, height: 100 }, dependencies: ['note'] },
      { id: 'note', floorId: 'ground', boundsMm: null },
      { id: 'other', floorId: 'upper', boundsMm: { x: 100, y: 100, width: 100, height: 100 } },
    ])
    const plan = planAggregateChunks(manifest, { floorId: 'ground', boundsMm: { x: 0, y: 0, width: 500, height: 500 } })
    expect(plan.entityIds).toEqual(['note', 'route', 'support'])
    expect(plan.keys.map(aggregateChunkAddress)).toContain('["ground",10,0]')
    expect(planAggregateChunks(manifest, { selectedIds: ['other'] }).entityIds).toEqual(['other'])
    expect(() => planAggregateChunks(manifest, { selectedIds: ['missing'] })).toThrow(/不存在/)
  })

  it('keeps explicit planned cells empty, while oversized or unbounded entries conservatively remain queryable', () => {
    const manifest = buildAggregateChunkManifest([
      { id: 'large', floorId: 'ground', boundsMm: { x: 0, y: 0, width: 1e9, height: 1e9 } },
      { id: 'unbounded', floorId: 'ground', boundsMm: null },
    ], { plannedKeys: [{ floorId: 'ground', x: 1, y: 1 }], modifiedKeys: [{ floorId: 'ground', x: 2, y: 1 }] })
    expect(manifest.chunks[0]).toEqual({ key: { floorId: 'ground', x: 1, y: 1 }, contentState: 'planned', entityIds: [] })
    expect(manifest.chunks[1]).toEqual({ key: { floorId: 'ground', x: 2, y: 1 }, contentState: 'modified', entityIds: [] })
    expect(manifest.broadEntityIds).toEqual(['large', 'unbounded'])
    expect(planAggregateChunks(manifest, { floorId: 'ground', boundsMm: { x: 1e8, y: 1e8, width: 1, height: 1 } }).entityIds).toEqual(['large', 'unbounded'])
    expect(() => buildAggregateChunkManifest([{ id: 'bad', floorId: 'ground', boundsMm: null, dependencies: ['missing'] }])).toThrow(/依赖缺失/)
    expect(() => planAggregateChunks(manifest, { floorId: 'ground', boundsMm: { x: 0, y: 0, width: 1, height: 1 }, marginMm: Number.MAX_VALUE })).toThrow(/必须有限/)
  })

  it('derives new partition streams from logical region/recipe/key and assigns seam points to exactly one cell', () => {
    const input: AggregatePartitionGenerationInput = { algorithm: 'aggregate-partition-stream@1', seed: 'forest-17', domainAlgorithm: { id: 'natural', version: 1 }, recipe: { id: 'grove', version: 1 }, logicalRegionKey: 'western-grove', chunk: { floorId: 'ground', x: -1, y: 2 }, channel: 'tree' }
    const first = aggregatePartitionSeed(input)
    expect(aggregatePartitionSeed(structuredClone(input))).toBe(first)
    expect(aggregatePartitionSeed({ ...input, chunk: { ...input.chunk, x: 0 } })).not.toBe(first)
    expect(aggregatePartitionSeed({ ...input, channel: 'rock' })).not.toBe(first)
    expect(aggregatePartitionPointOwner('ground', { x: 8000, y: -1 })).toEqual({ floorId: 'ground', x: 1, y: -1 })
    expect(() => aggregatePartitionSeed({ ...input, instanceId: 'copy-id' } as AggregatePartitionGenerationInput)).toThrow(/稳定逻辑/)
    let reads = 0
    const getter = Object.defineProperty({}, 'seed', { enumerable: true, get() { reads++; return 'x' } })
    expect(() => aggregatePartitionSeed(getter as AggregatePartitionGenerationInput)).toThrow()
    expect(reads).toBe(0)
  })

  it('generates identical overlapping halo candidates in any chunk order and adopts every seam point only once', () => {
    const base = { algorithm: 'aggregate-partition-stream@1' as const, seed: 'grove-2', domainAlgorithm: { id: 'partition-point-candidates', version: 1 }, recipe: { id: 'grove', version: 1 }, logicalRegionKey: 'stable-grove', channel: 'trees', chunkSizeMm: 8000, spacingMm: 1000, jitterMm: 200, haloMm: 2000 }
    const left = generateAggregatePartitionPoints({ ...base, chunk: { floorId: 'floor', x: 0, y: 0 } })
    const right = generateAggregatePartitionPoints({ ...base, chunk: { floorId: 'floor', x: 1, y: 0 } })
    const reverseRight = generateAggregatePartitionPoints({ ...base, chunk: { floorId: 'floor', x: 1, y: 0 } })
    const reverseLeft = generateAggregatePartitionPoints({ ...base, chunk: { floorId: 'floor', x: 0, y: 0 } })
    expect([left, right]).toEqual([reverseLeft, reverseRight])
    const rightRows = new Map([...right.owned, ...right.halo].map(row => [row.key, row]))
    const shared = [...left.owned, ...left.halo].filter(row => rightRows.has(row.key))
    expect(shared.length).toBeGreaterThan(0)
    for (const row of shared) expect(row).toEqual(rightRows.get(row.key))
    const owned = [...left.owned, ...right.owned]
    expect(new Set(owned.map(row => row.key)).size).toBe(owned.length)
    for (const row of left.owned) expect(aggregatePartitionPointOwner('floor', row.positionMm).x).toBe(0)
  })
})
