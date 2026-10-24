import { describe, expect, it } from 'vitest'
import native from '../../platform/browser/content/scenes-data.json'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import { inspectDependencies } from '../geometry/dependencies.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import type { PreparationContext } from '../ports/runtime.js'
import { validateProjectData } from '../project/validate.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson, cloneJson } from '../validation/json.js'
import { SceneAuthoringOperationKindSchema, type SceneAuthoringOperation, type SceneAuthoringScope } from './authoring-protocol.js'
import { applySceneOperation, publicSceneContext, sceneReadIds, validateSceneScope } from './scene-authoring.js'

const NOW = '2026-10-24T12:00:00.000Z'
function runtime(prefix = 'test'): PreparationContext {
  let count = 0
  return { ids: { nextId: () => `${prefix}-${++count}` }, clock: { now: () => NOW } }
}
function fixture(): ProjectData {
  const scene = cloneJson(native.scenes.blank.document) as unknown as SceneDocument
  scene.title = 'private project title'; scene.assets = {}; scene.materials = {}; scene.propDefinitions = {}; scene.prefabDefinitions = {}; scene.styleThemes = {}; scene.activeStyleThemeRef = null
  const origin = { kind: 'original' as const, attribution: 'Sceneweave tests', canEmbed: true }
  scene.propDefinitions.tree = { id: 'tree', catalogId: 'test.scene-authoring', version: 1, licenseRef: 'MIT', origin, name: 'symbol tree', tags: [],
    defaultAppearance: { kind: 'symbol', symbol: 'table', tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -100, y: -100, width: 200, height: 200 }, defaultFootprintMm: { width: 100, height: 100 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: false, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' }
  const template = { definitionRef: { id: 'tree', version: 1 }, appearance: cloneJson(scene.propDefinitions.tree.defaultAppearance), positionMm: { x: -500, y: 0 }, rotationDeg: 0,
    visualBoundsMm: cloneJson(scene.propDefinitions.tree.defaultVisualBoundsMm), footprintMm: { width: 100, height: 100 }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: false, blocksSight: false, renderLayer: 'object' as const, renderOrder: 0, shadowClass: 'none' as const, shadowOverride: null }
  scene.prefabDefinitions.camp = { id: 'camp', catalogId: 'test.scene-authoring', version: 1, licenseRef: 'MIT', origin, name: 'camp', tags: [], members: [{ key: 'left', propTemplate: template }, { key: 'right', propTemplate: { ...cloneJson(template), positionMm: { x: 500, y: 0 } } }] }
  const content = createCompositionContent(scene, runtime('birth')), text = 'MIT test licence', hash = sha256Text(text)
  return validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: 1, ...content, assets: {}, licenses: { [hash]: { sha256: hash, text } },
    licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${hash}.txt`, embedding: 'allowed' as const })), authoringSources: {} })
}
function scope(entityIds: string[] = []): SceneAuthoringScope {
  return { floorId: 'blank-floor', layerId: 'layer-default-0', boundsMm: { x: 500, y: 500, width: 18000, height: 18000 }, entityIds,
    definitionIds: ['tree'], prefabDefinitionIds: ['camp'], materialIds: [], operations: [...SceneAuthoringOperationKindSchema.options] }
}
function flow(initial = fixture(), grant = scope()) {
  let project = initial, cost = 0
  const allowed = new Set(grant.entityIds), context = runtime('operation')
  return { get project() { return project }, get cost() { return cost }, allowed, grant,
    apply(operation: SceneAuthoringOperation) {
      const result = applySceneOperation(project, grant, operation, context, allowed)
      project = result.project; cost += result.cost; result.createdIds.forEach(id => allowed.add(id)); return result
    } }
}
const box = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
function modify(project: ProjectData, commands: CompositionCommand[]): ProjectData {
  return validateProjectData({ ...project, ...applyCompositionCommands({ document: project.document, appearance: project.appearance, historyIdentity: project.historyIdentity }, commands, runtime('manual')) })
}

describe('finite complete scene authoring', () => {
  it('builds two editable rooms with one shared wall, stable doors, an entrance and recursively bound GM prose', () => {
    const f = flow(), original = canonicalJson(f.project)
    validateSceneScope(f.project, f.grant)
    const first = f.apply({ kind: 'room', id: 'house', boundaryMm: box(2000, 2000, 4000, 4000), thicknessMm: 200, purpose: 'living room' })
    expect(first.cost).toBe(9)
    f.apply({ kind: 'room', id: 'bedroom', boundaryMm: box(6000, 2000, 4000, 4000), thicknessMm: 200 })
    expect(Object.keys(f.project.document.rooms)).toHaveLength(2)
    expect(Object.keys(f.project.document.walls)).toHaveLength(7)
    const wall = f.project.document.walls['house:wall:0']
    f.apply({ kind: 'opening', id: 'front-door', wallId: wall.id, offsetReferenceVertexId: wall.startVertexId, offsetMm: 1000, widthMm: 1000, openingKind: 'door' })
    const entrance = f.apply({ kind: 'entrance', openingIds: ['front-door'] })
    expect(entrance.writeIds).toContain('constraints')
    expect(f.project.document.constraints.entranceOpeningIds).toEqual(['front-door'])
    f.apply({ kind: 'gmNote', id: 'description', anchor: { type: 'entity', entityKind: 'room', entityId: 'house' }, noteKind: 'note', text: 'Secret clue and interaction.' })
    f.apply({ kind: 'gmNote', id: 'clue', anchor: { type: 'entity', entityKind: 'note', entityId: 'description' }, noteKind: 'clue', text: 'Follow this clue.' })
    f.apply({ kind: 'gmNoteUpdate', id: 'description', title: 'Room description', text: 'Revised secret clue.' })
    expect(f.project.document.notes.description.visibility).toBe('gm')
    expect(f.project.document.notes.clue.anchor).toEqual({ type: 'entity', entityKind: 'note', entityId: 'description' })
    expect(f.project.document.revision).toBe(fixture().document.revision)
    expect(canonicalJson(fixture())).toBe(original)
    expect(() => captureWithoutUndefined(f.project)).not.toThrow()
    const projected = canonicalJson(publicSceneContext(f.project, f.grant, f.allowed))
    expect(projected).toContain('Revised secret clue.')
    expect(projected).not.toContain('private project title')
  })

  it('creates terrain, a real-width road, a cliff source edge, steps, and a public use region', () => {
    const f = flow()
    f.apply({ kind: 'terrain', id: 'hill', boundaryMm: box(11000, 2000, 6000, 6000), groundElevationMm: 1000 })
    const segmentId = f.project.document.terrainAreas.hill.boundaryMm[0].segmentId
    f.apply({ kind: 'edge', id: 'cliff', areaId: 'hill', segmentId, edgeKind: 'cliff' })
    f.apply({ kind: 'connection', id: 'stairs', connectionKind: 'stairs', from: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 10000, y: 4000 } }, to: { surfaceRef: { kind: 'terrainArea', id: 'hill' }, positionMm: { x: 12000, y: 4000 } }, widthMm: 1000 })
    f.apply({ kind: 'path', id: 'road', centerlineMm: [{ x: 2000, y: 11000 }, { x: 7000, y: 11000 }], widthMm: 1200, supportRefs: [{ kind: 'floor', id: 'blank-floor' }] })
    f.apply({ kind: 'pathUpdate', id: 'road', widthMm: 1500 })
    f.apply({ kind: 'region', id: 'yard', boundaryMm: box(2000, 13000, 4000, 3000), regionKind: 'terrain', movementCostMultiplier: 2 })
    expect(f.project.document.terrainEdges.cliff.source.segmentId).toBe(segmentId)
    expect(f.project.document.terrainConnections.stairs.kind).toBe('stairs')
    expect(f.project.document.paths.road.widthMm).toBe(1500)
    expect(f.project.document.regions.yard.visibility).toBe('public')
    expect(sceneReadIds(f.project, { ...f.grant, entityIds: ['hill', 'road'] })).toEqual(expect.arrayContaining(['hill', segmentId, 'road']))
  })

  it('rewrites public prose as a new GM draft and never modifies or discloses existing private notes', () => {
    const initial = modify(fixture(), [
      { type: 'createNote', id: 'public-prose', floorId: 'blank-floor', layerId: 'layer-default-0', anchor: { type: 'point', positionMm: { x: 4000, y: 4000 } }, kind: 'note', text: 'Original public description', visibility: 'public' },
      { type: 'createNote', id: 'existing-private-prose', floorId: 'blank-floor', layerId: 'layer-default-0', anchor: { type: 'point', positionMm: { x: 8000, y: 8000 } }, kind: 'clue', text: 'Never disclosed private clue', visibility: 'gm' },
    ])
    const f = flow(initial, scope(['public-prose']))
    validateSceneScope(initial, f.grant)
    expect(() => f.apply({ kind: 'gmNoteUpdate', id: 'public-prose', text: 'Would overwrite public text' })).toThrow(/本任务新建/)
    expect(() => f.apply({ kind: 'gmNoteUpdate', id: 'existing-private-prose', text: 'Not authorized' })).toThrow(/未明确授权/)
    expect(() => validateSceneScope(initial, scope(['existing-private-prose']))).toThrow(/公开/)
    f.apply({ kind: 'gmNote', id: 'gm-rewrite', anchor: { type: 'entity', entityKind: 'note', entityId: 'public-prose' }, noteKind: 'note', text: 'Suggested revised description' })
    f.apply({ kind: 'gmNoteUpdate', id: 'gm-rewrite', text: 'Reviewed suggested description' })
    expect(f.project.document.notes['public-prose']).toEqual(initial.document.notes['public-prose'])
    expect(f.project.document.notes['existing-private-prose']).toEqual(initial.document.notes['existing-private-prose'])
    expect(f.project.document.notes['gm-rewrite']).toMatchObject({ visibility: 'gm', text: 'Reviewed suggested description', anchor: { type: 'entity', entityKind: 'note', entityId: 'public-prose' } })
    const disclosure = canonicalJson(publicSceneContext(f.project, f.grant, f.allowed))
    expect(disclosure).toContain('Reviewed suggested description')
    expect(disclosure).not.toContain('existing-private-prose')
    expect(disclosure).not.toContain('Never disclosed private clue')
  })

  it('really generates editable scatter members, counts members and records, and replays deterministic IDs', () => {
    function generate() {
      const f = flow()
      f.apply({ kind: 'terrain', id: 'forest', boundaryMm: box(2000, 2000, 6000, 6000), groundElevationMm: 0 })
      const result = f.apply({ kind: 'scatter', id: 'trees', domain: { kind: 'area', areaId: 'forest' }, palette: [{ definitionId: 'tree', weight: 1 }], seed: 'forest-seed', cellSizeMm: 2000, minDistanceMm: 100, densityFactor: 1 })
      const props = Object.values(f.project.document.props)
      expect(props.length).toBeGreaterThan(0)
      expect(result.cost).toBe(2 + props.length * 2)
      expect(Object.values(f.project.document.scatterGroups.trees.members).every(member => !!member.propId && !!f.project.document.props[member.propId])).toBe(true)
      expect(props.every(prop => prop.definitionRef?.id === 'tree' && prop.supportRef.id === 'forest')).toBe(true)
      const tokens = cloneJson(f.project.historyIdentity.propTokens), noop = f.apply({ kind: 'scatterRegenerate', id: 'trees' })
      expect(noop.cost).toBe(1)
      expect(f.project.historyIdentity.propTokens).toEqual(tokens)
      return f.project
    }
    expect(generate()).toEqual(generate())
  })

  it('instantiates fixed prefab members with their physical fields and supports', () => {
    const f = flow()
    const result = f.apply({ kind: 'prefab', id: 'camp-instance', definitionId: 'camp', anchorMm: { x: 5000, y: 5000 }, rotationDeg: 90, supportRef: { kind: 'floor', id: 'blank-floor' } })
    expect(result.cost).toBe(5)
    const group = f.project.document.prefabInstances['camp-instance'], members = Object.values(group.members).map(member => f.project.document.props[member.propId!])
    expect(members).toHaveLength(2)
    expect(members.map(prop => prop.positionMm.y).sort()).toEqual([4500, 5500])
    expect(members.every(prop => prop.footprintMm.width === 100 && prop.supportRef.id === 'blank-floor')).toBe(true)
    expect(Object.values(group.members).every(member => member.overrideFields.length === 0)).toBe(true)
  })

  it('furnishes a task-created room and terrain through explicit supports and fixed definition grants', () => {
    const f = flow()
    f.apply({ kind: 'room', id: 'house', boundaryMm: box(2000, 2000, 4000, 4000), thicknessMm: 200 })
    const placed = f.apply({ kind: 'furnish', id: 'table', definitionId: 'tree', positionMm: { x: 4000, y: 4000 }, rotationDeg: 45, supportRef: { kind: 'room', id: 'house' } })
    expect(placed.cost).toBe(1)
    expect(f.project.document.props.table.supportRef).toEqual({ kind: 'room', id: 'house' })
    expect(placed.readIds).toEqual(expect.arrayContaining(['house', 'house:wall:0', 'tree']))
    f.apply({ kind: 'terrain', id: 'yard', boundaryMm: box(10000, 10000, 5000, 5000), groundElevationMm: 0 })
    f.apply({ kind: 'furnish', id: 'tree-in-yard', definitionId: 'tree', positionMm: { x: 12000, y: 12000 }, supportRef: { kind: 'terrainArea', id: 'yard' } })
    expect(f.project.document.props['tree-in-yard'].supportRef.id).toBe('yard')
    expect(() => applySceneOperation(f.project, { ...f.grant, definitionIds: [] }, { kind: 'furnish', id: 'ungranted', definitionId: 'tree', positionMm: { x: 4000, y: 4000 }, supportRef: { kind: 'room', id: 'house' } }, runtime(), f.allowed)).toThrow(/固定素材未获明确授权/)
  })

  it('adjusts generated wall geometry and terrain while retaining exact boundary identities', () => {
    const f = flow()
    f.apply({ kind: 'room', id: 'house', boundaryMm: box(2000, 2000, 4000, 4000), thicknessMm: 200 })
    f.apply({ kind: 'vertex', id: 'house:vertex:1', positionMm: { x: 6500, y: 2000 } })
    const thicker = f.apply({ kind: 'wall', id: 'house:wall:0', thicknessMm: 250 })
    expect(thicker.readIds).toEqual(expect.arrayContaining(['house', 'house:vertex:0', 'house:wall:3']))
    expect(f.project.document.vertices['house:vertex:1'].xMm).toBe(6500)
    expect(f.project.document.walls['house:wall:0'].thicknessMm).toBe(250)
    f.apply({ kind: 'terrain', id: 'island', boundaryMm: box(10000, 10000, 5000, 5000), groundElevationMm: 0 })
    const identity = cloneJson(f.project.document.terrainAreas.island.boundaryMm)
    f.apply({ kind: 'terrainUpdate', id: 'island', boundaryMm: box(10000, 10000, 5500, 5000), groundElevationMm: 500, blocksSight: true })
    expect(f.project.document.terrainAreas.island.boundaryMm.map(value => [value.id, value.segmentId])).toEqual(identity.map(value => [value.id, value.segmentId]))
    expect(f.project.document.terrainAreas.island.groundElevationMm).toBe(500)
    expect(f.project.document.terrainAreas.island.blocksSight).toBe(true)
    expect(() => f.apply({ kind: 'terrainUpdate', id: 'island', boundaryMm: box(10000, 10000, 9000, 5000) })).toThrow(/授权范围/)
    expect(f.project.document.terrainAreas.island.boundaryMm[1].positionMm.x).toBe(15500)
  })

  it('keeps generated dependencies available without expanding geography, definitions or operation grants', () => {
    const f = flow()
    f.apply({ kind: 'room', id: 'house', boundaryMm: box(2000, 2000, 4000, 4000), thicknessMm: 200 })
    f.apply({ kind: 'gmNote', id: 'description', anchor: { type: 'entity', entityKind: 'room', entityId: 'house' }, noteKind: 'note', text: 'Generated note is a real later dependency.' })
    const revised = f.apply({ kind: 'wall', id: 'house:wall:0', thicknessMm: 300 })
    expect(revised.readIds).toContain('description')
    const noWall = { ...f.grant, operations: f.grant.operations.filter(value => value !== 'wall') }
    expect(() => applySceneOperation(f.project, noWall, { kind: 'wall', id: 'house:wall:0', thicknessMm: 400 }, runtime(), f.allowed)).toThrow(/未获明确授权/)
    const noCamp = { ...f.grant, prefabDefinitionIds: [] }
    expect(() => applySceneOperation(f.project, noCamp, { kind: 'prefab', id: 'camp', definitionId: 'camp', anchorMm: { x: 4000, y: 4000 }, supportRef: { kind: 'room', id: 'house' } }, runtime(), f.allowed)).toThrow(/固定组合未获授权/)
  })

  it('requires existing real building dependencies, rejects locks and never grants a private neighbour', () => {
    const f = flow()
    f.apply({ kind: 'room', id: 'room', boundaryMm: box(2000, 2000, 5000, 5000), thicknessMm: 200 })
    const id = 'room:wall:0', nextScope = scope([id])
    validateSceneScope(f.project, nextScope)
    expect(() => applySceneOperation(f.project, nextScope, { kind: 'wall', id, thicknessMm: 300 }, runtime(), new Set([id]))).toThrow(/真实依赖未明确授权/)
    const complete = scope([...f.allowed])
    const locked = modify(f.project, [{ type: 'setEditLock', kind: 'vertex', id: 'room:vertex:1', locked: true }])
    expect(() => applySceneOperation(locked, complete, { kind: 'wall', id, thicknessMm: 300 }, runtime(), f.allowed)).toThrow(/锁定/)
    const hidden = modify(f.project, [{ type: 'updateRoom', id: 'room', changes: { visibility: 'gm' } }])
    expect(() => validateSceneScope(hidden, complete)).toThrow(/公开/)
    expect(canonicalJson(publicSceneContext(hidden, scope(), new Set([id, 'room', 'room:vertex:0'])))).not.toContain('room:wall:0')
  })

  it('redacts unknown private geometry and recursive GM dependency identities from tool diagnostics', () => {
    const f = flow()
    f.apply({ kind: 'room', id: 'hidden-private-room', boundaryMm: box(2000, 2000, 5000, 5000), thicknessMm: 200 })
    const hidden = modify(f.project, [{ type: 'updateRoom', id: 'hidden-private-room', changes: { visibility: 'gm' } }])
    let overlapError = ''
    try { applySceneOperation(hidden, scope(), { kind: 'room', id: 'new-room', boundaryMm: box(3000, 3000, 2000, 2000), thicknessMm: 200 }, runtime(), new Set()) } catch (error) { overlapError = (error as Error).message }
    expect(overlapError).toContain('未授权')
    expect(overlapError).not.toContain('hidden-private-room')
    f.apply({ kind: 'gmNote', id: 'private-secret-note', anchor: { type: 'entity', entityKind: 'room', entityId: 'hidden-private-room' }, noteKind: 'clue', text: 'private secret note content' })
    const allowed = new Set([...f.allowed].filter(id => id !== 'private-secret-note'))
    let dependantError = ''
    try { applySceneOperation(f.project, scope([...allowed]), { kind: 'wall', id: 'hidden-private-room:wall:0', thicknessMm: 300 }, runtime(), allowed) } catch (error) { dependantError = (error as Error).message }
    expect(dependantError).toContain('真实依赖未明确授权')
    expect(dependantError).not.toContain('private-secret-note')
    expect(dependantError).not.toContain('private secret note content')
  })

  it('rejects actual path/prop/wall extents outside bounds even when their anchors fit', () => {
    const f = flow(), limited: SceneAuthoringScope = { ...f.grant, boundsMm: { x: 1000, y: 1000, width: 9000, height: 9000 } }
    expect(() => applySceneOperation(f.project, limited, { kind: 'path', id: 'road', centerlineMm: [{ x: 1000, y: 2000 }, { x: 7000, y: 2000 }], widthMm: 1000, supportRefs: [{ kind: 'floor', id: 'blank-floor' }] }, runtime(), f.allowed)).toThrow(/真实物理/)
    expect(() => applySceneOperation(f.project, limited, { kind: 'room', id: 'edge-room', boundaryMm: box(1000, 2000, 3000, 3000), thicknessMm: 200 }, runtime(), f.allowed)).toThrow(/真实物理/)
    expect(() => applySceneOperation(f.project, limited, { kind: 'prefab', id: 'edge-camp', definitionId: 'camp', anchorMm: { x: 1000, y: 5000 }, supportRef: { kind: 'floor', id: 'blank-floor' } }, runtime(), f.allowed)).toThrow(/真实物理/)
  })

  it('retains manual scatter moves/deletion suppressions on regeneration and counts repeated no-ops', () => {
    const f = flow()
    f.apply({ kind: 'terrain', id: 'forest', boundaryMm: box(2000, 2000, 6000, 6000), groundElevationMm: 0 })
    f.apply({ kind: 'scatter', id: 'trees', domain: { kind: 'area', areaId: 'forest' }, palette: [{ definitionId: 'tree', weight: 1 }], seed: 'forest-seed', cellSizeMm: 2000, minDistanceMm: 100, densityFactor: 1 })
    const ids = Object.keys(f.project.document.props), moved = ids[0], removed = ids[1]
    const manual = modify(f.project, [{ type: 'updateProp', id: moved, changes: { rotationDeg: 45 } }, { type: 'deleteProp', id: removed }])
    const changed = applySceneOperation(manual, f.grant, { kind: 'scatterRegenerate', id: 'trees' }, runtime('regenerate'), f.allowed)
    expect(changed.project.document.props[moved].rotationDeg).toBe(45)
    expect(changed.project.document.props[removed]).toBeUndefined()
    expect(changed.project.document.scatterGroups.trees.exclusions).toEqual(manual.document.scatterGroups.trees.exclusions)
    expect(Object.values(changed.project.document.scatterGroups.trees.members).some(member => member.state === 'deleted')).toBe(true)
  })

  it('refuses ungranted definitions, secret masks, unknown fields, accessors and excessive expanded scatter', () => {
    const f = flow(), noPalette = { ...f.grant, definitionIds: [] }
    f.apply({ kind: 'terrain', id: 'forest', boundaryMm: box(2000, 2000, 14000, 14000), groundElevationMm: 0 })
    const scatter: SceneAuthoringOperation = { kind: 'scatter', id: 'trees', domain: { kind: 'area', areaId: 'forest' }, palette: [{ definitionId: 'tree', weight: 1 }], seed: 'forest', cellSizeMm: 600, minDistanceMm: 1, densityFactor: 1 }
    expect(() => applySceneOperation(f.project, noPalette, scatter, runtime(), f.allowed)).toThrow(/素材未获明确授权/)
    expect(() => applySceneOperation(f.project, f.grant, scatter, runtime(), f.allowed)).toThrow(/256/)
    const masked = modify(f.project, [{ type: 'upsertManualMask', id: 'secret', floorId: 'blank-floor', boundsMm: { x: 10000, y: 10000, width: 1000, height: 1000 } }])
    expect(() => validateSceneScope(masked, f.grant)).toThrow(/遮罩/)
    const malicious = { kind: 'wall', id: 'missing', thicknessMm: 200, visibility: 'public' }
    expect(() => applySceneOperation(f.project, f.grant, malicious as SceneAuthoringOperation, runtime(), f.allowed)).toThrow()
    let reads = 0
    const getter = { kind: 'wall' as const, id: 'missing', get thicknessMm() { reads++; return 200 } }
    expect(() => applySceneOperation(f.project, f.grant, getter, runtime(), f.allowed)).toThrow()
    expect(reads).toBe(0)
  })
})

function captureWithoutUndefined(value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const entry of Object.values(value)) { expect(entry).not.toBeUndefined(); captureWithoutUndefined(entry) }
}
