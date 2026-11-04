import type { VisualSampleArt } from './sample-art.js'

/** Independent original surface batch. Old Q1/Q2 source artwork is immutable. */
export const SHORE_MATERIAL_IDS = Object.freeze({
  rockDry: 'shore-v1-material-rock-dry', rockWet: 'shore-v1-material-rock-wet', grass: 'shore-v1-material-grass',
  waterDeep: 'shore-v1-material-water-deep', waterShallow: 'shore-v1-material-water-shallow',
  sandDry: 'shore-v1-material-sand-dry', sandWet: 'shore-v1-material-sand-wet',
})
export const shoreAssetId = (key: string): string => `shore-v1-art-${key.replace(/^shore-v1-/, '')}`
export const shoreMaterialId = (key: string): string => `shore-v1-material-${key.replace(/^shore-v1-/, '')}`
export const SHORE_LICENSE_REF = 'MIT-Sceneweave-Shore-Surfaces-1'

const n = (value: number): number => Math.round(value * 10) / 10
function noise(seed: number, index: number): number {
  let value = Math.imul(seed + index * 137, 0x45d9f3b)
  value ^= value >>> 16
  return (Math.imul(value, 0x45d9f3b) >>> 0) / 4294967296
}

/** Draw a mark and only the adjacent copies needed by a periodic 512px tile.
 * All mark extents are supplied, so a seam never truncates a unique feature. */
function wrap(x: number, y: number, radiusX: number, radiusY: number, draw: (x: number, y: number) => string): string {
  const xs = [0, ...(x - radiusX < 0 ? [512] : []), ...(x + radiusX > 512 ? [-512] : [])]
  const ys = [0, ...(y - radiusY < 0 ? [512] : []), ...(y + radiusY > 512 ? [-512] : [])]
  return xs.flatMap(dx => ys.map(dy => draw(n(x + dx), n(y + dy)))).join('')
}

function grain(seed: number, count: number, colors: readonly string[], opacity: number): string {
  const paths = colors.map(() => '')
  for (let i = 0; i < count; i++) {
    const x = noise(seed, i * 4) * 512, y = noise(seed, i * 4 + 1) * 512
    const length = 1.5 + noise(seed, i * 4 + 2) * 4.5, rise = noise(seed, i * 4 + 3) * 2.5 - 1.25
    paths[i % paths.length] += wrap(x, y, 8, 5, (px, py) => `M${px} ${py}l${n(length)} ${n(rise)}`)
  }
  return paths.map((d, i) => `<path d="${d}" fill="none" stroke="${colors[i]}" stroke-width="1" stroke-linecap="round" opacity="${opacity}"/>`).join('')
}

function rock(wet: boolean): string {
  const seed = wet ? 1313 : 1217, patches: string[] = [], cracks = ['', ''], highlights = ['', '']
  for (let i = 0; i < 11; i++) {
    const x = noise(seed, i * 5) * 512, y = noise(seed, i * 5 + 1) * 512
    const rx = 24 + noise(seed, i * 5 + 2) * 42, ry = 11 + noise(seed, i * 5 + 3) * 21
    patches.push(wrap(x, y, rx + 3, ry + 3, (px, py) => `<path d="M${n(px - rx)} ${py}q${n(rx * .26)} ${n(-ry * 1.16)} ${n(rx * .92)} ${n(-ry * .82)}q${n(rx * .93)} ${n(-ry * .31)} ${n(rx * 1.08)} ${n(ry * .83)}q${n(-rx * .45)} ${n(ry * 1.12)} ${n(-rx * 1.15)} ${n(ry * .78)}q${n(-rx * .7)} ${n(ry * .17)} ${n(-rx * .85)} ${n(-ry * .79)}Z" fill="${wet ? '#7C9690' : '#D8C8A4'}" opacity="${i % 2 ? '.19' : '.12'}"/>`))
    const length = 24 + noise(seed, i * 5 + 4) * 53, rise = -8 + noise(seed + 1, i) * 15
    cracks[i % 2] += wrap(x, y, length + 4, 34, (px, py) => `M${n(px - length / 2)} ${py}l${n(length * .3)} -6 ${n(length * .22)} 4 ${n(length * .28)} ${n(rise)} ${n(length * .2)} -3`)
    if (i % 3 === 0) cracks[i % 2] += wrap(x, y, 14, 38, (px, py) => `M${px} ${py}l-5 13 7 11 -3 9`)
    highlights[i % 2] += wrap(x, y, length + 4, 16, (px, py) => `M${n(px - length / 2 + 2)} ${n(py - 2.8)}l${n(length * .3)} -6 ${n(length * .22)} 4 ${n(length * .2)} ${n(rise * .72)}`)
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${wet ? '#81928B' : '#C1B18E'}"/>${patches.join('')}`
    + cracks.map((d, i) => `<path d="${d}" fill="none" stroke="${wet ? '#506F70' : '#7F826D'}" stroke-width="${i ? 1.4 : 1.8}" stroke-linecap="round" stroke-linejoin="round" opacity="${wet ? '.4' : '.38'}"/>`).join('')
    + highlights.map(d => `<path d="${d}" fill="none" stroke="${wet ? '#B8C3AA' : '#E4D4AD'}" stroke-width="1.1" stroke-linecap="round" opacity=".58"/>`).join('')
    + grain(seed + 19, 160, wet ? ['#CBD1B2', '#4E7976', '#A7B59A'] : ['#F0DFB7', '#909075', '#D5C49F'], .23)
}

function grass(): string {
  let masses = '', leaves = '', stone = ''
  for (let i = 0; i < 20; i++) {
    const x = noise(1511, i * 4) * 512, y = noise(1511, i * 4 + 1) * 512
    const rx = 15 + noise(1511, i * 4 + 2) * 22, ry = 8 + noise(1511, i * 4 + 3) * 16
    masses += wrap(x, y, rx + 3, ry + 3, (px, py) => `<path d="M${n(px - rx)} ${py}q${n(rx * .27)} ${n(-ry)} ${n(rx * .72)} ${n(-ry * .63)}q${n(rx * .71)} ${n(-ry * .8)} ${n(rx * 1.28)} ${n(ry * .6)}q${n(-rx * .2)} ${n(ry * .9)} ${n(-rx * .97)} ${n(ry * .68)}q${n(-rx * .76)} ${n(ry * .55)} ${n(-rx * 1.03)} ${n(-ry * .65)}Z" fill="${i % 3 ? '#839667' : '#C0C58D'}" opacity="${i % 3 ? '.19' : '.28'}"/>`)
  }
  for (let i = 0; i < 95; i++) {
    const x = noise(1579, i * 3) * 512, y = noise(1579, i * 3 + 1) * 512, length = 2.5 + noise(1579, i * 3 + 2) * 4
    leaves += wrap(x, y, 9, 10, (px, py) => `M${n(px - length)} ${py}q${n(length * .6)} ${n(-length * .8)} ${length} ${n(-length * .2)}m-1 1q1 -3 3 -4`)
    if (i % 17 === 0) stone += wrap(x, y, 8, 6, (px, py) => `M${n(px - 4)} ${py}l4 -2 5 2 -2 3 -5 1Z`)
  }
  return '<rect x="0" y="0" width="512" height="512" fill="#A1B67B"/>' + masses
    + `<path d="${leaves}" fill="none" stroke="#697E59" stroke-width=".85" stroke-linecap="round" opacity=".45"/>`
    + `<path d="${stone}" fill="#BEB691" stroke="#89906E" stroke-width=".7" opacity=".6"/>`
    + grain(1621, 130, ['#D7D3A0', '#71865C', '#B7C58B'], .31)
}

function water(shallow: boolean): string {
  const seed = shallow ? 1747 : 1699, lines = ['', '']
  for (let i = 0; i < 17; i++) {
    const x = noise(seed, i * 4) * 512, y = noise(seed, i * 4 + 1) * 512
    const length = 10 + noise(seed, i * 4 + 2) * 29, rise = 1 + noise(seed, i * 4 + 3) * 3
    lines[i % 2] += wrap(x, y, length + 3, rise + 4, (px, py) => `M${n(px - length / 2)} ${py}q${n(length * .22)} ${n(-rise)} ${n(length * .49)} ${n(-rise * .38)}t${n(length * .51)} ${n(rise * .33)}`)
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${shallow ? '#A6C8BC' : '#75B5BB'}"/>`
    + lines.map((d, i) => `<path d="${d}" fill="none" stroke="${shallow ? i ? '#7DAEA7' : '#E1E7C8' : i ? '#4A98A4' : '#C5DDD0'}" stroke-width="${i ? 1.1 : 1.4}" stroke-linecap="round" opacity="${shallow ? '.45' : '.36'}"/>`).join('')
    + grain(seed + 17, shallow ? 47 : 31, shallow ? ['#D7DFC1', '#79ADA7'] : ['#ACD4CA', '#589BA7'], .16)
}

function sand(wet: boolean): string {
  const seed = wet ? 1913 : 1831, strokes = ['', '']
  for (let i = 0; i < 14; i++) {
    const x = noise(seed, i * 3) * 512, y = noise(seed, i * 3 + 1) * 512, length = 13 + noise(seed, i * 3 + 2) * 20
    strokes[i % 2] += wrap(x, y, length + 3, 9, (px, py) => `M${n(px - length / 2)} ${py}q${n(length * .47)} -3 ${length} -1`)
  }
  return `<rect x="0" y="0" width="512" height="512" fill="${wet ? '#A9AD90' : '#DCC89E'}"/>`
    + strokes.map((d, i) => `<path d="${d}" fill="none" stroke="${wet ? i ? '#7A907F' : '#CBD1AE' : i ? '#AD9C79' : '#F2DFB5'}" stroke-width="${i ? 1 : 1.3}" stroke-linecap="round" opacity=".3"/>`).join('')
    + grain(seed + 31, 190, wet ? ['#D2D7B6', '#7F9583', '#B4BA99'] : ['#F6E6BF', '#A8A080', '#C2B18A'], .25)
}

function material(key: string, name: string, body: string, tileMm: number, tags: string[]): VisualSampleArt {
  return Object.freeze({ key: `shore-v1-${key}`, name, kind: 'material', sourceSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`,
    widthMm: tileMm, heightMm: tileMm, tags: [...tags] })
}
export const SHORE_ART: readonly VisualSampleArt[] = Object.freeze([
  material('rock-dry', '日暖裂隙裸岩', rock(false), 3600, ['岩地', '干岩', 'rock', 'strata', 'ground']),
  material('rock-wet', '潮浸冷色岩', rock(true), 3600, ['岩地', '湿岩', 'rock', 'wet', 'shore']),
  material('grass', '浅绿碎叶苔草', grass(), 3000, ['草地', '苔草', 'grass', 'moss', 'ground']),
  material('water-deep', '青蓝疏纹海水', water(false), 8200, ['海水', '远水', 'water', 'sea', 'deep']),
  material('water-shallow', '近岸浅青水', water(true), 7200, ['浅水', '近岸', 'water', 'shallows', 'shore']),
  material('sand-dry', '暖浅干沙', sand(false), 4200, ['沙地', '干沙', 'sand', 'beach']),
  material('sand-wet', '灰褐潮湿沙', sand(true), 4200, ['沙地', '湿沙', 'sand', 'wet', 'shore']),
])

export const SHORE_LICENSE = 'Sceneweave Shore Surface Artwork, version 1\nCopyright (c) 2026 Sceneweave contributors\n\nOriginal deterministic SVG surface artwork created for Sceneweave with coding assistance. No reference-map pixels, traced source imagery or third-party assets are embedded. All seven opaque periodic tiles retain their actual source SVG, normalized SVG and PNG bytes.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
