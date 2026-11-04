import { describe, expect, it } from 'vitest'
import type { BoundsMm, PointMm } from '../../../shared/model/scene.js'
import type { ProjectedConnection } from '../../../shared/projection/types.js'
import { paintConnectionLandingMask } from './connection-landing-mask.js'

function mask(points: PointMm[], widthMm: number, depthMm: number, naturalRock = false,
  { bounds = { x: -1, y: -1, width: 2000, height: 2000 }, width = 1000, height = 1000, end = 'start' }:
  { bounds?: BoundsMm; width?: number; height?: number; end?: 'start' | 'end' } = {}) {
  let image: ImageData
  const context = { canvas: { width, height },
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (value: ImageData) => { image = value },
  } as unknown as CanvasRenderingContext2D
  const connection: ProjectedConnection = { id: 'test', kind: 'stairs', start: points[0], end: points.at(-1)!, widthMm,
    fromElevationMm: end === 'start' ? 0 : 1800, toElevationMm: end === 'start' ? 1800 : 0, blocksMovement: false, style: null,
    route: { centerlineMm: points, stairStyle: naturalRock ? 'naturalRock' : 'stone', treadDepthMm: 250 } }
  paintConnectionLandingMask(context, bounds, connection, end, depthMm, naturalRock)
  const at = (x: number, y: number) => image.data[(Math.floor((y - bounds.y) * height / bounds.height) * width + Math.floor((x - bounds.x) * width / bounds.width)) * 4 + 3] / 255
  return { at, data: image!.data }
}

describe('connection landing scalar mask', () => {
  it('gives both sides of an ordinary right-angle join the same cumulative station', () => {
    const { at: alpha } = mask([{ x: 900, y: 1300 }, { x: 700, y: 1300 }, { x: 700, y: 1000 }, { x: 100, y: 1000 }], 120, 360)
    for (const [x, y] of [[715, 1285], [675, 1325], [700, 1300]]) expect(alpha(x, y)).toBeCloseTo(1 - 200 / 360, 1)
    for (const y of [1270, 1330]) expect(alpha(800, y)).toBeCloseTo(1 - 100 / 360, 1)
    expect(alpha(700, 1230)).toBeCloseTo(1 - 270 / 360, 1)
  })

  it('keeps a legal short first segment filled with a complete cap and a zero terminal section', () => {
    const points = [{ x: 600, y: 1000 }, { x: 620, y: 1000 }, { x: 620, y: 400 }, { x: 1400, y: 400 }]
    for (const naturalRock of [false, true]) {
      const { at, data } = mask(points, 100, 72, naturalRock)
      for (const y of [960, 980, 1000, 1020, 1040]) expect(at(600, y), `cap y=${y}`).toBe(1)
      for (const x of [580, 600, 620, 640, 660]) expect(at(x, 948), `end x=${x}`).toBe(0)
      for (const [x, y] of [[610, 1000], [620, 980], [620, 960], [650, 1000]]) expect(at(x, y), `interior ${x},${y}`).toBeGreaterThan(0)
      const reversed = mask([...points].reverse(), 100, 72, naturalRock, { end: 'end' })
      expect(reversed.data.every((value, index) => value === data[index])).toBe(true)
    }
  })

  it('does not depend on pixel aspect ratio when the depth ends just after an obtuse bend', () => {
    const points = [{ x: 600, y: 1000 }, { x: 670, y: 1000 }, { x: 583, y: 507.5 }]
    const square = mask(points, 100, 72)
    const stretched = mask(points, 100, 72, false, { bounds: { x: -1, y: 499.5, width: 2000, height: 1000 } })
    for (const [x, y] of [[620, 1000], [640, 980], [650, 990]]) {
      expect(square.at(x, y), `${x},${y}`).toBeGreaterThan(0)
      expect(stretched.at(x, y), `${x},${y}`).toBe(square.at(x, y))
    }
    expect(square.at(1400, 400)).toBe(0)
  })

  it('fades natural rock to zero across the terminal section without a clipped slab edge', () => {
    const { at } = mask([{ x: 600, y: 1000 }, { x: 1400, y: 1000 }], 100, 72, true)
    for (const y of [950, 960, 980, 1000, 1020, 1040, 1050]) {
      expect(at(600, y), `cap y=${y}`).toBe(1)
      expect(at(672, y), `terminal y=${y}`).toBe(0)
      expect(at(670, y), `near terminal y=${y}`).toBeLessThan(.18)
    }
    expect(at(630, 1000)).toBeGreaterThan(.5)
  })
})
