import { expect, it } from 'vitest'
import { mayAffectInteriorRoom } from './furnishing-spatial.js'
import { furnitureBoundsPolygon } from './furnishing-poses.js'
it('retains exact-gap, crossing and rotated painted envelopes and excludes only wholly distant geometry', () => {
  const room = { x: 0, y: 0, width: 6000, height: 4000 }
  const rectangle = (x: number, y: number, width: number, height: number) => furnitureBoundsPolygon({ x: 0, y: 0, width, height }, { positionMm: { x, y }, rotationDeg: 0 })
  expect(mayAffectInteriorRoom(rectangle(6100, 1000, 500, 500), room)).toBe(true)
  expect(mayAffectInteriorRoom(rectangle(6101, 1000, 500, 500), room)).toBe(false)
  expect(mayAffectInteriorRoom(rectangle(1000, -601, 500, 500), room)).toBe(false)
  expect(mayAffectInteriorRoom(rectangle(1000, -600, 500, 500), room)).toBe(true)
  expect(mayAffectInteriorRoom(rectangle(-10000, 1000, 20000, 500), room)).toBe(true)
  expect(mayAffectInteriorRoom(furnitureBoundsPolygon({ x: -2000, y: -200, width: 4000, height: 400 }, { positionMm: { x: 6500, y: 1000 }, rotationDeg: 35 }), room)).toBe(true)
})
