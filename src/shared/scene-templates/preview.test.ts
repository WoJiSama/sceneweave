import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import { describeSceneTemplate, sceneTemplatePlacementSketch } from './preview.js'

describe('actual template display metadata and canvas sketch', () => {
  it('derives dimensions and rotates around the same canonical 5000mm anchor as final placement, with real overlap and bounds feedback', () => {
    const scene = fixture({ building: true }).project.document, sketch = describeSceneTemplate(scene)
    expect(sketch.widthMm).toBe(7000); expect(sketch.heightMm).toBe(7000)
    const placement = { floorId: 'blank-floor', layerId: scene.entityLayers.item, supportRef: { kind: 'floor' as const, id: 'blank-floor' }, anchorMm: { x: 5000, y: 5000 }, quarterTurns: 0 as const }
    expect(sceneTemplatePlacementSketch(scene, sketch, placement).issues).toContain('与现有房间重叠。')
    const rotated = sceneTemplatePlacementSketch(scene, sketch, { ...placement, anchorMm: { x: 15000, y: 4000 }, quarterTurns: 1 })
    expect(rotated.polygons[0][0]).toEqual({ x: 17000, y: 2000 })
    const outside = sceneTemplatePlacementSketch(scene, sketch, { ...placement, anchorMm: { x: 25000, y: 25000 } })
    expect(outside.issues).toContain('房间超出当前楼层范围。')
  })
})
