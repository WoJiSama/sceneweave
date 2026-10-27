import { describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { composeTerrainDocument } from './compose.js'
import { generateTerrainDocument, TERRAIN_FIXED_SEEDS } from './generate.js'
import { prepareTerrainEdit, terrainEditRequestSchema } from './edit.js'
import { terrainPoints } from '../geometry/geometry.js'
import { cloneJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { canonicalTerrainEdge } from '../commands/outdoor.js'
import { constraintInputHash } from './integrity.js'
import { detachChangedOutputs } from './integrity.js'
import { visualBase } from '../visual/base.js'

const base = () => {
  const blank = createRefinedBlankDocument('island', {
    title: '拓扑事务测试', sceneId: 'topology-test', now: '2026-10-27T00:00:00.000Z',
    widthMm: 24_000, heightMm: 18_000, preset: 'narrative',
  })
  return composeTerrainDocument(blank, generateTerrainDocument(blank, {
    sceneId: blank.sceneId, kind: 'island', seed: TERRAIN_FIXED_SEEDS[0],
  }), 'topology-birth').document
}

const rect = (x: number, y: number, width: number, height: number) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
]

function topologyRequest(scene: ReturnType<typeof base>, rebindings: Array<{ kind?: 'prop' | 'connectionFrom' | 'connectionTo'; entityId: string; previousAreaId: string; outputIndex: number }>) {
  const low = scene.terrainAreas['terrain-low']
  const holeMaterial = cloneJson(low.surfaceStyle!.base.materialRef)
  return terrainEditRequestSchema.parse({
    kind: 'topology', sceneId: scene.sceneId, operationId: 'topology-difference-hole', floorId: 'visual-floor',
    scopeMm: scene.exportBoundsMm, linkMode: 'transitions', operation: 'difference', areaIds: ['terrain-low'],
    templateAreaId: 'terrain-low', clip: [rect(10_500, 11_000, 2_000, 1_000)],
    holeSurface: { materialRef: holeMaterial, elevationMm: low.groundElevationMm, blocksMovement: true, movementCostMultiplier: 2 },
    rebindings: rebindings.map(row => ({ kind: row.kind ?? 'prop', entityId: row.entityId, previousAreaId: row.previousAreaId, outputIndex: row.outputIndex })),
  })
}

function simpleInput() {
  const before=withoutLowVisualBinding(base()),scene=cloneJson(before)
  scene.terrainAreas['terrain-low'].boundaryMm=rect(1000,1000,22000,16000).map((positionMm,index)=>({id:`manual-low-p${index}`,segmentId:`manual-low-s${index}`,positionMm}))
  detachChangedOutputs(before,scene)
  return scene
}

function withoutLowVisualBinding(scene: ReturnType<typeof base>) {
  const next = cloneJson(scene), visual = visualBase(next)!
  delete visual.boundaries['terrain-coast-curve']
  for (const id of Object.keys(visual.edgeLooks)) if (visual.edgeLooks[id].boundaryId === 'terrain-coast-curve') delete visual.edgeLooks[id]
  detachChangedOutputs(scene, next)
  return next
}

describe('complex terrain topology transactions', () => {
  it('requires explicit support rebindings before replacing an area', () => {
    const scene = withoutLowVisualBinding(base())
    expect(() => prepareTerrainEdit(scene, topologyRequest(scene, []))).toThrow(/支撑重绑/)
    expect(scene.terrainAreas['terrain-low']).toBeDefined()
  })

  it('materializes holes with fresh IDs and tombstones old ownership', () => {
    const scene = simpleInput()
    const rebindings: Array<{ kind?: 'prop' | 'connectionFrom' | 'connectionTo'; entityId: string; previousAreaId: string; outputIndex: number }> = Object.values(scene.props)
      .filter(prop => prop.supportRef.kind === 'terrainArea' && prop.supportRef.id === 'terrain-low')
      .map(prop => ({ entityId: prop.id, previousAreaId: 'terrain-low', outputIndex: 0 }))
    rebindings.push({ entityId: 'terrain-stairs', previousAreaId: 'terrain-low', outputIndex: 0, kind: 'connectionFrom' })
    const result = prepareTerrainEdit(scene, topologyRequest(scene, rebindings))
    const next = result.document
    expect(next.generation?.version).toBe(4)
    if (next.generation?.version !== 4) throw new Error('topology generation missing')
    const operation = Object.values(next.generation.topology).find(row => row.state === 'current')
    expect(operation?.holeCount).toBe(1)
    expect(operation?.componentCount).toBe(1)
    expect(operation?.outputAreaIds).toHaveLength(2)
    expect(next.terrainAreas['terrain-low']).toBeUndefined()
    expect(operation?.outputAreaIds.every(id => id !== 'terrain-low')).toBe(true)
    const hole = operation!.outputAreaIds.map(id => next.terrainAreas[id]).find(area => area.coveragePriority > scene.terrainAreas['terrain-low'].coveragePriority)
    expect(hole?.blocksMovement).toBe(true)
    expect(hole?.surfaceStyle?.base.materialRef).toEqual(scene.terrainAreas['terrain-low'].surfaceStyle!.base.materialRef)
    for (const prop of Object.values(next.props).filter(prop => prop.supportRef.kind === 'terrainArea')) {
      if (prop.id in scene.props && scene.props[prop.id].supportRef.kind === 'terrainArea' && scene.props[prop.id].supportRef.id === 'terrain-low') expect(prop.supportRef.id).toBe(operation!.outputAreaIds[0])
    }
    const owner = Object.values(next.generation.ownership).find(row => row.target.kind === 'terrainArea' && row.target.entityId === 'terrain-low')
    expect(owner?.state).toBe('deleted')
    expect(validateSceneDocument(next).ok).toBe(true)
  })

  it('rejects frozen-scope escapes, entity/layer locks and mismatched rebinding slots', () => {
    const scene = simpleInput()
    const rows = Object.values(scene.props).filter(prop=>prop.supportRef.id==='terrain-low').map(prop=>({entityId:prop.id,previousAreaId:'terrain-low',outputIndex:0}))
    rows.push({entityId:'terrain-stairs',previousAreaId:'terrain-low',outputIndex:0,kind:'connectionFrom'} as typeof rows[number])
    const request = topologyRequest(scene, rows)
    expect(()=>prepareTerrainEdit(scene,{...request,scopeMm:{x:10000,y:10000,width:500,height:500}})).toThrow(/冻结范围/)
    const locked=cloneJson(scene);locked.terrainAreas['terrain-low'].editLocked=true;detachChangedOutputs(scene,locked)
    expect(()=>prepareTerrainEdit(locked,request)).toThrow(/锁定/)
    const layer=cloneJson(scene);layer.userLayers[layer.entityLayers['terrain-low']].editLocked=true
    expect(()=>prepareTerrainEdit(layer,request)).toThrow(/锁定/)
    const bad=cloneJson(request)
    if(bad.kind!=='topology')throw new Error('missing topology request')
    bad.rebindings[0].kind='connectionTo'
    expect(()=>prepareTerrainEdit(scene,bad)).toThrow(/类型|重绑/)
    const propLocked=cloneJson(scene);propLocked.props[rows[0].entityId].editLocked=true;detachChangedOutputs(scene,propLocked)
    expect(()=>prepareTerrainEdit(propLocked,request)).toThrow(/锁定/)
  })

  it('rejects terrain-edge dependencies atomically', () => {
    const scene = base()
    const low = scene.terrainAreas['terrain-low'], first = low.boundaryMm[0]
    const relation = canonicalTerrainEdge(scene, { areaId: 'terrain-low', segmentId: first.segmentId })
    scene.terrainEdges['topology-edge'] = {
      id: 'topology-edge', floorId: 'visual-floor', visibility: 'public', editLocked: false,
      source: relation.source, neighborAreaId: relation.neighborAreaId, kind: relation.requiresCliff ? 'cliff' : 'shore', shoreline: !relation.neighborAreaId,
      blocksMovement: relation.requiresCliff, blocksSight: false, surfaceStyle: null, styleOverride: null,
    }
    scene.entityLayers['topology-edge'] = 'visual-layer-ground'
    for (const check of Object.values(scene.generation!.checks)) {
      // Adding a valid declared edge changes the dependency witness; retain a
      // valid baseline so the topology refusal reaches its intended guard.
      check.inputHash = constraintInputHash(scene, check.constraintId)
    }
    const before = JSON.stringify(scene)
    const rebindings: Array<{ kind?: 'prop' | 'connectionFrom' | 'connectionTo'; entityId: string; previousAreaId: string; outputIndex: number }> = Object.values(scene.props)
      .filter(prop => prop.supportRef.kind === 'terrainArea' && prop.supportRef.id === 'terrain-low')
      .map(prop => ({ entityId: prop.id, previousAreaId: 'terrain-low', outputIndex: 0 }))
    expect(() => prepareTerrainEdit(scene, topologyRequest(scene, rebindings))).toThrow(/边缘依赖/)
    expect(JSON.stringify(scene)).toBe(before)
    expect(scene.terrainAreas['terrain-low']).toBeDefined()
  })
})
