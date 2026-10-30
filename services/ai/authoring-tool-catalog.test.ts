import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { compositionCandidateFixture } from '../../tests/helpers/composition-candidates-fixture.js'
import { terrainAuthoringFixture } from '../../tests/helpers/terrain-authoring-fixture.js'
import { AuthoringScopeSchema, type AuthoringScope, type AuthoringStart } from '../../src/shared/ai/authoring-protocol.js'
import { CompositionCandidateSchema } from '../../src/shared/ai/composition-candidates.js'
import { replayAuthoring } from '../../src/shared/ai/authoring.js'
import type { TerrainAuthoringOperation } from '../../src/shared/ai/terrain-protocol.js'
import { canonicalJson } from '../../src/shared/validation/json.js'
import type { StoredTask } from './store.js'
import type { ProviderToolDefinition } from './provider-types.js'
import { authoringTools, executeAuthoringTool, getAuthoringTools } from './authoring-tools.js'

type Schema = { type?: string; properties?: Record<string, Schema>; items?: Schema; oneOf?: Schema[]; anyOf?: Schema[];
  const?: unknown; enum?: unknown[]; required?: string[]; additionalProperties?: boolean; minItems?: number; maxItems?: number }
const publicGrant = { floorId: 'floor', layerId: 'layer', boundsMm: { x: 0, y: 0, width: 24000, height: 18000 },
  entityIds: [], definitionIds: ['definition'], materialIds: ['material'] }
function scene(operations: NonNullable<AuthoringScope['scene']>['operations']): NonNullable<AuthoringScope['scene']> {
  return { ...publicGrant, prefabDefinitionIds: [], operations }
}
function visual(operations: NonNullable<AuthoringScope['visual']>['operations']): NonNullable<AuthoringScope['visual']> {
  return { ...publicGrant, operations, allowGlobalEnvironment: true }
}
function scope(changes: Partial<AuthoringScope> = {}): AuthoringScope {
  return AuthoringScopeSchema.parse({ targetIds: [], operations: [], placement: null, ...changes })
}
function tool(catalog: ProviderToolDefinition[], name: string) {
  const value = catalog.find(item => item.name === name)
  if (!value) throw new Error(`Expected advertised tool ${name}`)
  return value
}
function branches(catalog: ProviderToolDefinition[], name: string): Schema[] {
  const items = (tool(catalog, name).parameters as Schema).properties!.operations.items!
  return items.oneOf ?? items.anyOf ?? [items]
}
function kinds(catalog: ProviderToolDefinition[], name: string) {
  return branches(catalog, name).map(branch => branch.properties!.kind.const as string).sort()
}
const names = (catalog: ProviderToolDefinition[]) => catalog.map(value => value.name)
// Model schemas use ordinary JSON serialization; Zod's internal hidden fields
// are not project data and are not sent through the strict project JSON gate.
const catalogJson = (catalog: ProviderToolDefinition[]) => JSON.stringify(catalog.map(value => ({ type: 'function',
  function: { name: value.name, description: value.description, parameters: value.parameters } })))
const terrainKinds: TerrainAuthoringOperation['kind'][] = ['terrainGenerate', 'terrainEdit', 'terrainLocal', 'regionalGenerate', 'regionalEdit']
const terrainTools = ['sceneweave_terrain_plan', 'sceneweave_terrain_candidates', 'sceneweave_terrain_apply_candidate',
  'sceneweave_terrain_regenerate_region', 'sceneweave_terrain_diagnose', 'sceneweave_region_scene_candidate']
const terrainCommonTools = ['sceneweave_terrain_plan', 'sceneweave_terrain_candidates', 'sceneweave_terrain_apply_candidate', 'sceneweave_terrain_diagnose']

function taskFor(start: AuthoringStart) {
  const task: StoredTask = { owner: 'test', fingerprint: 'test', messages: [], calls: {}, runtimeMs: 0, runStartedAt: null,
    outputBytes: 0, toolAttempts: 0, completedRequests: 0, pendingText: '', authoring: { start, state: replayAuthoring(start, []).state },
    snapshot: { schemaVersion: 1, id: randomUUID(), clientRequestId: randomUUID(), context: { sceneId: start.project.document.sceneId,
      revision: start.project.document.revision, audience: 'public' }, status: 'running', generation: 1, lastSequence: 0, text: '', tools: [],
      usage: { requests: 0, inputTokens: null, outputTokens: null, unknown: true }, error: null, createdAt: 1, updatedAt: 1, expiresAt: 1000 } }
  const run = (name: string, args: unknown) => executeAuthoringTool(task, { id: randomUUID(), name, arguments: JSON.stringify(args) }, args)
  return { task, run }
}
function furnishingTask(basic: AuthoringScope['operations'] = ['transform', 'opacity']) {
  const start = compositionCandidateFixture()
  start.scope.operations = basic; start.scope.scene!.operations = ['furnish']; start.scope.visual = null
  return taskFor(start)
}

describe('model tool catalog narrowed by the immutable capability grant', () => {
  it('describes the classified AI allowance without changing v1 tool contracts or widening grants', () => {
    const grant = scope({ scene: scene(['terrainEdit']) })
    const legacy = getAuthoringTools(grant), classified = getAuthoringTools(grant, 2)
    expect(names(classified)).toEqual(names(legacy))
    for (const current of classified.filter(item => item.name !== 'sceneweave_propose_composition')) expect(current.parameters).toEqual(tool(legacy, current.name).parameters)
    expect(tool(legacy, 'sceneweave_terrain_apply_candidate').description).toContain('256 cumulative expansion')
    expect(tool(classified, 'sceneweave_terrain_apply_candidate').description).toContain('separate 256-target AI cumulative budget')
    expect(tool(getAuthoringTools(grant), 'sceneweave_terrain_apply_candidate').description).toBe(tool(legacy, 'sceneweave_terrain_apply_candidate').description)
  })
  it('omits v2 visual and deferred-artwork branches that the complete v3/v4 continuation cannot execute', () => {
    const grant = scope({ operations: ['opacity'], scene: scene(['terrainUpdate']), visual: visual(['visualBoundary', 'visualEnvironment']),
      artwork: { mode: 'single', targetIds: ['target'], operations: ['svg', 'style'] } })
    const legacy = getAuthoringTools(grant), classified = getAuthoringTools(grant, 2)
    expect(kinds(classified, 'sceneweave_edit_scene')).toEqual(['opacity', 'terrainUpdate'])
    expect(names(classified)).not.toContain('sceneweave_apply_boundary_candidates')
    expect(names(classified)).not.toContain('sceneweave_propose_boundary')
    const composition = tool(classified, 'sceneweave_propose_composition').parameters as Schema
    expect(composition.properties!.kind.enum).toEqual(['layout', 'furnishing'])
    expect(composition.oneOf!.every(branch => branch.properties!.kind.const !== 'style')).toBe(true)
    expect(kinds(legacy, 'sceneweave_edit_scene')).toContain('visualBoundary')
    expect(kinds(legacy, 'sceneweave_edit_scene')).toContain('svg')
  })
  it('advertises the exact union of all four operation grants without weakening any retained branch', () => {
    const grant = scope({ operations: ['transform', 'opacity'], scene: scene(['terrain', 'furnish']),
      visual: visual(['visualBoundary', 'visualFog']), artwork: { mode: 'range', targetIds: [], includeNewProps: true, operations: ['svg', 'style'] } })
    const catalog = getAuthoringTools(grant)
    expect(kinds(catalog, 'sceneweave_edit_scene')).toEqual(['transform', 'opacity', 'terrain', 'furnish', 'visualBoundary', 'visualFog', 'svg', 'style'].sort())
    expect(kinds(catalog, 'sceneweave_edit_props')).toEqual(['opacity', 'transform'])
    for (const name of ['sceneweave_edit_scene', 'sceneweave_edit_props']) {
      const schema = tool(catalog, name).parameters as Schema
      expect(schema).toMatchObject({ type: 'object', required: ['operations'], additionalProperties: false,
        properties: { operations: { type: 'array', minItems: 1, maxItems: 16 } } })
      for (const branch of branches(catalog, name)) {
        const full = branches(authoringTools, name).find(value => value.properties!.kind.const === branch.properties!.kind.const)
        expect(branch).toEqual(full)
        expect(branch.additionalProperties).toBe(false)
      }
    }
  })

  it.each<[string, Partial<AuthoringScope>, string[]]>([
    ['basic', { operations: ['transform'] }, ['transform']],
    ['scene', { scene: scene(['terrain', 'connection']) }, ['terrain', 'connection']],
    ['visual', { visual: visual(['visualLight', 'visualFilter']) }, ['visualLight', 'visualFilter']],
    ['artwork', { artwork: { mode: 'single', targetIds: ['target'], operations: ['svg'] } }, ['svg']],
  ])('retains only the %s grant when the other capability groups are absent', (_label, changes, expected) => {
    const catalog = getAuthoringTools(scope(changes))
    expect(kinds(catalog, 'sceneweave_edit_scene')).toEqual([...expected].sort())
    if (changes.operations?.length) expect(kinds(catalog, 'sceneweave_edit_props')).toEqual([...changes.operations].sort())
    else expect(names(catalog)).not.toContain('sceneweave_edit_props')
  })

  it('hides write entry points when there is no write grant, even with explicit existing targets', () => {
    const catalog = getAuthoringTools(scope({ targetIds: ['public-target'], scene: null, visual: null, artwork: null }))
    const advertised = names(catalog)
    expect(advertised).toContain('sceneweave_read_scene')
    for (const name of ['sceneweave_edit_scene', 'sceneweave_edit_props', 'sceneweave_apply_boundary_candidates', ...terrainTools]) {
      expect(advertised).not.toContain(name)
    }
  })

  const terrainCases: [string, TerrainAuthoringOperation['kind'][]][] = [
    ['ordinary terrain only', []], ...terrainKinds.map(kind => [kind, [kind]] as [string, TerrainAuthoringOperation['kind'][]]),
    ['mixed generation and regional editing', ['terrainGenerate', 'regionalEdit']], ['all terrain operations', [...terrainKinds]],
  ]
  it.each(terrainCases)('advertises precisely the T6 capabilities and candidate branches for %s', (_label, allowed) => {
    const catalog = getAuthoringTools(scope({ scene: scene(allowed.length ? allowed : ['terrain']) })), advertised = names(catalog)
    const expected = allowed.length ? [...terrainCommonTools,
      ...(allowed.includes('terrainEdit') || allowed.includes('terrainLocal') ? ['sceneweave_terrain_regenerate_region'] : []),
      ...(allowed.includes('regionalEdit') ? ['sceneweave_region_scene_candidate'] : [])] : []
    expect(advertised.filter(name => terrainTools.includes(name)).sort()).toEqual(expected.sort())
    expect(kinds(catalog, 'sceneweave_edit_scene')).toEqual((allowed.length ? [...allowed] : ['terrain']).sort())
    expect(advertised).not.toContain('sceneweave_edit_props')
    if (allowed.length) {
      expect(kinds(catalog, 'sceneweave_terrain_candidates')).toEqual([...allowed].sort())
      expect(tool(catalog, 'sceneweave_terrain_candidates').parameters).toMatchObject({ type: 'object', additionalProperties: false,
        required: ['operations'], properties: { operations: { type: 'array', minItems: 1, maxItems: 3 } } })
      for (const branch of branches(catalog, 'sceneweave_terrain_candidates')) {
        expect(branch).toEqual(branches(authoringTools, 'sceneweave_terrain_candidates').find(value => value.properties!.kind.const === branch.properties!.kind.const))
      }
    }
  })

  it.each([true, false])('keeps the short boundary proposal/apply pair only with visualBoundary permission (%s)', boundaryAllowed => {
    const catalog = getAuthoringTools(scope({ visual: visual(boundaryAllowed ? ['visualBoundary'] : ['visualFog']) }))
    for (const name of ['sceneweave_propose_boundary', 'sceneweave_apply_boundary_candidates']) {
      expect(names(catalog).includes(name)).toBe(boundaryAllowed)
      if (boundaryAllowed) expect(tool(catalog, name)).toEqual(tool(authoringTools, name))
    }
  })

  it('retains composition root properties for provider compatibility and the exact strict oneOf underneath', () => {
    const catalog = getAuthoringTools(scope({ scene: scene(['terrain', 'furnish']), visual: visual(['visualSurface', 'visualEnvironment']) }))
    const schema = tool(catalog, 'sceneweave_propose_composition').parameters as Schema
    const original = z.toJSONSchema(CompositionCandidateSchema, { io: 'input' })
    const originalBranches = CompositionCandidateSchema.options.map(branch => z.toJSONSchema(branch, { io: 'input' }))
    expect(schema.oneOf).toEqual(original.oneOf)
    expect(schema).toMatchObject({ type: 'object', required: ['kind'], additionalProperties: false,
      properties: { kind: { type: 'string', enum: ['layout', 'furnishing', 'style'] } } })
    expect(Object.keys(schema.properties!).sort()).toEqual([...new Set(originalBranches.flatMap(branch => Object.keys(branch.properties!)))].sort())
    for (const branch of originalBranches) {
      expect(branch.additionalProperties).toBe(false)
      for (const [key, value] of Object.entries(branch.properties!)) {
        if (key !== 'kind') expect(schema.properties![key]).toEqual(value)
      }
    }
  })

  it('does not mutate scopes or share writable catalog state across calls and the full tool directory', () => {
    const firstScope = scope({ operations: ['opacity'], scene: scene(['terrain']), visual: visual(['visualBoundary']) })
    const otherScope = scope({ scene: scene(['regionalGenerate']) })
    const beforeScopes = canonicalJson([firstScope, otherScope]), beforeFull = catalogJson(authoringTools)
    const first = getAuthoringTools(firstScope), firstBefore = catalogJson(first), other = getAuthoringTools(otherScope), otherBefore = catalogJson(other)
    const edit = tool(first, 'sceneweave_edit_scene'), schema = edit.parameters as Schema
    const mutate = (change: () => void) => { try { change() } catch { /* An independently frozen return is also safe. */ } }
    mutate(() => { edit.description = 'mutated returned description' })
    mutate(() => { schema.properties!.operations.maxItems = 999 })
    mutate(() => { branches(first, 'sceneweave_edit_scene')[0].properties!.kind.const = 'ungranted-kind' })
    mutate(() => { first.pop() })
    expect(canonicalJson([firstScope, otherScope])).toBe(beforeScopes)
    expect(catalogJson(authoringTools)).toBe(beforeFull)
    expect(catalogJson(other)).toBe(otherBefore)
    expect(catalogJson(getAuthoringTools(firstScope))).toBe(firstBefore)
    expect(catalogJson(getAuthoringTools(otherScope))).toBe(otherBefore)
  })

  it('retains authorised transforms for task-created props despite an initially empty target list', () => {
    const { task, run } = furnishingTask(), authoring = task.authoring!, catalogBefore = catalogJson(getAuthoringTools(authoring.start.scope))
    expect(authoring.start.scope.targetIds).toEqual([])
    expect(authoring.start.scope.scene!.entityIds).toEqual([])
    expect(kinds(getAuthoringTools(authoring.start.scope), 'sceneweave_edit_props')).toEqual(['opacity', 'transform'])
    const floorId = authoring.start.scope.scene!.floorId
    expect(run('sceneweave_edit_scene', { operations: [{ kind: 'furnish', id: 'new-prop', definitionId: 'definition',
      positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'floor', id: floorId } }] }).success).toBe(true)
    expect(run('sceneweave_edit_props', { operations: [{ kind: 'transform', id: 'new-prop', positionMm: { x: 5000, y: 4500 } },
      { kind: 'opacity', id: 'new-prop', value: .4 }] }).success).toBe(true)
    const replayed = replayAuthoring(authoring.start, authoring.state.steps)
    expect(replayed.project.document.props['new-prop']).toMatchObject({ positionMm: { x: 5000, y: 4500 }, appearance: { opacity: .4 } })
    expect(authoring.state.draftRevision).toBe(2)
    expect(catalogJson(getAuthoringTools(authoring.start.scope))).toBe(catalogBefore)
    expect(Object.keys(authoring.start.project.document.props)).toEqual([])
  })

  it('still rejects a hidden prop write through the strict executor without changing an existing valid draft', () => {
    const { task, run } = furnishingTask([]), authoring = task.authoring!
    expect(run('sceneweave_edit_scene', { operations: [{ kind: 'furnish', id: 'new-prop', definitionId: 'definition',
      positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'floor', id: authoring.start.scope.scene!.floorId } }] }).success).toBe(true)
    expect(names(getAuthoringTools(authoring.start.scope))).not.toContain('sceneweave_edit_props')
    const before = canonicalJson(task), result = run('sceneweave_edit_props', { operations: [{ kind: 'opacity', id: 'new-prop', value: .4 }] })
    expect(result.success).toBe(false)
    expect(canonicalJson(task)).toBe(before)
  })

  it('still rejects hidden ordinary scene branches and the short boundary tool without installing partial edits', () => {
    const { task, run } = furnishingTask(), authoring = task.authoring!, catalog = getAuthoringTools(authoring.start.scope)
    expect(kinds(catalog, 'sceneweave_edit_scene')).not.toContain('terrain')
    expect(names(catalog)).not.toContain('sceneweave_apply_boundary_candidates')
    const before = canonicalJson(task)
    const terrainResult = run('sceneweave_edit_scene', { operations: [{ kind: 'terrain', id: 'forbidden-land', groundElevationMm: 500,
      boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }] }] })
    expect(terrainResult.success).toBe(false)
    expect(canonicalJson(task)).toBe(before)
    const boundaryResult = run('sceneweave_apply_boundary_candidates', { atDraftRevision: authoring.state.draftRevision,
      atContentHash: authoring.state.contentHash, candidates: [{ proposal: { areaId: 'forbidden-land', boundaryId: 'forbidden-coast' }, candidateHash: '0'.repeat(64) }] })
    expect(boundaryResult.success).toBe(false)
    expect(canonicalJson(task)).toBe(before)
  })

  it('rejects a hidden but well-formed T6 generation request on a real complete v3 fixture without installing candidates', () => {
    const start = terrainAuthoringFixture()
    start.scope.scene!.operations = ['furnish']
    const { task, run } = taskFor(start), catalog = getAuthoringTools(start.scope)
    expect(names(catalog)).not.toContain('sceneweave_terrain_candidates')
    const before = canonicalJson(task), result = run('sceneweave_terrain_candidates', { operations: [{ kind: 'terrainGenerate', request: {
      sceneId: start.project.document.sceneId, seed: 'hidden-tool-still-ungranted', kind: 'forest', widthMm: 24000, heightMm: 18000,
    } }] })
    expect(result.success).toBe(false)
    expect(JSON.parse(result.output).error.code).toBe('restricted_dependency')
    expect(canonicalJson(task)).toBe(before)
    expect(task.authoring!.terrainCandidates).toBeUndefined()
  })
})
