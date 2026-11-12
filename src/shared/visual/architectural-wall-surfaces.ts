import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

/** Independent fixed sources; these paints never change wall thickness or openings. */
export const ARCHITECTURAL_WALL_LICENSE_REF = 'MIT-Sceneweave-Architectural-Wall-Surfaces-1'
export const ARCHITECTURAL_WALL_LICENSE = `Sceneweave Architectural Wall Surface Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original deterministic SVG wall-top masonry, plaster and concrete artwork authored in code for Sceneweave with coding assistance. Physical tile sizes describe the painted material only. No third-party imagery is embedded.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

export type ArchitecturalWallFamily = 'plastered-brick' | 'cast-concrete' | 'warm-masonry' | 'ruined-limestone'
const SIDE = 512
const num = (value: number) => Math.round(value * 100) / 100
const xy = (x: number, y: number) => `${num(x)} ${num(y)}`
function random(seed: number, index: number): number {
  let value = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x45d9f3b)
  value ^= value >>> 16
  return (Math.imul(value, 0x45d9f3b) >>> 0) / 0x100000000
}
class Paint {
  private readonly groups = new Map<string, string[]>()
  add(path: string, fill: string, opacity = 1, stroke = 'none', width = 1): void {
    const attrs = `fill="${fill}" opacity="${opacity}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
    const paths = this.groups.get(attrs) ?? []
    paths.push(path); this.groups.set(attrs, paths)
  }
  svg(): string { return [...this.groups].map(([attrs, paths]) => `<path d="${paths.join('')}" ${attrs}/>`).join('') }
}
/** Every periodic copy reuses the same primitive, including its pigment and damage. */
function repeat(x: number, y: number, rx: number, ry: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-SIDE, 0, SIDE]) for (const dy of [-SIDE, 0, SIDE]) {
    if (x + rx + dx < 0 || x - rx + dx > SIDE || y + ry + dy < 0 || y - ry + dy > SIDE) continue
    draw(dx, dy)
  }
}
function grain(seed: number, count: number, dark: string, light: string): string {
  const paint = new Paint()
  for (let index = 0; index < count; index++) {
    const x = random(seed, index * 3) * SIDE, y = random(seed, index * 3 + 1) * SIDE
    const radius = .3 + random(seed, index * 3 + 2) * .65
    repeat(x, y, radius, radius, (dx, dy) => paint.add(`M${xy(x + dx - radius, y + dy)}h${num(radius * 2)}`, 'none', index % 2 ? .24 : .18, index % 2 ? dark : light, .8))
  }
  return paint.svg()
}

function masonry(seed: number, family: Exclude<ArchitecturalWallFamily, 'cast-concrete'>): string {
  const ruined = family === 'ruined-limestone', plaster = family === 'plastered-brick'
  const faces = new Paint(), edges = new Paint(), marks = new Paint(), pigment = new Paint()
  const colors = ruined ? ['#9FA598', '#AEB2A2', '#A1AA9C', '#B6B8A8', '#969E92', '#ACAF9F']
    : plaster ? ['#C6B99F', '#D1C2A5', '#BEAF95', '#CCBFA3', '#C4B599', '#D4C7AD']
      : ['#B9AA8C', '#C6B594', '#B1A487', '#CDBB98', '#BCAE90', '#C1B297']
  const mortar = ruined ? '#67786C' : plaster ? '#8F836E' : '#797863'
  const highlight = ruined ? '#D9D7BC' : '#F1DFC0', shade = ruined ? '#566A5E' : '#746C56'
  // Six courses per 1.44m = 240mm. The transverse joints remain visible on a 240mm wall.
  const height = SIDE / 6
  for (let row = 0; row < 6; row++) {
    const widthA = 137 + random(seed + 41, row) * 36, widthB = 159 + random(seed + 53, row) * 29
    const widths = [widthA, widthB, SIDE - widthA - widthB]
    const shift = row % 2 ? 75 : -34
    let left = shift
    for (let column = 0; column < widths.length; column++) {
      const width = widths[column], key = row * 7 + column, y = row * height
      const chip = ruined ? 4 + random(seed, key) * 5 : 1.8 + random(seed, key) * 2
      const color = colors[Math.floor(random(seed + 17, key) * colors.length)]
      repeat(left + width / 2, y + height / 2, width / 2 + 3, height / 2 + 3, (dx, dy) => {
        const x = left + dx + 2.2, top = y + dy + 2.2, right = left + dx + width - 2.2, bottom = y + dy + height - 2.2
        faces.add(`M${xy(x + chip, top)}L${xy(right - chip, top + .7)}L${xy(right, top + chip)}L${xy(right - .6, bottom - chip)}L${xy(right - chip, bottom)}L${xy(x + chip, bottom - .6)}L${xy(x, bottom - chip)}L${xy(x + .7, top + chip)}Z`, color)
        edges.add(`M${xy(x + chip + 3, top + 2)}L${xy(right - chip - 4, top + 2.7)}M${xy(x + 2, top + chip + 4)}L${xy(x + 2.6, bottom - chip - 4)}`, 'none', .42, highlight, 1.4)
        edges.add(`M${xy(x + chip + 3, bottom - 2)}L${xy(right - chip - 3, bottom - 2.4)}`, 'none', .32, shade, 1.7)
        // Broad, translucent mineral layers read at scene scale; micrograin is secondary.
        pigment.add(`M${xy(x + 6, top + height * .35)}Q${xy(x + width * .45, top + height * .16)} ${xy(right - 6, top + height * .36)}L${xy(right - 9, bottom - 14)}Q${xy(x + width * .5, bottom - 6)} ${xy(x + 8, bottom - 18)}Z`, ruined ? '#687F6B' : '#E2D0AB', .1)
        if (ruined || random(seed + 97, key) > .66) {
          const cx = x + width * (.31 + random(seed + 101, key) * .24)
          marks.add(`M${xy(cx, top + 4)}l${xy(-7, height * .22)}l${xy(7, height * .13)}l${xy(-9, height * .27)}m8 -10l12 8`, 'none', ruined ? .57 : .3, shade, ruined ? 1.5 : .8)
        }
        if (plaster && key % 4 === 1) {
          // Small exposed warm brick fragments break the plaster without covering whole blocks.
          marks.add(`M${xy(right - 24, bottom - 3)}l-13 -6l5 -9l14 -4l9 9l-4 10Z`, '#A78769', .6)
          marks.add(`M${xy(right - 31, bottom - 11)}l16 -2`, 'none', .45, '#DAC3A0', 1.2)
        }
        if (ruined && key % 3 === 0) marks.add(`M${xy(right - chip - 14, bottom - 3)}l6 -9l10 1l-5 9Z`, mortar, .85)
      })
      left += width
    }
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${mortar}"/>` + faces.svg() + pigment.svg() + edges.svg() + marks.svg()
    + grain(seed + 311, 390, shade, highlight)
}
function concrete(seed: number): string {
  const faces = new Paint(), seams = new Paint(), marks = new Paint()
  const colors = ['#A8B1AE', '#AFB7B2', '#A4AEA9', '#B5BBB5']
  // 800mm cast panels and 400mm formwork subdivisions, with subtle warm aggregate.
  for (let row = 0; row < 4; row++) for (let column = 0; column < 2; column++) {
    const key = row * 2 + column, x = column * 256, y = row * 128
    faces.add(`M${xy(x + 1, y + 1)}h254v126h-254Z`, colors[Math.floor(random(seed, key) * colors.length)])
    seams.add(`M${xy(x + 1, y + 1)}h254M${xy(x + 1, y + 1)}v126`, 'none', .62, '#667B75', 1.2)
    seams.add(`M${xy(x + 3, y + 3)}h250M${xy(x + 3, y + 3)}v122`, 'none', .58, '#DDE0D1', 1)
    for (let line = 0; line < 3; line++) marks.add(`M${xy(x + 8, y + 28 + line * 32)}q${xy(59, -.5 + random(seed + key, line) * 2)} 120 0t120 0`, 'none', .15, '#E6E7D7', .8)
    for (const px of [x + 31, x + 225]) {
      const py = y + 65
      marks.add(`M${xy(px - 1.4, py)}a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z`, '#657A74', .47)
      marks.add(`M${xy(px - 1.4, py - 2.3)}h2.8`, 'none', .65, '#D9DDCF', .8)
    }
  }
  return '<rect x="0" y="0" width="512" height="512" fill="#899B94"/>' + faces.svg() + seams.svg() + marks.svg()
    + grain(seed + 311, 650, '#667C73', '#E2DDC9')
}

export function generateArchitecturalWallSurfaceSvg(family: ArchitecturalWallFamily, seed: number): string {
  if (!['plastered-brick', 'cast-concrete', 'warm-masonry', 'ruined-limestone'].includes(family)
    || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid architectural wall family or seed')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${family === 'cast-concrete' ? concrete(seed) : masonry(seed, family)}</svg>`
}
export const architecturalWallAssetId = (key: string) => `architectural-walls-v1-art-${key}`
export const architecturalWallDefinitionId = (key: string) => `architectural-walls-v1-material-${key}`
export const ARCHITECTURAL_WALL_ART: readonly VisualSampleArt[] = freezeJson([
  { key: 'old-house-plastered-brick', name: '旧宅暖灰抹面砖墙顶', family: 'plastered-brick' as const, size: 1440, seed: 1597 },
  { key: 'modern-cast-concrete', name: '现代清水混凝土墙顶', family: 'cast-concrete' as const, size: 1600, seed: 2027 },
  { key: 'tavern-warm-masonry', name: '旅舍暖色砌石墙顶', family: 'warm-masonry' as const, size: 1440, seed: 3079 },
  { key: 'ruins-fractured-limestone', name: '遗迹破损石灰岩墙顶', family: 'ruined-limestone' as const, size: 1440, seed: 4093 },
].map(({ key, name, family, size, seed }) => ({ key, name, kind: 'material' as const, widthMm: size, heightMm: size,
  sourceSvg: generateArchitecturalWallSurfaceSvg(family, seed), tags: ['原创', '手绘', '墙顶', '砌缝', '无缝', 'wall', family] })))
