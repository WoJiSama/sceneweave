import { validateScene } from '../schema'
import { validateSceneV2 } from './schema'
import type { SceneDocumentV2 } from './types'

/** Isolated M0 copy: never rewrites the source object, identity or previous database. */
export function migrateSceneV1(input: unknown, options: { sceneId?: string; now?: string } = {}): SceneDocumentV2 {
  const checked = validateScene(input)
  if (!checked.ok) throw new Error(`v1 迁移失败：${checked.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  const source = checked.document
  if (Object.keys(source.assets).length || Object.values(source.props).some(prop => prop.assetId !== null)) throw new Error('v1 迁移仅接受 M0 m0-geometry 符号工程；不能推断外部资源或许可。')
  const sceneId = options.sceneId ?? crypto.randomUUID()
  if (sceneId === source.sceneId) throw new Error('迁移必须创建独立 sceneId，原工程身份保留。')
  const stamp = options.now ?? new Date().toISOString()
  const document: SceneDocumentV2 = {
    ...structuredClone(source), schemaVersion: 2, sceneId, revision: 0, createdAt: stamp, updatedAt: stamp,
    rooms: Object.fromEntries(Object.entries(source.rooms).map(([id, room]) => [id, { ...structuredClone(room), supportRef: { kind: 'floor' as const, id: room.floorId }, groundElevationMm: 0, floorStyle: null }])),
    walls: Object.fromEntries(Object.entries(source.walls).map(([id, wall]) => [id, { ...structuredClone(wall), topStyle: null }])),
    openings: Object.fromEntries(Object.entries(source.openings).map(([id, opening]) => [id, { ...structuredClone(opening), offsetReferenceVertexId: source.walls[opening.wallId].startVertexId }])),
    props: Object.fromEntries(Object.entries(source.props).map(([id, prop]) => {
      const { assetId: _assetId, symbol, ...base } = structuredClone(prop)
      return [id, { ...base, definitionRef: null, appearance: { kind: 'symbol' as const, symbol, tint: null, opacity: 1 },
        visualBoundsMm: { x: -Math.floor(prop.footprintMm.width / 2), y: -Math.floor(prop.footprintMm.height / 2), ...prop.footprintMm },
        footprintOffsetMm: { x: 0, y: 0 }, supportRef: { kind: 'floor' as const, id: prop.floorId },
        renderLayer: 'object' as const, renderOrder: 0, shadowClass: 'none' as const, shadowOverride: null }]
    })),
    propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: null,
  }
  const result = validateSceneV2(document)
  if (!result.ok) throw new Error(`v2 迁移校验失败：${result.errors.map(issue => `${issue.code}: ${issue.message}`).join('；')}`)
  return result.document
}
