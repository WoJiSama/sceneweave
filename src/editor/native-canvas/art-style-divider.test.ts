import { expect, test } from 'vitest'
import { artStyleClip, artStyleDividerGeometry, INITIAL_ART_STYLE_DIVIDER, moveArtStyleDivider } from './art-style-divider'

const area = { x: 0, y: 0, width: 800, height: 400 }

test('uses the same anchored split for both paints and keeps the side order while rotating', () => {
  const original = INITIAL_ART_STYLE_DIVIDER
  for (const [angle, before, after] of [[0, { x: 10, y: 200 }, { x: 780, y: 200 }], [90, { x: 400, y: 10 }, { x: 400, y: 390 }],
    [135, { x: 780, y: 10 }, { x: 10, y: 390 }]] as const) {
    const { distance, pivot, ends } = artStyleDividerGeometry({ ...original, angle }, area)
    expect(distance(pivot)).toBeCloseTo(0)
    expect(distance(before)).toBeLessThan(0)
    expect(distance(after)).toBeGreaterThan(0)
    for (const end of ends) expect(distance(end)).toBeCloseTo(0)
  }
  const image = { x: 100, y: 100, width: 600, height: 200 }
  expect(artStyleClip(original, area, image, true)).toBe('polygon(0% 0%, 50% 0%, 50% 100%, 0% 100%)')
  expect(artStyleClip(original, area, image, false)).toBe('polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%)')
  expect(artStyleClip(original, area, { ...image, x: 500, width: 200 }, true)).toBe('inset(0 100% 0 0)')
})

test('keeps a draggable comparison inside the visible viewport', () => {
  expect(moveArtStyleDivider({ ...INITIAL_ART_STYLE_DIVIDER, angle: 121 }, -1, 2, area)).toEqual({ x: .025, y: .95, angle: 121 })
})
