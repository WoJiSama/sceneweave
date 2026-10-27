import { visualBase } from '../../../shared/visual/base.js'
import { describe, expect, it } from 'vitest'
import { createRefinedInteriorDocument, createRefinedInteriorProject } from './refined-interior.js'
import { REFINED_INTERIOR_ART } from '../../../shared/visual/interior-art.js'
import { normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { assertDoorwayClearances, wallMovementPolygons } from '../../../shared/geometry/doorway-clearance.js'
import { propFootprint, polygonsOverlap } from '../../../shared/geometry/geometry.js'

describe('independent Q2 editable interior', () => {
  it('normalizes every independent source and gives furniture distinct honest fixed dimensions', () => {
    expect(REFINED_INTERIOR_ART).toHaveLength(23)
    expect(new Set(REFINED_INTERIOR_ART.map(value => value.key)).size).toBe(23)
    expect(new Set(REFINED_INTERIOR_ART.map(value => value.sourceSvg)).size).toBe(23)
    for (const art of REFINED_INTERIOR_ART) expect(normalizeStaticSvg(art.sourceSvg).viewBox).toEqual({ x: 0, y: 0, width: 512, height: 512 })
    const scene = createRefinedInteriorDocument()
    expect(Object.keys(scene.assets)).toHaveLength(23)
    expect(Object.keys(scene.materials)).toHaveLength(4)
    expect(Object.keys(scene.propDefinitions)).toHaveLength(19)
    expect(scene.presetSnapshot.presetId).toBe('sceneweave-refined-interior')
    for (const key of ['bed-', 'table-', 'chair-']) expect(REFINED_INTERIOR_ART.filter(value => value.key.startsWith(`interior-${key}`))).toHaveLength(2)
  })
  it('provides five truly connected uses, unique shared walls and clear full-width door approaches', () => {
    const scene = createRefinedInteriorDocument()
    expect(Object.keys(scene.rooms)).toHaveLength(5)
    expect(Object.keys(scene.walls)).toHaveLength(16)
    expect(scene.constraints.entranceOpeningIds).toEqual(['q2-entry'])
    const doors = Object.values(scene.openings).filter(value => value.kind === 'door')
    expect(doors).toHaveLength(6)
    assertDoorwayClearances(scene, doors.map(value => ({ openingId: value.id, minWidthMm: 1200, approachDepthMm: 1200 })))
    const sides = Object.values(scene.walls).map(value => [value.startVertexId, value.endVertexId].sort().join('|'))
    expect(new Set(sides).size).toBe(sides.length)
    expect(scene.rooms['q2-kitchen'].floorStyle!.base.tileSizeMm).toEqual({ width: 1800, height: 1800 })
    expect(scene.rooms['q2-dining'].floorStyle!.base.rotationDeg).toBe(0)
    expect(scene.rooms['q2-hall'].floorStyle!.base.rotationDeg).toBe(90)
    const blocked = structuredClone(scene), prop = Object.values(blocked.props).find(value => value.blocksMovement)!
    prop.positionMm = { x: 12750, y: 16800 }
    expect(() => assertDoorwayClearances(blocked, [{ openingId: 'q2-entry', minWidthMm: 1200, approachDepthMm: 1200 }])).toThrow('被阻挡')
    for (const furniture of Object.values(scene.props).filter(value => value.blocksMovement)) {
      expect(wallMovementPolygons(scene).some(wall => polygonsOverlap(propFootprint(furniture), wall.polygon)), furniture.id).toBe(false)
    }
  })
  it('retains five fixed groups with independently editable, nonoverlapping blocking members and restrained lights', async () => {
    const scene = createRefinedInteriorDocument()
    expect(Object.keys(scene.prefabDefinitions)).toHaveLength(5)
    expect(Object.keys(scene.prefabInstances)).toHaveLength(5)
    const registered = new Set<string>()
    for (const group of Object.values(scene.prefabInstances)) for (const member of Object.values(group.members)) {
      expect(member.propId).not.toBeNull()
      const prop = scene.props[member.propId!]
      expect(prop.editLocked).toBe(false)
      expect(registered.has(prop.id)).toBe(false)
      expect(scene.entityLayers[prop.id]).toBe(scene.entityLayers[group.id])
      registered.add(prop.id)
    }
    const blocking = Object.values(scene.props).filter(value => value.blocksMovement)
    for (let i = 0; i < blocking.length; i++) for (let j = i + 1; j < blocking.length; j++) {
      expect(polygonsOverlap(propFootprint(blocking[i]), propFootprint(blocking[j])), `${blocking[i].id}/${blocking[j].id}`).toBe(false)
    }
    for (const [roomId, keys] of Object.entries({ 'q2-kitchen': ['stove-', 'counter-'], 'q2-dining': ['table-long', 'chair-'], 'q2-bedroom': ['bed-', 'cupboard-'], 'q2-study': ['desk-', 'shelf-'] })) {
      const props = Object.values(scene.props).filter(value => value.roomId === roomId)
      for (const key of keys) expect(props.some(value => value.definitionRef!.id.includes(key))).toBe(true)
    }
    expect(visualBase(scene)!.environment.ambientOpacity).toBeLessThan(.15)
    expect(Object.values(visualBase(scene)!.lights).every(value => value.wallOcclusion && value.intensity < .3)).toBe(true)
    const second = createRefinedInteriorDocument(); Object.values(scene.props)[0].positionMm.x += 1
    expect(scene).not.toEqual(second)
    const controller = new AbortController(); controller.abort()
    await expect(createRefinedInteriorProject(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
