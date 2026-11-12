import { describe, expect, it, vi } from 'vitest'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import { defaultVolcanoInput } from '../../shared/generation/domains/volcano/index.js'
import { defaultMixedInput, defaultMixedInputV4 } from '../../shared/generation/domains/mixed/index.js'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { cloneJson } from '../../shared/validation/json.js'
import { fromBundle } from './project.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { prepareGenerationIntent, type GenerationContentPort, type InteriorGenerationUiRequest, type ForestGenerationUiRequest,
  type VolcanoGenerationUiRequest, type MixedGenerationUiRequest } from './generation-intent.js'

const interior = (): InteriorGenerationUiRequest => ({ title: 'Room request', widthMm: 12000, heightMm: 8000, seed: 'intent-seed', wallThicknessMm: 200,
  rooms: [{ id: 'room-1', purpose: 'Study', minAreaMm2: 1_000_000, maxAreaMm2: 9_000_000, minClearSideMm: 1000 }], relations: [],
  corridor: { axis: 'none', clearWidthMm: 1500 }, arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 900, clearWidthMm: 1000 } })
const forest = (): ForestGenerationUiRequest => ({ title: 'Forest request', widthMm: 40000, heightMm: 32000, seed: 'forest-seed',
  clearings: [{ id: 'camp', boundsMm: { x: 2000, y: 3000, width: 4000, height: 6000 } }], entranceSide: 'north', routeWidthMm: 1501,
  treeCoveragePpm: 50000, shrubCoveragePpm: 4000, grassCoveragePpm: 1000 })
const volcano = (): VolcanoGenerationUiRequest => ({ title: 'Volcano request', widthMm: 40000, heightMm: 32000, seed: 'volcano-seed',
  mountainElevationMm: 3000, craterElevationMm: 250, craterWidthPercent: 25, craterHeightPercent: 40, craterCenterYPercent: 60,
  routeWidthMm: 1800, connectionKind: 'ramp', craterHazard: false, craterBlocksMovement: true, craterMovementCostMultiplier: 4,
  flowEnabled: true, flowWidthMm: 1000, lavaAppearance: 'cold', flowHazard: false, flowBlocksMovement: false, flowMovementCostMultiplier: 2 })
const mixed = (): MixedGenerationUiRequest => ({ title: 'Mixed request', environment: 'volcano', widthMm: 40000, heightMm: 32000,
  seed: 'mixed-seed', roomCount: 2, purpose: 'Research', furniture: false, vegetationMultiplier: 1.5 })

async function environment() {
  const base = await fromBundle(fixture(), validation), palette = [{ role: 'seat' as const, ref: { id: 'adapter-seat', version: 7 } }]
  const volcanoDefaults = defaultVolcanoInput(base.document, 'volcano-seed')
  const mixedDefaults = defaultMixedInput(base.document, 'volcano', 'mixed-seed')
  const content: GenerationContentPort = {
    interior: async () => ({ base, palette }),
    forest: async () => ({ base, groundMaterial: { id: 'adapter-ground', version: 3 }, routeMaterial: { id: 'adapter-route', version: 4 }, palettes: {
      tree: [{ key: 'oak', definitionRef: { id: 'adapter-oak', version: 5 }, kind: 'prop', weight: 1 }],
      shrub: [{ key: 'fern', definitionRef: { id: 'adapter-fern', version: 2 }, kind: 'decoration', weight: 1 }],
      grass: [{ key: 'sedge', definitionRef: { id: 'adapter-sedge', version: 6 }, kind: 'decoration', weight: 1 }],
    } }),
    volcano: async () => ({ base, defaults: volcanoDefaults, flowMaterials: { cold: { id: 'adapter-cold', version: 8 }, hot: { id: 'adapter-hot', version: 9 } } }),
    mixed: async () => ({ base, defaults: mixedDefaults }),
  }
  const selectBudget = vi.fn(() => taskBudgetProfile('standard'))
  return { runtime, content, selectBudget, base, palette, volcanoDefaults, mixedDefaults }
}

describe('application generation intent preparation', () => {
  it('captures nested user intent before asynchronous content preparation and isolates supplied palettes', async () => {
    const env = await environment(), input = interior(), original = cloneJson(input)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), prepare = env.content.interior
    env.content.interior = vi.fn(async (request, options) => { await gate; return prepare(request, options) })
    const pending = prepareGenerationIntent({ domain: 'interior', request: input }, env)
    input.rooms[0].purpose = 'Changed during load'; input.arrangement.furniture = false
    release()
    const result = await pending
    expect(result).toMatchObject({ kind: 'new-project', domain: 'interior', input: { version: 1, algorithmVersion: 5, seed: original.seed,
      parameters: { rooms: original.rooms, corridor: original.corridor, arrangement: { ...original.arrangement, palette: env.palette } } } })
    expect(env.content.interior).toHaveBeenCalledWith(expect.objectContaining({ title: original.title, preset: 'narrative', gridVisible: false, seed: original.seed }), expect.any(Object))
    expect(env.selectBudget).toHaveBeenCalledExactlyOnceWith({ widthMm: 12000, heightMm: 8000, quality: 'standard', mode: 'auto' })
    env.palette[0].ref.version = 10
    expect(result.input.parameters.arrangement.palette[0].ref.version).toBe(7)
  })

  it('keeps forest clearings and entrance geometry in the base floor while consuming injected fixed references', async () => {
    const env = await environment(), input = forest(), bounds = Object.values(env.base.document.floors)[0].boundsMm
    const result = await prepareGenerationIntent({ domain: 'forest', request: input }, env), p = result.input.parameters
    expect(result.input.algorithmVersion).toBe(2)
    expect(p.ground).toEqual({ kind: 'new', elevationMm: 0, materialRef: { id: 'adapter-ground', version: 3 } })
    expect(p.clearings[0]).toMatchObject({ id: 'camp', anchorMm: { x: bounds.x + 4000, y: bounds.y + 6000 }, clearanceMm: 300 })
    expect(p.entrances[0]).toMatchObject({ positionMm: { x: Math.round(bounds.x + bounds.width / 2), y: bounds.y + 1051 }, directionDeg: 90, widthMm: 1501 })
    expect(p.zones[0].vegetation.map(row => [row.role, row.coveragePpm, row.palette[0].definitionRef.id])).toEqual([
      ['tree', 50000, 'adapter-oak'], ['shrub', 4000, 'adapter-fern'], ['grass', 1000, 'adapter-sedge'],
    ])
    expect(p.routes[0]).toMatchObject({ fromEntranceId: 'entry', toClearingId: 'camp', materialRef: { id: 'adapter-route', version: 4 } })
  })

  it('maps volcano geometry, traversal and appearance independently without changing the supplied default recipe', async () => {
    const env = await environment(), defaults = cloneJson(env.volcanoDefaults), input = volcano()
    const result = await prepareGenerationIntent({ domain: 'volcano', request: input }, env), p = result.input.parameters, b = p.boundsMm
    expect(p.mountain.elevationMm).toBe(3000)
    expect(p.crater).toMatchObject({ elevationMm: 250, hazard: false, blocksMovement: true, movementCostMultiplier: 4 })
    expect(p.crater.boundaryMm[0]).toEqual({ x: b.x + Math.round(b.width * .55), y: b.y + Math.round(b.height * .4) })
    expect(p.ascent.kind).toBe('ramp'); expect(p.descent.kind).toBe('ramp')
    expect(p.flow).toMatchObject({ widthMm: 1000, hazard: false, blocksMovement: false, movementCostMultiplier: 2 })
    expect(p.materials.flow).toEqual({ id: 'adapter-cold', version: 8 })
    expect(env.volcanoDefaults).toEqual(defaults)
    const disabled = await prepareGenerationIntent({ domain: 'volcano', request: { ...input, flowEnabled: false } }, env)
    expect(disabled.input.parameters.flow).toBeNull()
  })

  it('keeps omitted and explicit uniform distribution inputs identical', async () => {
    const env = await environment()
    const forestDefault = await prepareGenerationIntent({ domain: 'forest', request: forest() }, env)
    const forestUniform = await prepareGenerationIntent({ domain: 'forest', request: { ...forest(), woodlandDistribution: 'uniform' } }, env)
    expect(forestUniform.input).toEqual(forestDefault.input)
    const mixedDefault = await prepareGenerationIntent({ domain: 'mixed', request: mixed() }, env)
    const mixedUniform = await prepareGenerationIntent({ domain: 'mixed', request: { ...mixed(), woodlandDistribution: 'uniform' } }, env)
    expect(mixedUniform.input).toEqual(mixedDefault.input)
  })

  it('expands forest and mixed form choices to complete fixed zones without changing supplied defaults or building/path requests', async () => {
    const env = await environment(), document = createShoreBlankDocument('island', { sceneId: 'intent-woodland', title: 'Woodland',
      now: '2026-11-12T00:00:00.000Z', widthMm: 40000, heightMm: 32000, preset: 'narrative' }, true, true)
    const base = { ...env.base, document }, defaults = defaultMixedInputV4(document, 'forest', 'intent-copses')
    if (defaults.parameters.outdoor.kind !== 'forest') throw new Error('forest expected')
    const palettes = Object.fromEntries(defaults.parameters.outdoor.parameters.zones[0].vegetation.map(row => [row.role, row.palette])) as Awaited<ReturnType<GenerationContentPort['forest']>>['palettes']
    env.content.forest = async () => ({ base, groundMaterial: { id: 'shore-v1-material-grass', version: 1 }, routeMaterial: { id: 'shore-v1-material-sand-dry', version: 1 }, palettes })
    env.content.mixed = async () => ({ base, defaults })
    const before = cloneJson(defaults)
    const trees = await prepareGenerationIntent({ domain: 'forest', request: { ...forest(), woodlandDistribution: 'copses' } }, env)
    expect(trees.input.parameters.zones).toHaveLength(4)
    expect(trees.input.algorithmVersion).toBe(2)
    const request = { ...mixed(), environment: 'forest' as const, woodlandDistribution: 'copses' as const }
    const grouped = await prepareGenerationIntent({ domain: 'mixed', request }, env)
    const uniform = await prepareGenerationIntent({ domain: 'mixed', request: { ...request, woodlandDistribution: 'uniform' } }, env)
    expect(grouped.input.algorithmVersion).toBe(4)
    expect(grouped.input.parameters.outdoor.parameters).toHaveProperty('zones', expect.any(Array))
    if (grouped.input.parameters.outdoor.kind !== 'forest') throw new Error('forest expected')
    expect(grouped.input.parameters.outdoor.parameters.zones).toHaveLength(4)
    expect(grouped.input.parameters.building).toEqual(uniform.input.parameters.building)
    expect(grouped.input.parameters.approach).toEqual(uniform.input.parameters.approach)
    expect(defaults).toEqual(before)
  })

  it('rejects unsupported distribution choices before loading forest or mixed resources', async () => {
    const env = await environment(), forestContent = vi.spyOn(env.content, 'forest'), mixedContent = vi.spyOn(env.content, 'mixed')
    await expect(prepareGenerationIntent({ domain: 'forest', request: { ...forest(), woodlandDistribution: 'anything' } as unknown as ForestGenerationUiRequest }, env)).rejects.toThrow(/植被分布/)
    await expect(prepareGenerationIntent({ domain: 'mixed', request: { ...mixed(), woodlandDistribution: 'anything' } as unknown as MixedGenerationUiRequest }, env)).rejects.toThrow(/植被分布/)
    expect(forestContent).not.toHaveBeenCalled(); expect(mixedContent).not.toHaveBeenCalled()
  })

  it('maps mixed building requirements and preserves the default outdoor domain', async () => {
    const env = await environment(), defaults = cloneJson(env.mixedDefaults), input = mixed()
    const result = await prepareGenerationIntent({ domain: 'mixed', request: input }, env), p = result.input.parameters
    expect(p.building.rooms.map(room => [room.id, room.purpose, room.minClearSideMm])).toEqual([['room-1', 'Research', 1200], ['room-2', 'Research', 1200]])
    expect(p.building.arrangement.furniture).toBe(false); expect(p.building.relations).toEqual([])
    expect(p.outdoor).toEqual(defaults.parameters.outdoor)
    expect(result.input.algorithmVersion).toBe(2)
    expect(env.mixedDefaults).toEqual(defaults)
  })

  it.each([1, 2, 3, 4] as const)('prepares the explicitly selected mixed version %s without rewriting defaults', async algorithmVersion => {
    const env = await environment(), defaults = cloneJson(env.mixedDefaults)
    const result = await prepareGenerationIntent({ domain: 'mixed', request: { ...mixed(), algorithmVersion } }, env)
    expect(result.input.algorithmVersion).toBe(algorithmVersion)
    expect(env.mixedDefaults).toEqual(defaults)
  })

  it('rejects an unsupported mixed version before loading content or selecting a budget', async () => {
    const env = await environment(), prepare = vi.spyOn(env.content, 'mixed')
    for (const algorithmVersion of [0, 5, '3']) {
      await expect(prepareGenerationIntent({ domain: 'mixed', request: { ...mixed(), algorithmVersion } as MixedGenerationUiRequest }, env)).rejects.toThrow(/算法版本/)
    }
    expect(prepare).not.toHaveBeenCalled(); expect(env.selectBudget).not.toHaveBeenCalled()
  })

  it('rejects accessors before content work and rejects a late cancelled result before budget selection', async () => {
    const env = await environment(), prepare = vi.spyOn(env.content, 'interior'), input = interior()
    let reads = 0
    Object.defineProperty(input.rooms[0], 'purpose', { enumerable: true, get() { reads++; return 'Unsafe' } })
    await expect(prepareGenerationIntent({ domain: 'interior', request: input }, env)).rejects.toThrow(/访问器/)
    expect(reads).toBe(0); expect(prepare).not.toHaveBeenCalled()
    const signal = { aborted: false }
    prepare.mockImplementation(async () => { signal.aborted = true; return { base: env.base, palette: env.palette } })
    await expect(prepareGenerationIntent({ domain: 'interior', request: interior() }, { ...env, signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(env.selectBudget).not.toHaveBeenCalled()
  })

  it('does not call a content adapter for an already cancelled request or select a budget after preparation failure', async () => {
    const env = await environment(), prepare = vi.spyOn(env.content, 'forest')
    await expect(prepareGenerationIntent({ domain: 'forest', request: forest() }, { ...env, signal: { aborted: true } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(prepare).not.toHaveBeenCalled()
    prepare.mockRejectedValue(new Error('Missing licensed catalogue'))
    await expect(prepareGenerationIntent({ domain: 'forest', request: forest() }, env)).rejects.toThrow('Missing licensed catalogue')
    expect(env.selectBudget).not.toHaveBeenCalled()
  })
})
