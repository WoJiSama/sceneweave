import type { VisualSampleArt } from './sample-art.js'
import { freezeJson } from '../validation/json.js'

/** Independent fixed source: existing theme artwork and saved identities stay intact. */
export const HANDDRAWN_SURFACE_LICENSE_REF = 'MIT-Sceneweave-Handdrawn-Surfaces-1'
export const HANDDRAWN_SURFACE_LICENSE = `Sceneweave Handdrawn Surface Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic SVG pigment, plank and flagstone artwork authored in code for Sceneweave with coding assistance. No third-party imagery or externally generated images are embedded. Each tile repeats its geometry and pigment across both axes.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

export type HanddrawnSurfaceFamily = 'oak' | 'limestone' | 'basalt' | 'plaster'
const SIZE = 512
const n = (value: number) => Math.round(value * 100) / 100
const point = (x: number, y: number) => `${n(x)} ${n(y)}`
function noise(seed: number, index: number): number {
  let value = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x45d9f3b)
  value ^= value >>> 16
  return (Math.imul(value, 0x45d9f3b) >>> 0) / 0x100000000
}

/** Capture a primitive once; all intersecting periodic copies use the exact same geometry. */
function wrap(x: number, y: number, rx: number, ry: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) {
    if (x + rx + dx < 0 || x - rx + dx > SIZE || y + ry + dy < 0 || y - ry + dy > SIZE) continue
    draw(dx, dy)
  }
}
class Pigment {
  private readonly paths = new Map<string, string[]>()
  add(d: string, fill: string, opacity = 1, stroke = 'none', width = 1): void {
    const attributes = `fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
    const group = this.paths.get(attributes) ?? []
    group.push(d)
    this.paths.set(attributes, group)
  }
  svg(): string { return [...this.paths].map(([attributes, paths]) => `<path d="${paths.join('')}" ${attributes}/>`).join('') }
}
function contour(x: number, y: number, rx: number, ry: number, seed: number): string {
  const vertices = Array.from({ length: 10 }, (_, index) => {
    const angle = index * Math.PI / 5, scale = .76 + noise(seed, index) * .24
    return { x: x + Math.cos(angle) * rx * scale, y: y + Math.sin(angle) * ry * scale }
  })
  const midpoint = (index: number) => {
    const a = vertices[index % 10], b = vertices[(index + 1) % 10]
    return point((a.x + b.x) / 2, (a.y + b.y) / 2)
  }
  return `M${midpoint(9)}` + vertices.map((p, i) => `Q${point(p.x, p.y)} ${midpoint(i)}`).join('') + 'Z'
}
function washes(seed: number, colors: readonly string[]): string {
  const pigment = new Pigment()
  for (let index = 0; index < 34; index++) {
    const x = noise(seed, index * 4) * SIZE, y = noise(seed, index * 4 + 1) * SIZE
    const rx = 22 + noise(seed, index * 4 + 2) * 67, ry = 10 + noise(seed, index * 4 + 3) * 49
    wrap(x, y, rx, ry, (dx, dy) => pigment.add(contour(x + dx, y + dy, rx, ry, seed + index), colors[index % colors.length], .055))
  }
  return pigment.svg()
}
function grain(seed: number, colors: readonly string[]): string {
  const pigment = new Pigment()
  for (let index = 0; index < 720; index++) {
    const x = noise(seed, index * 3) * SIZE, y = noise(seed, index * 3 + 1) * SIZE
    const radius = .15 + noise(seed, index * 3 + 2) * .48
    wrap(x, y, radius + .25, radius + .25, (dx, dy) => pigment.add(
      `M${point(x + dx - radius, y + dy)}h${n(radius * 2)}`, 'none', index % 2 ? .12 : .18, colors[index % colors.length], .45))
  }
  return pigment.svg()
}
function oak(seed: number): string {
  const faces = new Pigment(), marks = new Pigment()
  const colors = ['#947458', '#A48260', '#9C7959', '#AD8D6A', '#A38663', '#907457', '#A88A66', '#9C8061']
  // Twenty-four boards across 6.4m: nominal width 267mm, lengths 1.5–2.7m.
  let y = 0
  const heights = Array.from({ length: 24 }, (_, row) => 18 + noise(seed, row) * 7)
  const scale = SIZE / heights.reduce((sum, height) => sum + height, 0)
  for (let row = 0; row < heights.length; row++) {
    const height = heights[row] * scale
    const cuts = [0, 127 + noise(seed + 11, row) * 61, 302 + noise(seed + 27, row) * 62, SIZE]
    const shift = noise(seed + 31, row) * 190
    for (let column = 0; column < 3; column++) {
      const left = cuts[column] + shift, width = cuts[column + 1] - cuts[column], local = row * 7 + column
      wrap(left + width / 2, y + height / 2, width / 2 + 2, height / 2 + 2, (dx, dy) => {
        const x = left + dx + .65, top = y + dy + .6, right = x + width - 1.3, bottom = top + height - 1.2
        faces.add(`M${point(x, top)}L${point(right - .9, top + .3)}L${point(right, bottom - .3)}L${point(x + .6, bottom)}Z`, colors[Math.floor(noise(seed + 59, local) * colors.length)])
        marks.add(`M${point(x + 2, top + 1.2)}L${point(right - 3, top + 1.4)}`, 'none', .29, '#DAC29A', .7)
        for (let line = 0; line < 3; line++) {
          const lineY = top + height * (.24 + line * .25), bend = (noise(seed + 87, local * 3 + line) - .5) * 4
          marks.add(`M${point(x + 3, lineY)}q${point(width * .23, bend)} ${point(width * .46, .4)}t${point(width * .46 - 6, -.3)}`, 'none', line % 2 ? .16 : .2, line % 2 ? '#E2CDA7' : '#594C3B', .5)
        }
        // Short splits and grain eyes remain inside each board, never on a hidden tile border.
        if (noise(seed + 103, local) > .5) {
          const cx = x + width * .57, cy = top + height * .57
          marks.add(`M${point(cx - 8, cy)}q8 -3 16 0q-8 3 -16 0Z`, 'none', .24, '#594C3B', .65)
          marks.add(`M${point(cx - 18, cy)}q10 -2 13 0M${point(cx + 10, cy)}l14 1`, 'none', .23, '#594C3B', .5)
        }
      })
    }
    y += height
  }
  return `<rect x="0" y="0" width="512" height="512" fill="#655847"/>` + faces.svg() + washes(seed + 178, ['#E8D0A1', '#5D6651', '#5B4334']) + marks.svg() + grain(seed + 300, ['#F0DAB2', '#473D31'])
}
function flags(seed: number, dark: boolean): string {
  const faces = new Pigment(), edges = new Pigment(), details = new Pigment()
  const colors = dark ? ['#626A68', '#737875', '#69726D', '#5F6967', '#777E76', '#6D726F', '#626A6A'] : ['#B7B19A', '#C2B89E', '#ABA994', '#C4BCA5', '#B2B39E', '#AEAA95', '#BCB9A4']
  const heights = [52, 70, 59, 67, 54, 78, 62, 70]
  let y = 0
  for (let row = 0; row < heights.length; row++) {
    const height = heights[row], widths = Array.from({ length: 6 }, (_, column) => 65 + noise(seed + row * 113, column + 211) * 43)
    const total = widths.reduce((sum, width) => sum + width, 0), cuts = [0]
    for (const width of widths) cuts.push(cuts[cuts.length - 1] + width / total * SIZE)
    // Keep the repeat boundary inside a flag, away from a vertical mortar joint.
    const lastWidth = SIZE - cuts[cuts.length - 2]
    const shift = 20 + noise(seed + 177, row) * (lastWidth - 40)
    for (let column = 0; column < widths.length; column++) {
      const local = row * 7 + column, left = cuts[column] + shift, width = cuts[column + 1] - cuts[column]
      wrap(left + width / 2, y + height / 2, width / 2 + 2, height / 2 + 2, (dx, dy) => {
        const x = left + dx + 2.2, top = y + dy + 2.2, right = left + dx + width - 2.2, bottom = y + dy + height - 2.2
        const chip = 2.5 + noise(seed + 31, local) * 6
        faces.add(`M${point(x + chip, top)}L${point(right - 6, top + .8)}L${point(right, top + 6)}L${point(right - .6, bottom - chip)}L${point(right - chip, bottom)}L${point(x + 6, bottom - .7)}L${point(x, bottom - 7)}L${point(x + .9, top + chip)}Z`, colors[Math.floor(noise(seed, local) * colors.length)])
        edges.add(`M${point(x + chip + 3, top + 2)}L${point(right - 9, top + 3)}M${point(x + 3, top + chip + 6)}L${point(x + 2.5, bottom - 11)}`, 'none', .33, dark ? '#B7BBA3' : '#EFE2BC', 1.1)
        edges.add(`M${point(x + 9, bottom - 2)}L${point(right - chip - 3, bottom - 2.5)}`, 'none', .24, dark ? '#384B49' : '#777F69', 1.3)
        if (noise(seed + 51, local) > .48) details.add(`M${point(x + width * .65, top + 4)}l-8 17l6 11l-14 16`, 'none', .28, dark ? '#384C4A' : '#777B67', .65)
        for (let vein = 0; vein < 4; vein++) {
          const vx = x + 12 + noise(seed + 61, local * 8 + vein) * (width - 30), vy = top + 13 + noise(seed + 79, local * 8 + vein) * (height - 30)
          details.add(`M${point(vx, vy)}q${point(8, -3)} ${point(15, -1)}`, 'none', .14, dark ? '#B3B6A0' : '#F2E4C0', .75)
        }
      })
    }
    y += height
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${dark ? '#414F4D' : '#777E6B'}"/>` + faces.svg()
    + washes(seed + 178, dark ? ['#B2AD8B', '#344E4C', '#9CA987'] : ['#E8D9AC', '#687E68', '#8D785A']) + edges.svg() + details.svg()
    + grain(seed + 300, dark ? ['#D2CEB0', '#2F4744'] : ['#F3E9CB', '#666F5C'])
}

/** Small finite generator shared by fixed originals; seed is an explicit unsigned 32-bit integer. */
export function generateHanddrawnSurfaceSvg(family: HanddrawnSurfaceFamily, seed: number): string {
  if (!['oak', 'limestone', 'basalt', 'plaster'].includes(family) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid handdrawn surface family or seed')
  const body = family === 'oak' ? oak(seed) : family === 'plaster'
    ? '<rect x="0" y="0" width="512" height="512" fill="#D0C3A3"/>' + washes(seed, ['#EEE3C3', '#9D957C', '#BB9F7D']) + grain(seed + 300, ['#F6ECCD', '#8A856D'])
    : flags(seed, family === 'basalt')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
}
export const handdrawnSurfaceAssetId = (key: string) => `handdrawn-surfaces-v1-art-${key}`
export const handdrawnSurfaceDefinitionId = (key: string) => `handdrawn-surfaces-v1-material-${key}`
export const HANDDRAWN_SURFACE_ART: readonly VisualSampleArt[] = freezeJson([
  { key: 'weathered-oak', name: '磨旧橡木长板', family: 'oak' as const, size: 6400, seed: 219 },
  { key: 'old-limestone-flags', name: '旧石灰岩板', family: 'limestone' as const, size: 4800, seed: 433 },
  { key: 'dark-basalt-flags', name: '深灰玄武岩板', family: 'basalt' as const, size: 4800, seed: 791 },
  { key: 'warm-plaster', name: '暖灰泥地面', family: 'plaster' as const, size: 3600, seed: 1031 },
].map(({ key, name, family, size, seed }) => ({ key, name, kind: 'material' as const, widthMm: size, heightMm: size,
  sourceSvg: generateHanddrawnSurfaceSvg(family, seed), tags: ['原创', '手绘', '地面', '无缝', 'handdrawn', family] })))
