import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures'
import { openingAtPoint } from './opening-placement'

const building = () => fixture({ building: true }).project.document

describe('opening placement from a wall click', () => {
  it('centres an opening on the clicked wall without changing the scene', () => {
    const scene = building(), before = structuredClone(scene)
    expect(openingAtPoint(scene, { x: 6000, y: 3100 }, 900)).toEqual({
      wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 2550, widthMm: 900,
    })
    expect(scene).toEqual(before)
  })

  it.each([false, true])('uses distance along a diagonal wall, including reversed direction (%s)', reversed => {
    const scene = building()
    Object.assign(scene.vertices['vertex-1'], { xMm: 9000, yMm: 11000 })
    Object.assign(scene.vertices['vertex-2'], { xMm: 14000, yMm: 12000 })
    Object.assign(scene.vertices['vertex-3'], { xMm: 3000, yMm: 12000 })
    const wall = scene.walls['wall-0']
    if (reversed) [wall.startVertexId, wall.endVertexId] = [wall.endVertexId, wall.startVertexId]
    // The wall is 10 m long; this point is 6 m from vertex-0, or 4 m from vertex-1.
    expect(openingAtPoint(scene, { x: 6600, y: 7800 }, 1000)).toEqual({
      wallId: wall.id, offsetReferenceVertexId: reversed ? 'vertex-1' : 'vertex-0',
      offsetMm: reversed ? 3500 : 5500, widthMm: 1000,
    })
  })

  it('asks the user to move away from an ambiguous shared corner', () => {
    expect(() => openingAtPoint(building(), { x: 3000, y: 3000 }, 900)).toThrow('这里有多面墙')
  })

  it.each(['wall', 'layer'] as const)('rejects a wall protected by its %s lock', owner => {
    const scene = building(), wall = scene.walls['wall-0']
    if (owner === 'wall') wall.editLocked = true
    else scene.userLayers[scene.entityLayers[wall.id]].editLocked = true
    expect(() => openingAtPoint(scene, { x: 6000, y: 3000 }, 900)).toThrow('这面墙或所在图层已锁定')
  })

  it('does not attach to a hidden wall', () => {
    expect(() => openingAtPoint(building(), { x: 6000, y: 3000 }, 900, new Set(['wall-0']))).toThrow('请点击要开门窗的墙面')
  })

  it.each([3200, 9800])('rejects a width that would run beyond a wall endpoint at x=%s', x => {
    expect(() => openingAtPoint(building(), { x, y: 3000 }, 900)).toThrow('门窗距墙角太近')
  })

  it.each([{ x: 6500, y: 6500 }, { x: 11000, y: 2000 }])('rejects clicks away from walls or past their ends (%j)', point => {
    expect(() => openingAtPoint(building(), point, 900)).toThrow('请点击要开门窗的墙面')
  })

  it.each([399, 900.5, Number.NaN])('rejects an unsupported opening width (%s)', width => {
    expect(() => openingAtPoint(building(), { x: 6000, y: 3000 }, width)).toThrow('门窗净宽至少为 0.4 米')
  })
})
