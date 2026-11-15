import type { FixedPresentation } from '../terrain-generation/contracts.js'
import { freezeJson } from '../validation/json.js'
import type { VisualSampleArt } from './sample-art.js'

export const WHOLE_PLANT_VERSION = 1 as const
export const WHOLE_PLANT_LICENSE_REF = 'MIT-Sceneweave-Whole-Plants-1'
export const WHOLE_PLANT_LICENSE = `Sceneweave Whole Plant Artwork, version 1
Copyright (c) 2026 Sceneweave contributors

Original top-down SVG artwork authored for Sceneweave with coding assistance. Each item depicts a complete tree, shrub or rooted plant clump. No third-party artwork or reference-image pixels are embedded. Existing fixed plants and their saved instances are preserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`

export interface WholePlantArt extends VisualSampleArt {
  role: 'tree' | 'shrub' | 'groundcover'
  rootPixel: { x: number; y: number }
  presentation: FixedPresentation
}
const n = (value: number) => Math.round(value * 100) / 100
function random(seed: number, index: number): number {
  let value = Math.imul(seed + index * 137, 0x45d9f3b)
  value ^= value >>> 16; value = Math.imul(value, 0x45d9f3b)
  return (value >>> 0) / 4294967296
}
const path = (d: string, fill: string, stroke = 'none', width = 0, opacity = 1) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`
const repeat = (count: number, draw: (index: number) => string) => Array.from({ length: count }, (_, i) => draw(i)).join('')

/** Continuous irregular leaf masses; fine marks never allocate separate items. */
function crownMass(x: number, y: number, rx: number, ry: number, seed: number, fill: string, outline = '#3C5840'): string {
  const points = Array.from({ length: 32 }, (_, i) => {
    const a = i * Math.PI / 16, r = .92 + .06 * Math.sin(a * 5 + seed) + .07 * random(seed, i)
    return { x: x + Math.cos(a) * rx * r, y: y + Math.sin(a) * ry * r }
  })
  const mid = (a: typeof points[number], b: typeof points[number]) => `${n((a.x + b.x) / 2)} ${n((a.y + b.y) / 2)}`
  const d = `M${mid(points[31], points[0])}` + points.map((p, i) => `Q${n(p.x)} ${n(p.y)} ${mid(p, points[(i + 1) % points.length])}`).join('') + 'Z'
  return path(d, fill, outline, 1.6)
}
function leaves(x: number, y: number, rx: number, ry: number, seed: number, count: number, colors: readonly string[], slender = false): string {
  return repeat(count, i => {
    const a = i * 2.39996, r = Math.sqrt(random(seed, i + 1)) * .9
    const px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r
    const length = (slender ? 14 : 6) + random(seed, i + 700) * (slender ? 13 : 7), width = slender ? 2.4 : length * .43
    return `<g transform="translate(${n(px)} ${n(py)}) rotate(${n(random(seed, i + 400) * 360)})">` +
      path(`M${n(-length / 2)} 0Q0 ${n(-width)} ${n(length / 2)} 0Q0 ${n(width)} ${n(-length / 2)} 0Z`, colors[i % colors.length], 'none', 0, .72) + '</g>'
  })
}
type Branch = readonly [number, number, number, number]
function broadCrown(seed: number, branches: readonly Branch[], colors: readonly string[], slender = false): string {
  const stems = branches.map(([x, y]) => path(`M256 268Q${n((x + 256) / 2 + 12)} ${n((y + 268) / 2)} ${x} ${y}`, 'none', '#685B3C', 8)).join('')
  return stems + branches.map(([x, y, rx, ry], i) => crownMass(x, y, rx, ry, seed + i * 13, colors[i % 3]) +
    crownMass(x - rx * .08, y - ry * .05, rx * .68, ry * .7, seed + i * 19, colors[3], 'none') +
    leaves(x, y, rx * .9, ry * .9, seed + i * 71, slender ? 32 : 26, colors.slice(1), slender)).join('')
}
function pine(): string {
  const branches = [[-124, -89, 114, 69, -23], [66, -132, 114, 76, 47], [129, -15, 112, 76, 12], [73, 104, 109, 72, 55], [-81, 117, 111, 79, -36], [-137, 17, 80, 66, -61], [-9, -10, 107, 91, 16]]
  return branches.map(([x, y]) => path(`M256 260Q${n(256 + x * .6)} ${n(260 + y * .3)} ${256 + x} ${260 + y}`, 'none', '#6D6247', 11)).join('') +
    branches.map(([x, y, rx, ry, angle], branch) => `<g transform="translate(${256 + x} ${260 + y}) rotate(${angle})">` +
      crownMass(0, 0, rx, ry, branch + 21, ['#365E4B', '#497357', '#5C805A'][branch % 3]) +
      repeat(33, i => {
        const px = (random(branch + 27, i) - .5) * rx * 1.6, py = (random(branch + 73, i) - .5) * ry * 1.5
        return path(`M${n(px - 12)} ${n(py + 9)}l12 -13 11 6m-11 -6 3 -12`, 'none', i % 3 ? '#87A47A' : '#A1B48A', 1.5, .8)
      }) + '</g>').join('')
}
function fern(): string {
  return [-156, -112, -73, -27, 12, 57, 103, 145, 177].map((angle, frond) => {
    const length = [159, 178, 207, 218, 194, 206, 172, 187, 145][frond]
    return `<g transform="translate(256 274) rotate(${angle})">` +
      path(`M0 0Q-19 ${n(-length * .55)} 0 ${-length}`, 'none', '#557A43', 4.5) +
      repeat(10, row => [-1, 1].map(side => {
        const y = -22 - row * (length - 36) / 10, width = (1 - row / 11) * 43, tip = side * width
        return path(`M-7 ${n(y)}Q${n(tip * .6)} ${n(y + 13)} ${n(tip)} ${n(y - 12)}Q${n(tip * .53)} ${n(y - 21)} -7 ${n(y - 7)}Z`,
          ['#537B43', '#6A914F', '#7D9B59'][frond % 3], '#486C3D', .85)
      }).join('')) + '</g>'
  }).join('') + crownMass(255, 273, 22, 18, 29, '#608547', 'none')
}
function rosette(): string {
  return [-148, -97, -48, -9, 33, 78, 127, 173].map((angle, i) => {
    const length = [142, 173, 204, 186, 161, 185, 163, 133][i]
    return `<g transform="translate(256 273) rotate(${angle})">` +
      path(`M0 8C-19 -20 -67 ${n(-length * .53)} -28 ${n(-length * .86)}Q-7 ${-length} 4 ${-length - 9}C19 ${n(-length * .7)} 68 -69 0 8Z`, ['#4F7846', '#6A914F', '#7E9E5C'][i % 3], '#42663E', 1.8) +
      path(`M0 1Q4 ${n(-length * .45)} 4 ${-length + 12}M0 -43l-22 -31M3 -65l29 -39M2 -100l-18 -25`, 'none', '#ADC18B', 1.8, .7) + '</g>'
  }).join('')
}
function grass(seed: number, reeds = false): string {
  const stems = repeat(reeds ? 33 : 51, i => {
    const x = 234 + random(seed, i) * 44, y = 258 + random(seed, i + 300) * 28
    const a = random(seed, i + 100) * Math.PI * 2, length = 80 + random(seed, i + 200) * (reeds ? 144 : 111)
    const tx = x + Math.cos(a) * length, ty = y + Math.sin(a) * length * .82
    const cx = x + Math.cos(a - .43) * length * .7, cy = y + Math.sin(a - .43) * length * .7
    let body = path(`M${n(x)} ${n(y)}Q${n(cx - 8)} ${n(cy)} ${n(tx)} ${n(ty)}Q${n(cx + 7)} ${n(cy + 10)} ${n(x)} ${n(y)}Z`,
      (reeds ? ['#58704B', '#738B55', '#98A369', '#B2AB72'] : ['#4D7047', '#6C8C52', '#8DA266', '#A2AF73'])[i % 4])
    if (reeds && i % 4 === 0) body += `<g transform="translate(${n(tx)} ${n(ty)}) rotate(${n(a * 180 / Math.PI)})">` + path('M-16 -4Q-20 0 -16 4L7 4Q12 0 7 -4Z', '#82704C', '#63553C', 1.2) + '</g>'
    return body
  })
  return stems + crownMass(256, 277, 22, 16, seed + 99, reeds ? '#81905C' : '#729052', 'none')
}
function bramble(seed: number, flowers = false): string {
  const body = broadCrown(seed, [[171, 248, 92, 80], [279, 176, 88, 80], [344, 285, 102, 88], [233, 344, 92, 76]], ['#426847', '#55794A', '#69894F', '#74955C'])
  return body + repeat(flowers ? 27 : 19, i => {
    const a = i * 2.399, r = 48 + random(seed, i + 600) * 113, x = 256 + Math.cos(a) * r, y = 266 + Math.sin(a) * r * .79
    if (!flowers) return crownMass(x, y, 4.5, 5, seed + i, i % 4 ? '#8C5861' : '#B1A28B', 'none')
    return `<g transform="translate(${n(x)} ${n(y)})">` + repeat(5, p => {
      const a = p * Math.PI * .4
      return `<ellipse cx="${n(Math.cos(a) * 5)}" cy="${n(Math.sin(a) * 5)}" rx="4.7" ry="3.6" fill="${i % 4 ? '#E4DCB0' : '#C9B8BD'}"/>`
    }) + '<circle cx="0" cy="0" r="2.6" fill="#B39A48"/></g>'
  })
}
const presentation: FixedPresentation = { mode: 'topDown', rootAnchorMm: { x: 0, y: 0 }, orientation: 'rotateWithGround', groundShadowMm: null }
function plant(key: string, name: string, role: WholePlantArt['role'], body: string, widthMm: number, heightMm: number, footprintWidthMm: number, footprintHeightMm: number, tags: string[], rootY = 268): WholePlantArt {
  return { key, name, kind: 'prop', role, widthMm, heightMm, rootPixel: { x: 256, y: rootY }, footprintMm: { width: footprintWidthMm, height: footprintHeightMm },
    blocksMovement: role === 'tree', blocksSight: role === 'tree', renderLayer: role === 'tree' ? 'canopy' : role === 'shrub' ? 'object' : 'ground',
    shadowClass: role === 'groundcover' ? 'none' : 'vegetation', presentation,
    tags: ['原创', '整株植物', 'whole-plant', '俯视', role, ...(role === 'tree' ? ['树木'] : role === 'shrub' ? ['灌木'] : ['地被']), ...tags],
    sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>` }
}
export const WHOLE_PLANT_ART: readonly WholePlantArt[] = freezeJson([
  plant('oak-spreading', '舒冠栎树', 'tree', broadCrown(41, [[163, 170, 108, 99], [293, 137, 99, 89], [366, 237, 105, 106], [297, 352, 116, 98], [147, 319, 103, 106], [242, 253, 119, 103]], ['#426647', '#60804D', '#6E8951', '#7B975D']), 4000, 3800, 700, 700, ['栎树', '阔叶', 'oak', '林地']),
  plant('birch-young', '疏冠幼桦', 'tree', broadCrown(97, [[218, 143, 91, 94], [303, 226, 92, 109], [195, 312, 100, 107], [296, 371, 86, 68]], ['#5F7D4F', '#7D965E', '#849C63', '#94AA74']), 2500, 3300, 460, 500, ['桦树', '阔叶', 'birch', '林缘']),
  plant('pine-branched', '展枝赤松', 'tree', pine(), 3400, 3500, 600, 600, ['松树', '针叶', 'pine', '山地'], 260),
  plant('willow-river', '河岸柳树', 'tree', broadCrown(173, [[181, 145, 101, 91], [310, 157, 104, 101], [379, 281, 89, 108], [247, 367, 129, 93], [130, 290, 90, 101], [251, 244, 117, 109]], ['#4C7050', '#718B59', '#81985C', '#91A56B'], true), 3900, 3700, 650, 650, ['柳树', 'willow', '河岸', '湿地']),
  plant('hazel-bush', '榛叶灌丛', 'shrub', broadCrown(211, [[171, 231, 91, 104], [293, 180, 115, 94], [350, 301, 95, 102], [216, 347, 109, 94]], ['#426648', '#577C50', '#6E8E55', '#7D9A61']), 1800, 1600, 650, 600, ['榛树', 'hazel', '林下']),
  plant('bramble-fruiting', '结果荆棘丛', 'shrub', bramble(263), 1900, 1500, 800, 600, ['荆棘', '浆果', 'bramble', '林缘']),
  plant('juniper-low', '匍枝杜松', 'shrub', broadCrown(307, [[132, 265, 89, 72], [230, 178, 103, 70], [356, 230, 107, 80], [313, 338, 112, 73], [199, 331, 103, 70]], ['#43665A', '#577C65', '#6D8C71', '#7D9B7C'], true), 1800, 1400, 700, 500, ['杜松', 'juniper', '针叶', '山地']),
  plant('fern-full-crown', '丛生鳞毛蕨', 'groundcover', fern(), 1500, 1450, 450, 450, ['蕨类', 'fern', '林下', '湿地'], 274),
  plant('dock-rosette', '阔叶酸模', 'groundcover', rosette(), 1000, 1000, 320, 320, ['阔叶草本', '酸模', 'dock', '河岸'], 273),
  plant('sedge-tussock', '弯叶苔草丛', 'groundcover', grass(353), 1200, 1100, 460, 420, ['草丛', '苔草', 'sedge', '湿地'], 277),
  plant('reed-whole-clump', '香蒲芦苇丛', 'groundcover', grass(401, true), 1500, 1300, 650, 550, ['芦苇', '香蒲', 'reed', '河岸', '湿地'], 277),
  plant('wildflower-whole-clump', '林缘野花丛', 'groundcover', bramble(443, true), 1100, 1000, 400, 350, ['野花', 'flower', '草本', '林缘']),
])
export const wholePlantAssetId = (key: string) => `whole-plants-v1-art-${key}`
export const wholePlantDefinitionId = (key: string) => `whole-plants-v1-prop-${key}`
export const WHOLE_PLANT_SPECS = freezeJson(WHOLE_PLANT_ART.map(art => ({
  key: art.key, name: art.name, role: art.role, version: WHOLE_PLANT_VERSION,
  catalogId: `prop.sceneweave.whole-plants-v1.${art.key}`, assetId: wholePlantAssetId(art.key), definitionId: wholePlantDefinitionId(art.key),
  widthMm: art.widthMm, heightMm: art.heightMm, rootPixel: art.rootPixel,
  visualBoundsMm: { x: -Math.round(art.rootPixel.x / 512 * art.widthMm), y: -Math.round(art.rootPixel.y / 512 * art.heightMm), width: art.widthMm, height: art.heightMm },
  footprintMm: art.footprintMm!, presentation: art.presentation,
})))
