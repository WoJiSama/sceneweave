import type { VisualSampleArt } from './sample-art.js'
import { NATURAL_STONE_SHAPES, type NaturalStoneKey, type StonePoint } from './natural-stone-shapes.js'
import { terrainRandomUnit } from '../terrain-generation/field.js'
import { pointInPolygon } from '../geometry/geometry.js'

export const NATURAL_STONE_LICENSE_REF = 'MIT-Sceneweave-Natural-Stone-1'
export const NATURAL_STONE_LICENSE = `Sceneweave Natural Stone Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic artwork for Sceneweave. The fixed SVG sources are authored in natural-stone-art.ts and natural-stone-shapes.ts. No reference-map imagery or other third-party assets are embedded.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

const round = (value: number) => Math.round(value * 100) / 100
const position = ([x, y]: StonePoint) => `${round(x)} ${round(y)}`
const between = (a: StonePoint, b: StonePoint, t: number): StonePoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const polygon = (points: readonly StonePoint[]) => `M${points.map(position).join('L')}Z`
const rgb = (colors: readonly number[], shift = 0) => '#' + colors.map(channel => Math.round(channel + shift).toString(16).padStart(2, '0')).join('')

/** Ease the weathered corners while keeping the bed's broad planes. */
function outline(points: readonly StonePoint[], radius: number) {
  const corners = points.map((point, i) => [between(point, points[(i + points.length - 1) % points.length], radius),
    point, between(point, points[(i + 1) % points.length], radius)] as const)
  return `M${position(corners[0][0])}${corners.map(([a, b, c], i) => `${i ? `L${position(a)}` : ''}Q${position(b)} ${position(c)}`).join('')}Z`
}

function paintStone(key: NaturalStoneKey): VisualSampleArt {
  const shape = NATURAL_STONE_SHAPES[key], rounded = shape.setting === 'strand'
  const random = (channel: string, i: number) => terrainRandomUnit(`natural-stone-v1/${key}`, `${channel}/${i}`)
  const [width, height] = shape.sizeMm
  const cap = shape.outline.map((p, i) => {
    const inward = .032 + .059 * random('chipped crown', i) + Math.max(0, p[1] - 54) * .0031
    return between(p, shape.crown, inward)
  })
  const lower = rounded ? [116, 114, 98] : [121, 117, 100]
  const upper = rounded ? [142, 139, 120] : [149, 143, 123]
  const side = (shift: number) => rgb(lower, shift + shape.tone)
  const top = (shift: number) => rgb(upper, shift + shape.tone)
  const heading = rounded ? .38 : .125
  const body = [
    '<ellipse cx="51" cy="59" rx="48" ry="37" fill="url(#stone-contact)"/>',
    `<path d="${outline(shape.outline, heading)}" fill="${side(0)}"/>`,
    ...shape.outline.map((p, i) => {
      const j = (i + 1) % cap.length, lit = Math.max(0, (.69 - p[1] / 100) * 32)
      return `<path d="${polygon([p, shape.outline[j], cap[j], cap[i]])}" fill="${side(lit + 9 * random('fracture plane', i))}" opacity=".62"/>`
    }),
    `<path d="${outline(cap, heading)}" fill="url(#rough-stone)"/>`,
  ]

  const segments = rounded ? [2, 9] : [2, 6, 10, 13]
  const joints = segments.map((i, j) => {
    const a = between(cap[i], shape.crown, .11 + random('plane start', j) * .19)
    const b = between(a, shape.crown, .50 + random('plane reach', j) * .26)
    const c = between(cap[(i + 3) % cap.length], shape.crown, .29)
    return [a, b, between(b, c, .33), c]
  })
  for (const [i, marks] of joints.entries()) {
    const [a, b, c, d] = marks
    body.push(`<path d="${polygon(marks)}" fill="${top(i % 2 ? 9 : -21)}" opacity="${rounded ? .21 : .30}"/>`)
    if (!rounded || i === 0) {
      const tail = between(c, d, .55)
      body.push(`<path d="M${position(a)}L${position(b)}L${position(c)}L${position(tail)}" stroke="${side(-25)}" stroke-width="${rounded ? .30 : .41}" stroke-linecap="round" fill="none" opacity="${rounded ? .39 : .55}"/>`)
    }
  }

  const boundary = cap.map(([x, y]) => ({ x, y }))
  for (let i = 0; i < 222; i++) {
    const x = 13 + 75 * random('grain x', i), y = 13 + 74 * random('grain y', i)
    if (!pointInPolygon({ x, y }, boundary, false)) continue
    const r = .19 + random('grain radius', i) ** 3 * 1.34
    body.push(`<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(r * 1.4)}" ry="${round(r * .61)}" fill="${i % 3 ? top(25) : side(-10)}" opacity="${i % 3 ? .25 : .31}"/>`)
  }
  if (key === 'weathered') {
    for (const [i, mark] of [[[32,33],[41,29],[53,35],[49,43],[37,47],[31,43]], [[49,54],[58,49],[67,55],[62,65],[54,64]]].entries()) {
      body.push(`<path d="${outline(mark.map(([x, y]) => [x, y]), .25)}" fill="${i ? '#788170' : '#8B9076'}" opacity=".33"/>`)
    }
  }
  const defs = `<defs><linearGradient id="rough-stone" x1="14" y1="4" x2="85" y2="100" gradientUnits="userSpaceOnUse">`
    + `<stop offset="0" stop-color="${top(11)}"/><stop offset=".51" stop-color="${top(3)}"/><stop offset="1" stop-color="${top(-15)}"/></linearGradient>`
    + '<radialGradient id="stone-contact"><stop offset=".55" stop-color="#453F30" stop-opacity=".40"/><stop offset="1" stop-color="#453F30" stop-opacity="0"/></radialGradient></defs>'
  return { key, name: shape.name, kind: 'prop', widthMm: width, heightMm: height,
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${defs}${body.join('')}</svg>`,
    footprintMm: { width: Math.round(width * .72), height: Math.round(height * .69) },
    tags: ['原创', '自然岩石', rounded ? '沙岸' : '崖脚', 'rock', shape.setting], blocksMovement: false, blocksSight: false,
    renderLayer: 'ground', shadowClass: 'none' }
}

export const NATURAL_STONE_ART = (Object.keys(NATURAL_STONE_SHAPES) as NaturalStoneKey[]).map(paintStone)
