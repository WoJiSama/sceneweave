import type { BoundsMm, Editable, PointMm, SceneDocument } from '../model/scene.js'
import type { ProjectData } from '../model/project.js'
import type { SceneAuthoringScope } from './authoring-protocol.js'
import { visualBase } from '../visual/base.js'
import { sampleVisualBoundary } from '../visual/geometry.js'
import { regionalEntityVisibility } from '../terrain-generation/integrity.js'

export function terrainExtendedEntity(scene: SceneDocument, id: string) {
  const visual = visualBase(scene)
  for (const [kind, rows] of Object.entries({ visualBoundary: visual?.boundaries, visualEdgeLook: visual?.edgeLooks, materializedEdge: scene.visual?.version === 2 ? scene.visual.materializedEdges : undefined,
    regionalArea: scene.regional?.areas, regionalLine: scene.regional?.lines, regionalLandmark: scene.regional?.landmarks, regionalSymbol: scene.regional?.symbols })) {
    const row = rows && Object.hasOwn(rows, id) ? rows[id] : undefined
    if (row) return { kind, row: row as Editable & { layerId: string; visibility: string } }
  }
  return undefined
}
export const boundsContains = (outer: BoundsMm, inner: BoundsMm) => [outer.x, outer.y, outer.x + outer.width, outer.y + outer.height, inner.x, inner.y, inner.x + inner.width, inner.y + inner.height].every(Number.isSafeInteger)
  && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
export function assertTerrainExtendedEntity(project: ProjectData, scope: Pick<SceneAuthoringScope, 'floorId' | 'boundsMm'>, id: string): void {
  const scene = project.document, entry = terrainExtendedEntity(scene, id)
  if (!entry || entry.row.visibility !== 'public' || entry.row.editLocked || entry.row.floorId !== scope.floorId || scene.userLayers[entry.row.layerId]?.editLocked) throw new Error('地形公开范围未授权。')
  const regionalKind = ({ regionalArea: 'area', regionalLine: 'line', regionalLandmark: 'landmark', regionalSymbol: 'symbol' } as const)[entry.kind as 'regionalArea']
  if (regionalKind && regionalEntityVisibility(scene, regionalKind, id) !== 'public') throw new Error('地形公开范围未授权。')
  let points: PointMm[] = [], padding = 0
  if (scene.regional?.areas[id]) points = scene.regional.areas[id].boundaryMm
  else if (scene.regional?.lines[id]) { points = scene.regional.lines[id].pointsMm.map(point => point.positionMm) }
  else if (scene.regional?.landmarks[id]) points = [scene.regional.landmarks[id].positionMm]
  else if (scene.regional?.symbols[id]) { const symbol = scene.regional.symbols[id], b = symbol.visualBoundsMm; points = [{ x: symbol.positionMm.x + b.x, y: symbol.positionMm.y + b.y }, { x: symbol.positionMm.x + b.x + b.width, y: symbol.positionMm.y + b.y + b.height }] }
  else {
    const visual = visualBase(scene), edge = visual?.edgeLooks[id], boundary = visual?.boundaries[id] ?? (edge && visual?.boundaries[edge.boundaryId])
    if (boundary) { points = sampleVisualBoundary(boundary).points; padding = edge?.widthMm ?? 0 }
    else if (scene.visual?.version === 2 && scene.visual.materializedEdges[id]) {
      // Materialized strips are admitted through their complete scene-level grant.
      points = [{ x: scene.exportBoundsMm.x, y: scene.exportBoundsMm.y }, { x: scene.exportBoundsMm.x + scene.exportBoundsMm.width, y: scene.exportBoundsMm.y + scene.exportBoundsMm.height }]
    }
  }
  if (!points.length || points.some(point => point.x - padding < scope.boundsMm.x || point.y - padding < scope.boundsMm.y || point.x + padding > scope.boundsMm.x + scope.boundsMm.width || point.y + padding > scope.boundsMm.y + scope.boundsMm.height)) throw new Error('地形公开范围未授权。')
}
