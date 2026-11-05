import { describe, expect, it } from 'vitest'
import { emptyTerrainDocument } from '../../shared/terrain-generation/compose.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { cloneJson } from '../../shared/validation/json.js'
import { emptyVisualSystem } from '../../shared/visual/types.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { prepareCompositionCommands } from './prepare.js'
import { inspectFillCopy, prepareFillCopy, type FillCopyRequest } from './fill-copy.js'
import { fixture, runtime, validation } from './test-fixtures.js'

async function editable(): Promise<EditableProject> {
  const input = fixture({ image: true })
  const document = emptyTerrainDocument(input.project.document)
  const content = createCompositionContent(document, runtime)
  return fromBundle({ ...input, project: { ...input.project, schemaVersion: 1, ...content } }, validation)
}
const request = (sourceId: string, values: Partial<FillCopyRequest> = {}): FillCopyRequest => ({ sourceId, count: 1,
  stepMm: { x: 1000, y: 0 }, allowOverlap: true, ...values })

describe('fill copy preparation', () => {
  it('copies current independent-prop fields, rotation, support, and effective privacy with one measured batch', async () => {
    let current = await editable()
    const draft = structuredClone(toBundle(current).project)
    draft.document.props.item.rotationDeg = 45
    draft.document.props.item.visibility = 'gm'
    draft.document.props.item.footprintMm = { width: 200, height: 120 }
    draft.document.props.item.footprintOffsetMm = { x: 20, y: -10 }
    current = await fromBundle({ project: draft, resources: current.resources }, validation)
    const source = cloneJson(current.document.props.item)

    const prepared = await prepareFillCopy(current, request('item', { count: 2, stepMm: { x: 500, y: 0 } }), { runtime, validation })
    const copies = prepared.commands as Extract<CompositionCommand, { type: 'copyProp' }>[]
    expect(prepared.report.positions).toEqual([{ x: source.positionMm.x + 500, y: source.positionMm.y }, { x: source.positionMm.x + 1000, y: source.positionMm.y }])
    expect(prepared.cost.total).toBeGreaterThanOrEqual(prepared.report.minimumCost)
    expect(prepared.cost.limit).toBe(256)
    for (const [index, command] of copies.entries()) {
      const copy = prepared.project.document.props[command.newId]
      const { id: _id, renderOrder: _renderOrder, positionMm: _position, ...copiedFields } = source
      expect(copy).toMatchObject({ ...copiedFields, id: command.newId, positionMm: prepared.report.positions[index], visibility: 'gm' })
      expect(copy.renderOrder).not.toBe(source.renderOrder)
      expect(prepared.project.historyIdentity.propTokens[command.newId]).toBeDefined()
    }
    expect(current.document.props.item).toEqual(source)
  })

  it('duplicates the actual prefab members, retaining overrides, deletion tombstones, privacy, appearance, and fresh births', async () => {
    let current = await editable()
    const privateDraft = structuredClone(toBundle(current).project)
    privateDraft.document.props.item.visibility = 'gm'
    current = await fromBundle({ project: privateDraft, resources: current.resources }, validation)
    current = await prepareCompositionCommands(current, [{ type: 'createPrefab', id: 'camp', definitionId: 'camp-definition', name: 'Camp',
      ids: ['item', 'other'], anchorMm: { x: 5000, y: 5000 } }], { runtime, validation })
    current = await prepareCompositionCommands(current, [{ type: 'updateProp', id: 'item', changes: { rotationDeg: 27 } }], { runtime, validation })
    current = await prepareCompositionCommands(current, [{ type: 'deleteProp', id: 'other' }], { runtime, validation })
    const original = cloneJson(current.document.prefabInstances.camp)
    const originalProp = cloneJson(current.document.props.item)
    const result = await prepareFillCopy(current, request('camp'), { runtime, validation })
    const command = result.commands[0] as Extract<CompositionCommand, { type: 'duplicatePrefab' }>
    const copy = result.project.document.prefabInstances[command.newId]
    const copiedPropId = command.memberIds['member-1']

    expect(copy.visibility).toBe('gm')
    expect(copy.members['member-1'].overrideFields).toEqual(original.members['member-1'].overrideFields)
    expect(copy.members['member-1'].propId).toBe(copiedPropId)
    expect(copy.members['member-2']).toEqual(original.members['member-2'])
    expect(copy.members['member-2'].propId).toBeNull()
    const { id: _sourceId, renderOrder: _sourceOrder, positionMm: _sourcePosition, ...propFields } = originalProp
    expect(result.project.document.props[copiedPropId]).toMatchObject({
      ...propFields,
      id: copiedPropId,
      visibility: 'gm',
      positionMm: { x: originalProp.positionMm.x + 1000, y: originalProp.positionMm.y },
    })
    expect(result.project.appearance.propSources[copiedPropId]).toBe(result.project.appearance.propSources.item)
    expect(result.project.appearance.instanceAdjustments[copiedPropId]).toEqual(result.project.appearance.instanceAdjustments.item)
    expect(result.project.historyIdentity.propTokens[copiedPropId]).toBeDefined()
    expect(result.project.historyIdentity.prefabTokens[command.newId]).toBeDefined()
  })

  it('reports rotated-footprint overlap, allows touching bounds, and filters equal-floor objects at other heights', () => {
    const scene = cloneJson(fixture().project.document)
    scene.props.item.footprintMm = { width: 200, height: 200 }
    scene.props.item.footprintOffsetMm = { x: 0, y: 0 }
    scene.props.item.rotationDeg = 45
    scene.props.other.footprintMm = { width: 200, height: 200 }
    scene.props.other.footprintOffsetMm = { x: 0, y: 0 }
    scene.props.other.positionMm = { x: 4640, y: 4000 }
    const blocked = inspectFillCopy(scene, request('item', { stepMm: { x: 400, y: 0 }, allowOverlap: false }))
    expect(blocked.overlaps).toContainEqual({ copyIndex: 1, sourcePropId: 'item', otherId: 'other' })
    expect(blocked.issues.join(' ')).toMatch(/正面积物件占地重叠/)
    const allowed = inspectFillCopy(scene, request('item', { stepMm: { x: 400, y: 0 }, allowOverlap: true }))
    expect(allowed.overlaps.length).toBeGreaterThan(0)
    expect(allowed.issues).toEqual([])

    scene.terrainAreas.high = { id: 'high', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 1000, y: 1000 }, { x: 19000, y: 1000 }, { x: 19000, y: 19000 }, { x: 1000, y: 19000 }]
        .map((positionMm, index) => ({ id: `high-point-${index}`, segmentId: `high-segment-${index}`, positionMm })),
      groundElevationMm: 500, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    scene.props.other.supportRef = { kind: 'terrainArea', id: 'high' }
    const differentHeight = inspectFillCopy(scene, request('item', { stepMm: { x: 400, y: 0 }, allowOverlap: false }))
    expect(differentHeight.overlaps.some(row => row.otherId === 'other')).toBe(false)

    const touching = cloneJson(scene)
    touching.props.item.rotationDeg = 0
    touching.props.other.positionMm = { x: 9000, y: 4000 }
    expect(inspectFillCopy(touching, request('item', { stepMm: { x: 200, y: 0 }, allowOverlap: false })).overlaps).toEqual([])

    const staged = inspectFillCopy(touching, request('item', { count: 2, stepMm: { x: 100, y: 0 }, allowOverlap: true }))
    expect(staged.overlaps.some(row => row.otherId === '副本1:item')).toBe(true)
  })

  it('keeps an existing prefab internal overlap out of the collision report', () => {
    const scene = cloneJson(fixture().project.document)
    scene.props.other.positionMm = { ...scene.props.item.positionMm }
    scene.prefabDefinitions.definition = { id: 'definition', catalogId: 'test.fill.group', version: 1, licenseRef: 'MIT',
      origin: { kind: 'original', attribution: 'Test', canEmbed: true }, name: 'Group', tags: [], members: [
        { key: 'a', propTemplate: cloneJson(scene.props.item) as never }, { key: 'b', propTemplate: cloneJson(scene.props.other) as never },
      ] }
    scene.prefabInstances.group = { id: 'group', floorId: 'blank-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'definition', version: 1 },
      anchorMm: { ...scene.props.item.positionMm }, rotationDeg: 0,
      members: { a: { propId: 'item', overrideFields: [] }, b: { propId: 'other', overrideFields: [] } } }
    const report = inspectFillCopy(scene, request('group', { stepMm: { x: 1000, y: 0 } }))
    expect(report.sourcePropIds).toEqual(['item', 'other'])
    expect(report.overlaps).toEqual([])
    expect(report.issues).toEqual([])
  })

  it('reports unsupported physical placement and visual artwork beyond the Floor before materialization', () => {
    const unsupported = cloneJson(fixture().project.document)
    unsupported.props.item.footprintMm = { width: 100, height: 100 }
    unsupported.props.item.footprintOffsetMm = { x: 0, y: 0 }
    unsupported.terrainAreas.pad = { id: 'pad', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      boundaryMm: [{ x: 3000, y: 3000 }, { x: 5000, y: 3000 }, { x: 5000, y: 5000 }, { x: 3000, y: 5000 }]
        .map((positionMm, index) => ({ id: `pad-point-${index}`, segmentId: `pad-segment-${index}`, positionMm })),
      groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
    unsupported.props.item.supportRef = { kind: 'terrainArea', id: 'pad' }
    const supportReport = inspectFillCopy(unsupported, request('item', { stepMm: { x: 2000, y: 0 } }))
    expect(supportReport.issues.join(' ')).toMatch(/完整旋转占地不在原声明支撑面内/)

    const outside = cloneJson(fixture().project.document)
    outside.props.item.positionMm = { x: 19400, y: 10000 }
    outside.props.item.visualBoundsMm = { x: -500, y: -500, width: 1000, height: 1000 }
    outside.props.item.footprintMm = { width: 100, height: 100 }
    outside.props.item.footprintOffsetMm = { x: 0, y: 0 }
    const visualReport = inspectFillCopy(outside, request('item', { stepMm: { x: 101, y: 0 } }))
    expect(visualReport.issues.join(' ')).toMatch(/视觉范围超出Floor/)
    expect(visualReport.issues.join(' ')).not.toMatch(/完整旋转占地不在原声明支撑面内/)
  })

  it('lists recursive room support and layer dependencies, rejects locks and managed decoration-cluster members', () => {
    const scene = cloneJson(fixture({ building: true }).project.document)
    scene.props.item.supportRef = { kind: 'room', id: 'room' }
    scene.props.item.roomId = 'room'
    scene.rooms.room.editLocked = true
    const report = inspectFillCopy(scene, request('item'))
    expect(report.dependencyIds).toEqual(expect.arrayContaining(['item', 'room', 'blank-floor']))
    expect(report.layerIds).toContain(scene.entityLayers.room)
    expect(report.issues.join(' ')).toMatch(/room.*锁定/)

    scene.rooms.room.editLocked = false
    scene.userLayers[scene.entityLayers.room].editLocked = true
    expect(inspectFillCopy(scene, request('item')).issues.join(' ')).toMatch(/锁定/)
    scene.userLayers[scene.entityLayers.room].editLocked = false
    scene.decorationClusters = { cluster: { id: 'cluster', floorId: 'blank-floor', editLocked: false, visibility: 'public',
      supportRef: { kind: 'floor', id: 'blank-floor' }, boundsMm: { x: 0, y: 0, width: 1000, height: 1000 }, seed: 'seed', algorithmVersion: 'cluster-v1',
      palette: [], maxInstances: 1, spacingMm: 1, clusterRadiusMm: 1, clearanceMm: 0,
      members: { item: { kind: 'prop', entityId: 'item', state: 'manual' } } } }
    expect(() => inspectFillCopy(scene, request('item'))).toThrow(/退出布景簇/)
  })

  it('rejects repeated positions, unsafe coordinates, large counts, and expanded-budget overflow without partial positions', () => {
    const scene = cloneJson(fixture().project.document)
    const repeated = inspectFillCopy(scene, request('item', { count: 2, stepMm: { x: 0, y: 0 }, allowOverlap: false }))
    expect(repeated.positions).toHaveLength(2)
    expect(repeated.issues.join(' ')).toMatch(/位置完全相同/)
    expect(inspectFillCopy(scene, request('item', { count: 2, stepMm: { x: 0, y: 0 }, allowOverlap: true })).issues).toEqual([])
    const unsafe = inspectFillCopy(scene, request('item', { stepMm: { x: Number.MAX_SAFE_INTEGER, y: 0 } }))
    expect(unsafe.positions).toEqual([])
    expect(unsafe.issues.join(' ')).toMatch(/安全整数范围/)
    const large = inspectFillCopy(scene, request('item', { count: 257 }))
    expect(large.positions).toEqual([])
    expect(large.issues.join(' ')).toMatch(/最多检查256份/)

    const source = scene.props.item
    const members: Record<string, { propId: string; overrideFields: [] }> = {}
    for (let index = 0; index < 128; index++) {
      const id = `budget-member-${index}`
      scene.props[id] = { ...cloneJson(source), id, positionMm: { x: 1000 + index * 300, y: 12000 } }
      scene.entityLayers[id] = scene.entityLayers.item
      members[`member-${index}`] = { propId: id, overrideFields: [] }
    }
    scene.prefabInstances.large = { id: 'large', floorId: 'blank-floor', editLocked: false, visibility: 'public', definitionRef: { id: 'definition', version: 1 },
      anchorMm: { x: 1000, y: 12000 }, rotationDeg: 0, members }
    const overBudget = inspectFillCopy(scene, request('large', { count: 2 }))
    expect(overBudget.minimumCost).toBeGreaterThan(256)
    expect(overBudget.positions).toEqual([])
    expect(overBudget.issues.join(' ')).toMatch(/超过256条事务预算/)
  })
})
