import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

/** Independent painted sources. Neither colour nor cracks grant heat or travel semantics. */
export const VOLCANIC_SURFACE_LICENSE_REF = 'MIT-Sceneweave-Volcanic-Surfaces-1'
export const VOLCANIC_SURFACE_LICENSE = `Sceneweave Volcanic Surface Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic SVG ash, fractured basalt, cooled lava, molten lava and worn ash artwork authored in code for Sceneweave with coding assistance. Physical tile sizes describe the painted material only. No third-party imagery is embedded.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

export type VolcanicSurfaceFamily = 'ash' | 'basalt' | 'cold-lava' | 'molten-lava' | 'worn-ash'
const SIDE = 512
const n = (value: number) => Math.round(value * 100) / 100
const xy = (x: number, y: number) => `${n(x)} ${n(y)}`
function random(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15
  return (Math.imul(value, 0x846ca68b) >>> 0) / 4294967296
}
class Paint {
  private readonly groups = new Map<string, string[]>()
  add(d: string, fill: string, opacity = 1, stroke = 'none', width = 1): void {
    const attrs = `fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
    const paths = this.groups.get(attrs) ?? []; paths.push(d); this.groups.set(attrs, paths)
  }
  svg(): string { return [...this.groups].map(([attrs, paths]) => `<path d="${paths.join('')}" ${attrs}/>`).join('') }
}
/** Repeat the exact pigment, fracture and highlight across both tile axes. */
function repeat(x: number, y: number, radius: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-SIDE, 0, SIDE]) for (const dy of [-SIDE, 0, SIDE]) {
    if (x + radius + dx < 0 || x - radius + dx > SIDE || y + radius + dy < 0 || y - radius + dy > SIDE) continue
    draw(dx, dy)
  }
}
function lens(x: number, y: number, rx: number, ry: number, angle: number, seed: number): string {
  const points = Array.from({ length: 8 }, (_, index) => {
    const a = index * Math.PI / 4, scale = .76 + random(seed, index) * .24
    const px = Math.cos(a) * rx * scale, py = Math.sin(a) * ry * scale
    return { x: x + px * Math.cos(angle) - py * Math.sin(angle), y: y + px * Math.sin(angle) + py * Math.cos(angle) }
  })
  const first = points[0], last = points.at(-1)!
  let d = `M${xy((first.x + last.x) / 2, (first.y + last.y) / 2)}`
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    d += `Q${xy(a.x, a.y)} ${xy((a.x + b.x) / 2, (a.y + b.y) / 2)}`
  }
  return `${d}Z`
}
function grain(seed: number, count: number, dark: string, light: string): string {
  const paint = new Paint()
  for (let index = 0; index < count; index++) {
    const x = random(seed, index * 4) * SIDE, y = random(seed, index * 4 + 1) * SIDE
    const length = .3 + random(seed, index * 4 + 2) * 1.3, width = index % 2 ? .55 : .85
    repeat(x, y, length, (dx, dy) => paint.add(`M${xy(x + dx - length / 2, y + dy)}l${xy(length, -.2)}`,
      'none', index % 3 ? .21 : .28, index % 3 ? dark : light, width))
  }
  return paint.svg()
}
function ash(seed: number, worn: boolean): string {
  const deposits = new Paint(), ribbons = new Paint(), rubble = new Paint()
  const colors = worn ? ['#AAA08D', '#9B927F', '#B2A58C', '#8E897B'] : ['#8A867A', '#9D9786', '#817F75', '#A39A86']
  for (let i = 0; i < 24; i++) {
    const x = random(seed, i * 5) * SIDE, y = random(seed, i * 5 + 1) * SIDE
    const rx = 55 + random(seed, i * 5 + 2) * 92, ry = 13 + random(seed, i * 5 + 3) * 36
    const angle = -.45 + random(seed, i * 5 + 4) * .7
    repeat(x, y, rx + ry, (dx, dy) => deposits.add(lens(x + dx, y + dy, rx, ry, angle, seed + i * 71), colors[i % colors.length], .055))
  }
  // Wind deposits have several scales; they are not a regular paving grid.
  for (let i = 0; i < 13; i++) {
    const x = random(seed + 131, i * 3) * SIDE, y = random(seed + 131, i * 3 + 1) * SIDE, length = 60 + random(seed + 131, i * 3 + 2) * 150
    repeat(x, y, length, (dx, dy) => {
      ribbons.add(`M${xy(x + dx - length / 2, y + dy + 7)}q${xy(length * .3, -13)} ${xy(length, -19)}`, 'none', .045, worn ? '#D8C8A4' : '#C4B99C', 2)
      ribbons.add(`M${xy(x + dx - length / 2, y + dy + 11)}q${xy(length * .35, -9)} ${xy(length * .8, -12)}`, 'none', .055, worn ? '#797264' : '#66695F', 1.2)
    })
  }
  for (let i = 0; i < 95; i++) {
    const x = random(seed + 251, i * 3) * SIDE, y = random(seed + 251, i * 3 + 1) * SIDE, r = .8 + random(seed + 251, i * 3 + 2) * 2.8
    repeat(x, y, r * 2, (dx, dy) => {
      rubble.add(lens(x + dx, y + dy, r * 1.3, r * .7, -.3, seed + i), i % 3 ? '#565E58' : '#C4BEA3', .43)
      rubble.add(`M${xy(x + dx - r * .6, y + dy - r * .35)}l${xy(r, -.25)}`, 'none', .31, '#DDD0AC', .5)
    })
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${worn ? '#7D8175' : '#918C7F'}"/>`
    + deposits.svg() + ribbons.svg() + rubble.svg() + grain(seed + 601, 1250, worn ? '#686D62' : '#5D625A', '#D4CAAC')
}
function stone(seed: number, cold: boolean): string {
  const strata = new Paint(), fissures = new Paint(), lips = new Paint(), fragments = new Paint()
  const colors = cold ? ['#454642', '#4D4B44', '#3D4240', '#525047', '#454841'] : ['#65655E', '#5D615B', '#6B6A61', '#565E58', '#6D6B61']
  for (let i = 0; i < 66; i++) {
    const x = random(seed, i * 5) * SIDE, y = random(seed, i * 5 + 1) * SIDE
    const rx = 8 + random(seed, i * 5 + 2) * 42, ry = 3 + random(seed, i * 5 + 3) * 12, angle = -.7 + random(seed, i * 5 + 4) * 1.2
    repeat(x, y, rx + ry, (dx, dy) => strata.add(`M${xy(x + dx - rx, y + dy - ry * .4)}l${xy(rx * .7, -ry * .6)}l${xy(rx * 1.1, ry * .3)}l${xy(rx * .2, ry * .55)}l${xy(-rx * 1.15, ry * .7)}l${xy(-rx * .85, -ry * .45)}Z`, colors[i % colors.length], .24))
  }
  for (let i = 0; i < 39; i++) {
    const x = random(seed + 173, i * 5) * SIDE, y = random(seed + 173, i * 5 + 1) * SIDE
    const length = 12 + random(seed + 173, i * 5 + 2) * 62, angle = -.9 + random(seed + 173, i * 5 + 3) * 1.8
    const bend = (random(seed + 173, i * 5 + 4) - .5) * 30, cos = Math.cos(angle), sin = Math.sin(angle)
    const p = (t: number, offset: number, dx: number, dy: number) => xy(x + dx + cos * length * t - sin * offset, y + dy + sin * length * t + cos * offset)
    repeat(x, y, length + 40, (dx, dy) => {
      const d = `M${p(-.5, 0, dx, dy)}L${p(-.24, -5, dx, dy)}L${p(-.02, bend, dx, dy)}L${p(.23, bend - 8, dx, dy)}L${p(.5, -2, dx, dy)}`
      fissures.add(d, 'none', .46, cold ? '#292B29' : '#3F4740', cold ? 1.4 : 1.1)
      lips.add(`M${p(-.47, -2, dx, dy)}L${p(-.24, -7, dx, dy)}L${p(-.02, bend - 2, dx, dy)}L${p(.22, bend - 10, dx, dy)}`, 'none', .28, cold ? '#8D7C64' : '#A49C84', .6)
      if (cold && i % 4 === 1) fissures.add(`M${p(-.21, -4, dx, dy)}L${p(-.02, bend, dx, dy)}L${p(.16, bend - 6, dx, dy)}`, 'none', .62, '#C3683F', .8)
    })
  }
  for (let i = 0; i < 175; i++) {
    const x = random(seed + 307, i * 3) * SIDE, y = random(seed + 307, i * 3 + 1) * SIDE, r = .6 + random(seed + 307, i * 3 + 2) * 3
    repeat(x, y, r * 2, (dx, dy) => fragments.add(lens(x + dx, y + dy, r * 1.7, r * .8, -.4, seed + i), i % 4 ? '#283F36' : '#B0A98A', .24))
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${cold ? '#454841' : '#62665D'}"/>`
    + strata.svg() + fissures.svg() + lips.svg() + fragments.svg() + grain(seed + 601, 1300, '#353D35', cold ? '#978B71' : '#B0A184')
}
function molten(seed: number): string {
  const currents = new Paint(), crust = new Paint(), edges = new Paint(), sparks = new Paint()
  for (let i = 0; i < 26; i++) {
    const x = random(seed, i * 5) * SIDE, y = random(seed, i * 5 + 1) * SIDE
    const rx = 33 + random(seed, i * 5 + 2) * 80, ry = 9 + random(seed, i * 5 + 3) * 28, angle = .9 + random(seed, i * 5 + 4) * .5
    repeat(x, y, rx + ry, (dx, dy) => {
      currents.add(lens(x + dx, y + dy, rx, ry, angle, seed + i * 47), '#FD9C45', .53)
      currents.add(lens(x + dx, y + dy, rx * .72, ry * .44, angle, seed + i * 47), '#FFD781', .6)
    })
  }
  for (let i = 0; i < 18; i++) {
    const x = random(seed + 151, i * 5) * SIDE, y = random(seed + 151, i * 5 + 1) * SIDE
    const rx = 7 + random(seed + 151, i * 5 + 2) * 24, ry = 3 + random(seed + 151, i * 5 + 3) * 9, angle = .9 + random(seed + 151, i * 5 + 4) * .9
    repeat(x, y, rx + ry, (dx, dy) => {
      edges.add(lens(x + dx, y + dy, rx + 2.8, ry + 2.8, angle, seed + i * 73), '#F7B45D', .67)
      crust.add(`M${xy(x + dx - rx, y + dy - ry * .5)}l${xy(rx * .8, -ry * .5)}l${xy(rx * 1.2, ry * .8)}l${xy(-rx * .4, ry * .6)}l${xy(-rx * 1.6, -ry * .4)}Z`, i % 3 ? '#71462F' : '#444139', .86)
      crust.add(lens(x + dx - 1, y + dy - 1, rx * .6, ry * .56, angle, seed + i * 73), '#9B6040', .42)
    })
  }
  for (let i = 0; i < 110; i++) {
    const x = random(seed + 317, i * 3) * SIDE, y = random(seed + 317, i * 3 + 1) * SIDE, r = .6 + random(seed + 317, i * 3 + 2) * 1.5
    repeat(x, y, r * 2, (dx, dy) => sparks.add(lens(x + dx, y + dy, r, r * 1.7, .3, seed + i), '#FFE3A0', .67))
  }
  return '<rect x="0" y="0" width="512" height="512" fill="#D76A38"/>' + currents.svg() + edges.svg() + crust.svg() + sparks.svg()
    + grain(seed + 601, 650, '#984D33', '#FFD481')
}
export function generateVolcanicSurfaceSvg(family: VolcanicSurfaceFamily, seed: number): string {
  if (!['ash', 'basalt', 'cold-lava', 'molten-lava', 'worn-ash'].includes(family)
    || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid volcanic surface family or seed')
  const body = family === 'ash' || family === 'worn-ash' ? ash(seed, family === 'worn-ash')
    : family === 'molten-lava' ? molten(seed) : stone(seed, family === 'cold-lava')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
}
export const volcanicSurfaceAssetId = (key: string) => `volcanic-surfaces-v1-art-${key}`
export const volcanicSurfaceDefinitionId = (key: string) => `volcanic-surfaces-v1-material-${key}`
export const VOLCANIC_SURFACE_ART: readonly VisualSampleArt[] = freezeJson([
  { key: 'wind-laid-ash', name: '风积火山灰', family: 'ash' as const, size: 8000, seed: 1783 },
  { key: 'fractured-basalt', name: '多尺度断裂玄武岩', family: 'basalt' as const, size: 8000, seed: 2843 },
  { key: 'cooled-lava-crust', name: '冷却熔岩壳', family: 'cold-lava' as const, size: 7000, seed: 3767 },
  { key: 'molten-lava', name: '流动熔岩与浮壳', family: 'molten-lava' as const, size: 5600, seed: 4657 },
  { key: 'worn-ash-path', name: '磨浅火山灰步道', family: 'worn-ash' as const, size: 6000, seed: 5741 },
].map(({ key, name, family, size, seed }) => ({ key, name, kind: 'material' as const, widthMm: size, heightMm: size,
  sourceSvg: generateVolcanicSurfaceSvg(family, seed), tags: ['原创', '手绘', '火山', '无缝', 'volcano', family] })))
