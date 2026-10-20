/**
 * Sceneweave original outdoor ink-and-colour art. Retained SVG is the editable source.
 * No external images, fonts, traced contours, image-generation service or baked cast shadows.
 * Run with installed desktop Chrome: node tools/build-island-art.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const root = new URL('../', import.meta.url)
const sourceRoot = new URL('assets/sceneweave-handdrawn-outdoor/', root)
const publicRoot = new URL('public/assets/sceneweave-handdrawn-outdoor/', root)
await mkdir(sourceRoot, { recursive: true }); await mkdir(publicRoot, { recursive: true })
const ink = '#3E493C'
const path = (d, stroke = ink, width = 2.048, fill = 'none', opacity = 1) => `<path d="${d}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
const ellipse = (x, y, rx, ry, fill, stroke = 'none', width = 0, opacity = 1) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`
const f = value => Number(value.toFixed(2))
let randomState = 0x49534c44
const rand = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 }
const shade = (color, amount) => `#${[1, 3, 5].map(start => Math.min(255, Math.max(0, parseInt(color.slice(start, start + 2), 16) + amount)).toString(16).padStart(2, '0')).join('')}`
const wrap = (size, draw) => [-size, 0, size].flatMap(dx => [-size, 0, size].map(dy => `<g transform="translate(${dx} ${dy})">${draw}</g>`)).join('')
const solid = (size, color) => `<rect width="${size}" height="${size}" fill="${color}"/>`

function grass() {
  const size = 1024
  let body = solid(size, '#71865A')
  for (let i = 0; i < 82; i++) {
    const x = rand() * size, y = rand() * size, r = 8 + rand() * 32
    let tuft = ellipse(f(x), f(y), f(r * 1.7), f(r * .7), i % 3 ? '#829563' : '#596F4C', 'none', 0, .2)
    for (let j = 0; j < 5 + i % 6; j++) {
      const tx = x + (rand() - .5) * r * 3, ty = y + (rand() - .5) * r, length = 6 + rand() * 13
      tuft += path(`M${f(tx)} ${f(ty)}q${f(-2 - rand() * 3)} ${f(-length * .55)} ${f(-1 - rand() * 4)} ${f(-length)}m${f(2 + rand() * 3)} ${f(length - 2)}q2 -${f(length * .6)} 5 -${f(length * .86)}`, i % 4 ? '#A6AD72' : '#4D6948', 1.6, 'none', .48)
    }
    body += wrap(size, tuft)
  }
  for (let i = 0; i < 130; i++) {
    const x = rand() * size, y = rand() * size
    body += wrap(size, path(`M${f(x)} ${f(y)}q3 -2 6 -1`, '#C0BD89', 1.5, 'none', .18))
  }
  return svg(size, size, body)
}
function rock(cliff = false) {
  const size = 512, base = cliff ? '#525E55' : '#777D72'
  let body = solid(size, base)
  for (let i = 0; i < 58; i++) {
    const x = rand() * size, y = rand() * size, length = 18 + rand() * 72, bend = (rand() - .5) * 30
    const mark = path(`M${f(x)} ${f(y)}l${f(length * .4)} ${f(-5 + bend)} ${f(length * .6)} ${f(4 - bend)}m-${f(length * .58)} ${f(-1 + bend)}l${f(length * .2)} ${f(8 + rand() * 8)}`, cliff ? '#374D43' : '#525F57', 1.6, 'none', .38)
      + path(`M${f(x + 2)} ${f(y - 3)}l${f(length * .4)} ${f(-5 + bend)}`, cliff ? '#819080' : '#B1B3A0', 1.45, 'none', .35)
    body += wrap(size, mark)
  }
  for (let i = 0; i < 78; i++) {
    const x = rand() * size, y = rand() * size
    body += wrap(size, ellipse(f(x), f(y), f(.7 + rand() * 1.4), f(.5 + rand()), i % 2 ? '#B4B7A4' : '#384F44', 'none', 0, .20))
  }
  return svg(size, size, body)
}
function sand() {
  const size = 1024
  let body = solid(size, '#C4B486')
  for (let i = 0; i < 380; i++) {
    const x = rand() * size, y = rand() * size
    body += wrap(size, ellipse(f(x), f(y), f(.7 + rand() * 1.7), f(.45 + rand()), i % 3 ? '#9C9673' : '#EEE0B3', 'none', 0, .32))
  }
  for (let i = 0; i < 28; i++) {
    const x = rand() * size, y = rand() * size, length = 24 + rand() * 55
    body += wrap(size, path(`M${f(x)} ${f(y)}q${f(length * .42)} -3 ${f(length)} 0`, '#E0CE9C', 1.8, 'none', .26))
  }
  return svg(size, size, body)
}
function water(deep = false) {
  const size = 1024
  let body = solid(size, deep ? '#345B73' : '#679A9B')
  for (let i = 0; i < 84; i++) {
    const x = rand() * size, y = rand() * size, length = 28 + rand() * 78
    const wave = path(`M${f(x)} ${f(y)}q${f(length * .24)} -5 ${f(length * .5)} -1t${f(length * .5)} 0`, deep ? '#7CA2A6' : '#B3CBC0', 1.65, 'none', deep ? .20 : .28)
      + (i % 3 ? '' : path(`M${f(x + 12)} ${f(y + 5)}q${f(length * .2)} -3 ${f(length * .42)} 0`, deep ? '#213E57' : '#3F7E83', 1.5, 'none', .2))
    body += wrap(size, wave)
  }
  return svg(size, size, body)
}

/** Smooth uneven contours, with no light-direction offset: lighting is drawn later by the theme. */
function contour(cx, cy, rx, ry, phase = 0, steps = 72, irregularity = .07) {
  const points = Array.from({ length: steps }, (_, index) => {
    const a = index / steps * Math.PI * 2, r = 1 + irregularity * Math.sin(7 * a + phase) + irregularity * .52 * Math.cos(13 * a - phase)
    return `${f(cx + Math.cos(a) * rx * r)},${f(cy + Math.sin(a) * ry * r)}`
  })
  return `M${points.join('L')}Z`
}
function tree(sparse = false) {
  let body = ''
  if (sparse) {
    body += path('M576 583l-42 -89 -60 -89 -68 -53m127 143l42 -111 65 -91m-65 93l79 -5 66 -53M577 586l-105 80 -87 30m108 -48l-15 112M578 583l74 91 101 40m-105 -46l25 96M579 580l85 -35 99 3', '#514F3B', 18, 'none')
    body += path('M576 582l-40 -86 -58 -87m101 168l71 88 96 37m-170 -124l80 -33 92 2', '#9B8E60', 7, 'none')
  } else body += path(contour(576, 576, 455, 445, .2), ink, 4.1, '#5D794D')
  const clusters = sparse
    ? [[386, 351, 138, 121], [576, 285, 145, 128], [764, 381, 159, 143], [840, 575, 138, 131], [744, 751, 146, 133], [522, 816, 138, 131], [339, 700, 147, 139], [282, 519, 133, 128], [579, 546, 164, 151]]
    : [[321, 427, 188, 179], [514, 281, 199, 173], [733, 320, 178, 166], [854, 504, 181, 182], [805, 723, 189, 185], [589, 848, 195, 165], [354, 767, 188, 176], [270, 594, 165, 160], [516, 496, 210, 191], [645, 654, 210, 190]]
  const greens = sparse ? ['#87935F', '#8D9965', '#7E905F', '#97A16B'] : ['#768C59', '#80965F', '#6C8653', '#91A168']
  for (const [index, [cx, cy, rx, ry]] of clusters.entries()) {
    body += path(contour(cx, cy, rx, ry, index * .8), '#4C6746', 3.2, greens[index % greens.length])
    body += path(contour(cx - 3, cy - 3, rx * .73, ry * .72, index + .5), 'none', 0, shade(greens[index % greens.length], 7), .55)
    for (let leaf = 0; leaf < 16; leaf++) {
      const a = rand() * Math.PI * 2, radius = .25 + rand() * .65, x = cx + Math.cos(a) * rx * radius, y = cy + Math.sin(a) * ry * radius
      body += path(`M${f(x - 8)} ${f(y + 3)}q${f(7 + rand() * 5)} -9 ${f(16 + rand() * 9)} -2m-10 6 7 -3`, leaf % 4 ? '#A9B279' : '#405F40', 2.2, 'none', leaf % 4 ? .60 : .40)
    }
    body += path(`M${cx - rx * .55} ${cy + ry * .55}q24 9 44 4m22 -1 13 -5`, '#3D5E40', 2.3, 'none', .38)
  }
  return svg(1152, 1152, body)
}
function shrub(dry = false) {
  let body = ''
  if (dry) body += path('M222 196l-80 -63m83 62l76 -81m-76 80l81 39m-82 -39l-45 75m46 -76l-5 -96', '#73694B', 4.1)
  const lobes = dry ? [[142, 156, 59, 47], [231, 117, 63, 43], [309, 169, 56, 45], [287, 237, 62, 48], [176, 250, 58, 44], [220, 192, 70, 55]] : [[123, 174, 63, 61], [182, 115, 67, 58], [267, 120, 69, 58], [329, 180, 65, 65], [288, 248, 67, 56], [194, 255, 72, 56], [220, 186, 85, 73]]
  for (const [index, [cx, cy, rx, ry]] of lobes.entries()) {
    const color = dry ? ['#A49D72', '#B2AA7A', '#99966C'][index % 3] : ['#758A57', '#899765', '#91A06C'][index % 3]
    body += path(contour(cx, cy, rx, ry, index, 48, .1), dry ? '#796F4B' : '#4F6946', 2.5, color)
    for (let leaf = 0; leaf < 8; leaf++) {
      const x = cx + (rand() - .5) * rx * 1.4, y = cy + (rand() - .5) * ry * 1.4
      body += path(dry ? `M${f(x - 4)} ${f(y + 6)}l8 -13 4 5` : `M${f(x - 5)} ${f(y + 3)}q5 -8 11 -2q-4 7 -11 2Z`, dry ? '#DED0A0' : '#B4BD85', 1.5, 'none', .72)
    }
  }
  return svg(448, 384, body)
}
function stoneCluster(worn = false, reef = false) {
  const stones = reef
    ? [[301, 261, 164, 128, .4], [159, 226, 95, 83, 2.1], [450, 299, 112, 83, 3.4], [400, 166, 96, 71, 1.5]]
    : [[155, 142, 80, 63, .4], [92, 112, 45, 40, 1.1], [233, 157, 35, 29, 2.4], [205, 80, 31, 23, 3]]
  let body = ''
  for (const [index, [cx, cy, rx, ry, phase]] of stones.entries()) {
    const color = worn ? ['#AAA28B', '#B7AE92', '#9B9984'][index % 3] : ['#8A9182', '#9DA18E', '#7E887C'][index % 3]
    body += path(contour(cx, cy, rx, ry, phase, 9, .10), '#46574D', reef ? 3.1 : 2.05, color)
    body += path(`M${f(cx - rx * .77)} ${cy}l${f(rx * .42)} ${f(-ry * .57)} ${f(rx * .77)} ${f(-ry * .12)}m${f(-rx * .76)} ${f(ry * .13)}l${f(rx * .2)} ${f(ry * .58)} ${f(rx * .69)} ${f(ry * .16)}`, worn ? '#D6CAAB' : '#C5C8B1', reef ? 3 : 1.8, 'none', .66)
    body += path(`M${f(cx - rx * .18)} ${f(cy + ry * .7)}l${f(rx * .15)} ${f(-ry * .65)} ${f(rx * .42)} ${f(-ry * .45)}`, '#53665A', reef ? 2.3 : 1.6, 'none', .42)
    if (worn) body += path(`M${f(cx - rx * .5)} ${f(cy + ry * .1)}q10 -3 20 1m3 5 8 -2`, '#6C7866', 1.7, 'none', .43)
  }
  return svg(reef ? 640 : 320, reef ? 512 : 256, body)
}

const material = (key, name, sizeMm, pixels, baseColor, art) => ({ key, catalogId: `material.sw.${key}`, kind: 'material', name, width: pixels, height: pixels,
  logicalSizeMm: { width: sizeMm, height: sizeMm }, baseColor, surfaces: key === 'cliff-rock' ? ['terrain'] : ['terrain', 'path'], art })
const prop = (key, name, width, height, span, bounds, foot, blocking, shadow, art) => ({ key, catalogId: `prop.sw.${key}`, kind: 'prop', name, width, height,
  spanMm: { width: span[0], height: span[1] }, logicalSizeMm: { width: bounds[2], height: bounds[3] },
  visualBoundsMm: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }, footprintMm: { width: foot[0], height: foot[1] }, footprintOffsetMm: { x: 0, y: 0 },
  blocksMovement: blocking, blocksSight: false, renderLayer: key.startsWith('tree-') ? 'canopy' : 'object', shadowClass: shadow, art })
const artworks = [
  material('grass', '簇生草地', 4000, 1024, '#71865A', grass()),
  material('rock', '灰绿裸岩', 2000, 512, '#777D72', rock()),
  material('cliff-rock', '墨绿崖侧岩', 2000, 512, '#525E55', rock(true)),
  material('sand', '细砂岸地', 4000, 1024, '#C4B486', sand()),
  material('water-shallow', '浅青海水', 4000, 1024, '#679A9B', water()),
  material('water-deep', '深蓝海面', 4000, 1024, '#345B73', water(true)),
  prop('tree-broadleaf', '阔叶树冠', 1152, 1152, [4000, 4000], [-2250, -2250, 4500, 4500], [600, 600], true, 'vegetation', tree()),
  prop('tree-sparse', '疏叶树冠', 1152, 1152, [4000, 4000], [-2250, -2250, 4500, 4500], [600, 600], true, 'vegetation', tree(true)),
  prop('shrub-round', '圆叶灌丛', 448, 384, [1400, 1200], [-875, -750, 1750, 1500], [600, 500], false, 'vegetation', shrub()),
  prop('shrub-dry', '枯叶灌丛', 448, 384, [1400, 1200], [-875, -750, 1750, 1500], [600, 500], false, 'vegetation', shrub(true)),
  prop('rock-small', '灰绿碎石簇', 320, 256, [900, 650], [-625, -500, 1250, 1000], [800, 600], false, 'furniture', stoneCluster()),
  prop('rock-small-worn', '风化碎石簇', 320, 256, [900, 650], [-625, -500, 1250, 1000], [800, 600], false, 'furniture', stoneCluster(true)),
  prop('reef-decoration', '近岸裸礁装饰', 640, 512, [2200, 1600], [-1250, -1000, 2500, 2000], [1800, 1200], false, 'furniture', stoneCluster(false, true)),
]
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (name, data) => {
  const type = Buffer.from(name), output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length, 0); type.copy(output, 4); data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8); return output
}
function encodePng(width, height, rgba) {
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const manifest = { catalogId: 'sceneweave-handdrawn-outdoor', themeCatalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野 · 室外', status: 'P2',
  author: 'Sceneweave contributors; original SVG artwork authored with Codex assistance', source: 'tools/build-island-art.mjs and assets/sceneweave-handdrawn-outdoor/*.svg',
  rights: 'Project original artwork; no external reference tracing or extracted image components', licenseRef: 'MIT', licenseFile: 'LICENSE.txt', densityPxPerMetre: 256,
  longCastShadowBaked: false, colorSpace: 'sRGB', bitDepth: 8, alpha: 'straight; zero-alpha RGB cleared', assets: [] }
try {
  for (const artwork of artworks) {
    await writeFile(new URL(`${artwork.key}.svg`, sourceRoot), artwork.art)
    const pixels = await page.evaluate(async ({ source, width, height }) => {
      const image = new Image(), url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }))
      try {
        image.src = url; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }); if (!ctx) throw new Error('No sRGB Canvas')
        ctx.drawImage(image, 0, 0)
        return Array.from(ctx.getImageData(0, 0, width, height).data)
      } finally { URL.revokeObjectURL(url) }
    }, { source: artwork.art, width: artwork.width, height: artwork.height })
    let minX = artwork.width, minY = artwork.height, maxX = -1, maxY = -1, opaque = true
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) pixels[i] = pixels[i + 1] = pixels[i + 2] = 0
      else { const x = (i / 4) % artwork.width, y = Math.floor(i / 4 / artwork.width); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
      if (pixels[i + 3] !== 255) opaque = false
    }
    const padding = Math.min(minX, minY, artwork.width - 1 - maxX, artwork.height - 1 - maxY)
    if (artwork.kind === 'prop' && padding < 8) throw new Error(`${artwork.key} alpha padding ${padding} < 8`)
    if (artwork.kind === 'material' && !opaque) throw new Error(`${artwork.key} not fully opaque`)
    const bytes = encodePng(artwork.width, artwork.height, Uint8Array.from(pixels))
    await writeFile(new URL(`${artwork.key}.png`, publicRoot), bytes)
    const { art: _art, width, height, ...metadata } = artwork
    manifest.assets.push({ ...metadata, file: `${artwork.key}.png`, sourceFile: `${artwork.key}.svg`, pixelWidth: width, pixelHeight: height,
      sha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: createHash('sha256').update(artwork.art).digest('hex'), sizeBytes: bytes.length,
      alphaContentBoundsPx: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, minTransparentPaddingPx: artwork.kind === 'prop' ? padding : null, fullyOpaque: opaque })
  }
  const license = await readFile(new URL('LICENSE', root), 'utf8')
  await writeFile(new URL('LICENSE.txt', sourceRoot), license); await writeFile(new URL('LICENSE.txt', publicRoot), license)
  await writeFile(new URL('manifest.json', sourceRoot), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(new URL('manifest.json', publicRoot), JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`Wrote ${manifest.assets.length} original outdoor SVG/PNG assets with verified alpha bounds.\n`)
} finally { await browser.close() }
