import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import { openingEndpoints } from '../../shared/geometry/geometry.js'
import { validateSceneSnapshot } from '../../shared/validation/snapshots.js'
import { wallOrder } from '../../shared/projection/projection.js'
import { wallGeometry } from '../../platform/browser/render/canvas-renderer.js'
import { hitTestAll, selectInBounds, selectionGeometry } from './selection.js'

describe('normal selection through aggregate chunk demand', () => {
  it('keeps exact shared-wall join ownership and opening holes when walls materialize separately', () => {
    const scene = fixture({ building: true }).project.document
    scene.walls['wall-0'].thicknessMm = 400
    scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 2000, widthMm: 1000, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }
    scene.entityLayers.door = scene.entityLayers.item
    const full = wallGeometry(Object.values(scene.walls).map(wall => ({ id: wall.id, sourceIds: [wall.id], start: { x: scene.vertices[wall.startVertexId].xMm, y: scene.vertices[wall.startVertexId].yMm }, end: { x: scene.vertices[wall.endVertexId].xMm, y: scene.vertices[wall.endVertexId].yMm }, thicknessMm: wall.thicknessMm, style: null, openings: Object.values(scene.openings).filter(opening => opening.wallId === wall.id).map(opening => {
      const [start, end] = openingEndpoints(scene, opening)
      return { id: opening.id, start, end, widthMm: opening.widthMm, kind: opening.kind, state: opening.state, secret: opening.secret }
    }) })).sort(wallOrder))
    for (const row of [...full].reverse()) expect(selectionGeometry(scene, row.wall.id)).toEqual(row.polygons)
    expect(hitTestAll(scene, { x: 5500, y: 3000 }, 0, { memberMode: true })).toContain('door')
    expect(hitTestAll(scene, { x: 5500, y: 3000 }, 0, { memberMode: true })).not.toContain('wall-0')
  })

  it('picks a complete road across a seam once, retains far explicit geometry and invalidates caller-owned movement', () => {
    const scene = fixture().project.document
    scene.paths.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public', centerlineMm: [{ x: 1000, y: 8000 }, { x: 19000, y: 8000 }], widthMm: 600, supportRefs: [{ kind: 'floor', id: 'blank-floor' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.entityLayers.road = scene.entityLayers.item
    scene.props.item.positionMm = { x: 16000, y: 16000 }
    const checked = validateSceneSnapshot(scene)
    if (!checked.ok) throw new Error(checked.errors.map(issue => issue.message).join(';'))
    expect(hitTestAll(checked.document, { x: 8000, y: 8000 }, 0).filter(id => id === 'road')).toEqual(['road'])
    expect(selectInBounds(checked.document, { x: 7900, y: 7900, width: 200, height: 200 }, 'intersect').ids.filter(id => id === 'road')).toEqual(['road'])
    expect(selectionGeometry(checked.document, 'item')[0].some(point => point.x > 15000)).toBe(true)
    expect(hitTestAll(scene, { x: 16000, y: 16000 }, 0)).toContain('item')
    scene.props.item.positionMm = { x: 2000, y: 2000 }
    expect(hitTestAll(scene, { x: 16000, y: 16000 }, 0)).not.toContain('item')
    expect(hitTestAll(scene, { x: 2000, y: 2000 }, 0)).toContain('item')
  })
})
