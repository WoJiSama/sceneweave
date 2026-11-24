import { expect, it } from 'vitest'
import { fixture } from '../../../application/workspace/test-fixtures.js'
import type { MaterialPaint } from '../../../shared/model/scene.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { roadBankSampler } from './graded-road-paint.js'

const rectangle = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
const paint = (id: string): MaterialPaint => ({
  materialRef: { id, version: 1 }, alignment: 'world', originMm: { x: 0, y: 0 },
  rotationDeg: 0, opacity: 1, tileSizeMm: { width: 1000, height: 1000 }, tint: null,
})

it('uses the neighboring visible material patch, overlay and base independently', () => {
  const projection = projectScene(fixture().project.document, 'gm')
  projection.rooms = []
  projection.terrain = [{ id: 'surface', points: rectangle(0, 0, 6000, 5000), priority: 0, elevationMm: 0,
    style: { base: paint('grass'), overlays: [{ id: 'drift', boundaryMm: rectangle(0, 0, 2500, 5000), paint: paint('snow'), blendWidthMm: 90, renderOrder: 0 }] },
    materialPatches: [{ regionsMm: [{ outerMm: rectangle(1800, 1600, 1700, 1600), holesMm: [rectangle(2100, 1800, 250, 250)] }],
      paint: paint('stone'), blendWidthMm: 110 }],
  }]
  projection.materials = {
    grass: { id: 'grass', textureAssetId: 'grass-image', version: 1, bankMaterial: 'grass' },
    snow: { id: 'snow', textureAssetId: 'snow-image', version: 1, bankMaterial: 'snow' },
    stone: { id: 'stone', textureAssetId: 'stone-image', version: 1, bankMaterial: 'stone' },
  }
  const bankAt = roadBankSampler(projection)
  expect(bankAt({ x: 800, y: 2800 })?.material).toBe('snow')
  expect(bankAt({ x: 2100, y: 2500 })?.material).toBe('stone')
  expect(bankAt({ x: 2220, y: 1900 })?.material).toBe('snow')
  expect(bankAt({ x: 4400, y: 2800 })?.material).toBe('grass')
  expect(roadBankSampler({ ...projection, audience: 'player', masks: [rectangle(2000, 2400, 300, 300)] })({ x: 2100, y: 2500 })).toBeUndefined()
})
