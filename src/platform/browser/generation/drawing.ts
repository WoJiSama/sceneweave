import { decorationFootprint } from '../../../shared/decorations/geometry.js'
import { connectionCenterline } from '../../../shared/geometry/connection-route.js'
import { connectionFootprint, openingEndpoints, pathPolygon, propFootprint, roomPoints, terrainPoints } from '../../../shared/geometry/geometry.js'
import type { BoundsMm, PointMm, SceneDocument } from '../../../shared/model/scene.js'

export type DrawingMarkKind = 'terrain' | 'water' | 'room' | 'wall' | 'path' | 'stairs' | 'opening' | 'prop' | 'plant'
export interface GenerationDrawing {
  bounds: BoundsMm
  marks: { id: string; kind: DrawingMarkKind; points: PointMm[]; trace?: PointMm[] }[]
}

/** A disposable sketch of a generator's single source floor, before placement on the host canvas. */
export function sketchGeneratedFloor(scene: SceneDocument): GenerationDrawing {
  const floor = Object.values(scene.floors)[0]
  const marks: GenerationDrawing['marks'] = []
  for (const area of Object.values(scene.terrainAreas).sort((a, b) => a.coveragePriority - b.coveragePriority)) {
    const tags = area.surfaceStyle && scene.materials[area.surfaceStyle.base.materialRef.id]?.tags
    const water = area.waterSurface || tags?.includes('water') || tags?.includes('水')
    marks.push({ id: area.id, kind: water ? 'water' : 'terrain', points: terrainPoints(area) })
  }
  for (const room of Object.values(scene.rooms)) marks.push({ id: room.id, kind: 'room', points: roomPoints(scene, room) })
  for (const wall of Object.values(scene.walls)) {
    const points = [wall.startVertexId, wall.endVertexId].map(id => ({ x: scene.vertices[id].xMm, y: scene.vertices[id].yMm }))
    marks.push({ id: wall.id, kind: 'wall', points })
  }
  for (const path of Object.values(scene.paths)) {
    marks.push({ id: path.id, kind: 'path', points: pathPolygon(path), trace: path.centerlineMm })
  }
  for (const connection of Object.values(scene.terrainConnections)) {
    marks.push({ id: connection.id, kind: 'stairs', points: connectionFootprint(connection), trace: connectionCenterline(connection) })
  }
  for (const opening of Object.values(scene.openings)) {
    marks.push({ id: opening.id, kind: 'opening', points: openingEndpoints(scene, opening) })
  }
  // Keep the transient sketch small for dense vegetation. The final paint uses every instance.
  const detailLimit = 400
  const props = Object.values(scene.props).slice(0, detailLimit)
  for (const prop of props) {
    marks.push({ id: prop.id, kind: prop.shadowClass === 'vegetation' ? 'plant' : 'prop', points: propFootprint(prop) })
  }
  for (const item of Object.values(scene.decorations).slice(0, detailLimit - props.length)) {
    const plant = scene.propDefinitions[item.definitionRef.id]?.defaultShadowClass === 'vegetation'
    marks.push({ id: item.id, kind: plant ? 'plant' : 'prop', points: decorationFootprint(scene, item) })
  }
  return { bounds: floor.boundsMm, marks }
}
