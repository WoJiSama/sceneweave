/**
 * Original Sceneweave top-down ink-and-colour artwork for the coastal outpost.
 * Editable SVG sources use no external pictures, fonts, traced contours or image service.
 * Run: node tools/build-outpost-art.mjs [--preview]
 * Chrome renders SVG to sRGB RGBA; the encoder retains only IHDR/sRGB/IDAT/IEND.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const root = new URL('../', import.meta.url)
const sourceRoot = new URL('assets/sceneweave-handdrawn-outpost/', root)
const publicRoot = new URL('public/assets/sceneweave-handdrawn-outpost/', root)
await mkdir(sourceRoot, { recursive: true })
await mkdir(publicRoot, { recursive: true })

const ink = '#3E3C32', line = 4.096, fine = 2.048
const f = value => Number(value.toFixed(2))
const path = (d, stroke = ink, width = fine, fill = 'none', opacity = 1) => `<path d="${d}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
const rect = (x, y, width, height, fill, stroke = ink, weight = line, radius = 0) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${weight}"/>`
const ellipse = (x, y, rx, ry, fill, stroke = ink, weight = fine, opacity = 1) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${weight}" opacity="${opacity}"/>`
const circle = (x, y, radius, fill, stroke = ink, weight = fine) => ellipse(x, y, radius, radius, fill, stroke, weight)
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`
let randomState = 0x4f555450
const rand = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 }
const wrap = (size, body) => [-size, 0, size].flatMap(x => [-size, 0, size].map(y => `<g transform="translate(${x} ${y})">${body}</g>`)).join('')
const shade = (color, amount) => `#${[1, 3, 5].map(start => Math.max(0, Math.min(255, parseInt(color.slice(start, start + 2), 16) + amount)).toString(16).padStart(2, '0')).join('')}`

function dirtGravel() {
  const size = 512
  let body = rect(0, 0, size, size, '#9B8B68', 'none', 0)
  // Wrapped low-contrast deposits have no directional light, tracks or implied barriers.
  for (let i = 0; i < 34; i++) {
    const x = rand() * size, y = rand() * size, rx = 10 + rand() * 25, ry = 5 + rand() * 14
    body += wrap(size, ellipse(f(x), f(y), f(rx), f(ry), i % 3 ? '#C1AB7F' : '#766E52', 'none', 0, .12))
  }
  for (let i = 0; i < 136; i++) {
    const x = rand() * size, y = rand() * size, rx = 2.1 + rand() * 4.8, ry = 1.8 + rand() * 3.3, angle = rand() * 360
    const pebble = path(`M${f(-rx)} 0L${f(-rx * .51)} ${f(-ry)} ${f(rx * .6)} ${f(-ry * .76)} ${f(rx)} ${f(ry * .24)} ${f(rx * .18)} ${f(ry)} ${f(-rx * .76)} ${f(ry * .67)}Z`, '#786F55', 1.5, ['#B4AD8B', '#A5A181', '#C1B48F', '#928F73'][i % 4], .65)
      + path(`M${f(-rx * .58)} ${f(-ry * .23)}l${f(rx * .65)} ${f(-ry * .23)}`, '#D5C49C', 1.5, 'none', .48)
    body += wrap(size, `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})">${pebble}</g>`)
  }
  for (let i = 0; i < 160; i++) {
    const x = rand() * size, y = rand() * size
    body += wrap(size, path(`M${f(x)} ${f(y)}l${f(1.4 + rand() * 2)} ${f((rand() - .5) * 2)}`, i % 3 ? '#D3BE92' : '#6E684F', 1.6, 'none', .24))
  }
  return svg(size, size, body)
}

function crate() {
  let body = rect(40.448, 40.448, 239.104, 239.104, '#806247', ink, line, 4)
  body += rect(48, 48, 224, 224, '#AD8A5A', '#6D553C', fine, 2)
  for (let i = 0; i < 5; i++) {
    const y = 49 + i * 44.6
    body += rect(49, f(y), 222, 43.1, ['#A88458', '#B49161', '#A47D54', '#AC895B', '#AE8A5C'][i], 'none', 0)
    if (i) body += path(`M50 ${f(y)}H270`, '#66523B', fine)
    for (let grain = 0; grain < 3; grain++) {
      const gy = y + 10 + grain * 10
      body += path(`M56 ${f(gy)}q35 -3 69 0t68 0m13 0 52 -1`, '#6C543B', fine, 'none', .3)
    }
  }
  body += rect(68, 43, 19, 234, '#655C48', ink, fine, 1)
  body += rect(233, 43, 19, 234, '#655C48', ink, fine, 1)
  body += rect(43, 151, 234, 18, '#73654B', ink, fine, 1)
  for (const x of [72, 81, 237, 246]) body += path(`M${x} 49v95m0 33v94`, '#AD9F75', fine, 'none', .55)
  for (const x of [77.5, 242.5]) for (const y of [58, 137, 184, 262]) body += circle(x, y, 2.5, '#B6A579', '#4A493B', fine)
  body += rect(145, 148, 30, 24, '#B6A16E', '#514F3E', fine, 2)
  body += path('M151 153h17v14h-17Z', '#6C644A', fine)
  body += path('M101 67l19 -1M200 254l20 2M52 220v15M269 80v19', '#D4BC87', fine, 'none', .5)
  return svg(320, 320, body)
}

function supplyRack() {
  // The frame and cargo are seen from above. No vertical shelf facade or baked roof.
  let body = rect(57, 64, 270, 576, '#795E42', ink, line, 4)
  body += rect(72, 78, 240, 548, '#987C55', '#66533B', fine, 2)
  for (const x of [110, 154, 198, 242, 286]) body += path(`M${x} 82V621`, '#6C593E', fine, 'none', .65)
  for (let i = 0; i < 18; i++) {
    const y = 90 + i * 29
    body += path(`M82 ${y}q31 -3 62 0m57 0q40 3 78 0`, '#C0A476', fine, 'none', .28)
  }
  // Three open top bays: canvas sacks, a strapped supply box and bundled rolls.
  for (const [x, y, rotation] of [[136, 155, -7], [245, 166, 6]]) {
    let sack = path('M-44 -61Q-57 -32 -48 22L-38 52Q-6 65 32 50L47 24Q52 -9 42 -52L19 -60Q-8 -67 -44 -61Z', '#5B6046', fine, '#9FA27B')
    sack += path('M-34 -52q32 9 65 0M-36 40q31 -7 64 2M-33 -40q-8 38 1 68m59 -66q9 39 0 66', '#D0C7A0', fine, 'none', .65)
    sack += path('M-39 -58q33 -13 73 1m-49 -5 6 16 8 -17', '#716A4C', 3.2)
    body += `<g transform="translate(${x} ${y}) rotate(${rotation})">${sack}</g>`
  }
  body += rect(94, 286, 196, 125, '#A88657', '#4B4938', fine, 3)
  for (const y of [316, 347, 379]) body += path(`M98 ${y}H286`, '#71563A', fine)
  body += rect(137, 288, 12, 121, '#746A4D', '#494B3A', fine)
  body += rect(237, 288, 12, 121, '#746A4D', '#494B3A', fine)
  body += path('M101 298l19 -1m47 32q22 -3 42 1m-37 63 38 -1', '#D6B783', fine, 'none', .65)
  for (const [index, x] of [116, 169, 225, 275].entries()) {
    body += rect(x - 19, 475 + index % 2 * 10, 39, 108 - index % 2 * 11, index % 2 ? '#8B8F70' : '#B5A67E', '#555B43', fine, 16)
    body += ellipse(x + .5, 483 + index % 2 * 10, 16, 8, index % 2 ? '#B6B89B' : '#D0C29C', '#555B43', fine)
    body += path(`M${x - 9} ${496 + index % 2 * 10}v62`, '#DDD0A8', fine, 'none', .6)
  }
  body += path('M91 520q102 15 207 0M93 552q100 14 203 1', '#5D6047', 4.1)
  body += path('M91 518q102 15 207 0M93 550q100 14 203 1', '#C7B58C', fine)
  for (const y of [250, 446]) {
    body += rect(61, y, 262, 17, '#B19364', '#4F4C37', fine, 2)
    for (const x of [78, 306]) body += circle(x, y + 8.5, 2.6, '#D0BB8A', '#6B6146', fine)
  }
  for (const x of [53.248, 307.752]) for (const y of [59.648, 620.352]) {
    body += rect(x, y, 23, 23, '#B89B6D', ink, line, 2)
    body += path(`M${f(x + 5)} ${f(y + 5)}l13 13m-13 0 13 -13`, '#766044', fine)
  }
  return svg(384, 704, body)
}

function campfire() {
  let body = ellipse(224, 224, 132, 131, '#70694F', '#595B46', fine)
  body += ellipse(224, 224, 107, 103, '#56563F', 'none', 0)
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, x = 224 + Math.cos(angle) * 153, y = 224 + Math.sin(angle) * 153
    const stone = path('M-23 -11L-10 -23 14 -20 25 -5 21 14 1 23 -19 14Z', '#4F594A', 3.072, ['#A2A38B', '#969D87', '#B2AF94'][i % 3])
      + path('M-16 -9l13 -9 15 4m-23 20 13 9 13 -6', '#D3CCAC', fine, 'none', .6)
    body += `<g transform="translate(${f(x)} ${f(y)}) rotate(${i * 30 + 6})">${stone}</g>`
  }
  for (const [rotation, offset] of [[-39, -26], [-39, 30], [44, -27], [44, 31]]) {
    let log = rect(-93, offset - 13, 186, 26, '#7B5D3C', '#423F31', fine, 11)
    log += path(`M-74 ${offset - 5}q63 -3 143 0M-76 ${offset + 4}q63 3 147 -1`, '#B08E58', fine)
    log += ellipse(-82, offset, 6, 9, '#BDA16D', '#514A34', fine)
    log += path(`M-82 ${offset - 4}v8M-57 ${offset - 11}l6 20m93 -21 -5 21`, '#463F30', fine)
    body += `<g transform="translate(224 224) rotate(${rotation})">${log}</g>`
  }
  // Short clustered tongues are decorative pixels: no halo, radius or automatic light.
  body += path('M216 161Q221 189 243 179Q259 158 266 176Q261 192 278 207Q297 229 278 253Q267 279 239 270Q215 288 193 267Q166 260 172 235Q155 214 177 198Q195 194 196 174Q204 179 211 191Q216 179 216 161Z', '#8F573C', fine, '#B97543')
  body += path('M222 184Q225 208 241 204Q250 192 255 200Q248 216 263 228Q272 250 251 259Q234 272 221 259Q200 268 190 249Q181 233 197 219Q210 216 208 202Q216 209 220 214Q226 202 222 184Z', '#C5894B', fine, '#D5A15A')
  body += path('M220 216Q228 231 242 224Q235 238 246 246Q238 263 222 252Q205 257 204 242Q211 230 220 216Z', '#DDB36B', fine, '#E2C581')
  body += path('M132 234l9 3m167 -19 -8 5M171 304l7 -3m91 -5 6 3', '#C4B186', fine, 'none', .6)
  return svg(448, 448, body)
}

function lampStand() {
  let body = ''
  // Four short feet and the lantern cap are parallel top-down forms.
  for (const rotation of [0, 90, 180, 270]) {
    body += `<g transform="translate(128 128) rotate(${rotation})">${path('M-9 -21L-12 -65Q-14 -72 -6 -74H6Q14 -72 12 -65L9 -21Z', ink, line, '#77735A')}${path('M0 -31V-65', '#C1AD79', fine)}</g>`
  }
  body += circle(128, 128, 50, '#5F644F', ink, line)
  body += path('M128 78L164 92 178 128 164 164 128 178 92 164 78 128 92 92Z', ink, fine, '#A5915F')
  for (const rotation of [0, 90, 180, 270]) {
    body += `<g transform="translate(128 128) rotate(${rotation})">${path('M-22 -30L-12 -43 12 -43 22 -30 13 -21H-13Z', '#595E48', fine, '#C9B788')}${path('M-10 -35H10', '#E1D0A1', fine)}</g>`
  }
  body += circle(128, 128, 27, '#758069', '#444D3E', fine)
  body += circle(128, 128, 19, '#A39E73', '#505943', fine)
  body += path('M119 117l18 22m0 -22 -18 22', '#5E6249', fine)
  body += circle(128, 128, 5, '#BEB181', '#596049', fine)
  for (const [x, y] of [[96, 96], [160, 96], [160, 160], [96, 160]]) body += circle(x, y, 2.1, '#D3BE89', '#635F46', fine)
  body += path('M84 117l3 -9m82 31 3 -9M116 83l8 -2m9 92 9 -2', '#D1BD87', fine, 'none', .65)
  return svg(256, 256, body)
}

function tent() {
  let body = ''
  const ropes = [[128, 128, 63, 50], [704, 128, 769, 50], [108, 576, 63, 654], [724, 576, 769, 654], [118, 352, 61, 352], [714, 352, 771, 352]]
  for (const [x, y, tx, ty] of ropes) {
    body += path(`M${x} ${y}L${tx} ${ty}`, '#514D3A', 3.2)
    body += path(`M${x} ${y}L${tx} ${ty}`, '#BFAF7F', fine)
    body += path(`M${tx - 3} ${ty - 3}l6 6m-6 0 6 -6`, ink, line)
  }
  body += path('M128 128L416 108 704 128 724 576 416 596 108 576Z', ink, line, '#ADA57E')
  body += path('M128 128L416 108V596L108 576Z', '#6C7055', fine, '#B5AD87')
  body += path('M416 108L704 128 724 576 416 596Z', '#6C7055', fine, '#B3AB84')
  // The end flap points north. It is not an enterable room or a second floor.
  body += path('M309 116L416 87 523 116 479 146 416 117 353 146Z', ink, line, '#9D9C76')
  body += path('M383 111L416 92 449 111 416 134Z', '#5C6149', fine, '#757D60')
  body += path('M341 592L416 619 491 592 453 566 416 585 379 566Z', ink, line, '#A5A17C')
  body += path('M416 114V587', '#706E50', 4.1)
  body += path('M408 132V570m16 -438v438', '#D7CDA5', fine, 'none', .7)
  for (const [index, y] of [168, 254, 352, 450, 539].entries()) {
    body += path(`M${index % 2 ? 131 : 129} ${y}Q271 ${y + 10} 402 ${y - 8}M430 ${y - 8}Q560 ${y + 10} ${index % 2 ? 701 : 704} ${y}`, '#7E8262', fine, 'none', .6)
    body += path(`M${index % 2 ? 135 : 133} ${y + 6}Q269 ${y + 15} 398 ${y - 2}M434 ${y - 2}Q562 ${y + 15} ${index % 2 ? 697 : 700} ${y + 6}`, '#D7CBA3', fine, 'none', .6)
  }
  body += path('M144 144L127 563 394 581M438 581L705 563 688 144M146 145L393 126M439 126L686 145', '#666D50', fine)
  for (let i = 0; i < 8; i++) {
    const y = 177 + i * 46
    body += path(`M144 ${y}l8 1m536 -1 -8 1`, '#D9CAA1', fine)
  }
  body += path('M201 475l39 7 -7 35 -40 -8ZM568 223l37 -3 2 32 -37 4Z', '#7C8161', fine, '#C0B68F')
  body += path('M198 481l34 6m-35 16 33 7M573 228l28 -3m-27 24 28 -3', '#D7CAA1', fine)
  return svg(832, 704, body)
}

const prop = (key, name, width, height, span, bounds, foot, blocking, shadow, art) => ({ key, catalogId: `prop.sw.${key}`, kind: 'prop', name, width, height,
  spanMm: { width: span[0], height: span[1] }, logicalSizeMm: { width: bounds[2], height: bounds[3] },
  visualBoundsMm: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] }, footprintMm: { width: foot[0], height: foot[1] }, footprintOffsetMm: { x: 0, y: 0 },
  blocksMovement: blocking, blocksSight: false, renderLayer: 'object', shadowClass: shadow, art })
const artworks = [
  { key: 'dirt-gravel', catalogId: 'material.sw.dirt-gravel', kind: 'material', name: '院落土砾', width: 512, height: 512,
    logicalSizeMm: { width: 2000, height: 2000 }, baseColor: '#9B8B68', surfaces: ['terrain', 'path'], art: dirtGravel() },
  prop('crate', '绑带木箱', 320, 320, [950, 950], [-625, -625, 1250, 1250], [900, 900], true, 'furniture', crate()),
  prop('supply-rack', '敞口补给木架', 384, 704, [1100, 2300], [-750, -1375, 1500, 2750], [1000, 2200], true, 'furniture', supplyRack()),
  prop('campfire', '石圈短焰营火', 448, 448, [1400, 1400], [-875, -875, 1750, 1750], [1000, 1000], false, 'none', campfire()),
  prop('lamp-stand', '旧铜灯架', 256, 256, [600, 600], [-500, -500, 1000, 1000], [300, 300], true, 'furniture', lampStand()),
  prop('tent', '短绳帆布帐篷', 832, 704, [2800, 2400], [-1625, -1375, 3250, 2750], [2400, 2000], true, 'furniture', tent()),
]

const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (name, data) => {
  const type = Buffer.from(name), output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length, 0); type.copy(output, 4); data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8)
  return output
}
function encodePng(width, height, rgba) {
  const rows = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(rows, y * (width * 4 + 1) + 1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('sRGB', Buffer.from([0])), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const manifest = {
  catalogId: 'sceneweave-handdrawn-outpost', themeCatalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野 · 海岸哨所', status: 'P2',
  author: 'Sceneweave contributors; original SVG artwork authored with Codex assistance', source: 'tools/build-outpost-art.mjs and assets/sceneweave-handdrawn-outpost/*.svg',
  rights: 'Project original artwork; no external reference tracing or extracted image components', licenseRef: 'MIT', licenseFile: 'LICENSE.txt', densityPxPerMetre: 256,
  longCastShadowBaked: false, colorSpace: 'sRGB', bitDepth: 8, alpha: 'straight; zero-alpha RGB cleared', assets: [],
}
// Chrome's detached crash handler can retain Playwright's stderr pipe after close.
// This offline rasterizer needs no crash upload; keep normal browser/test flags elsewhere.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-crashpad-for-testing'] })
let context
try {
  process.stdout.write(`Rasterizer: Node ${process.version}; Chrome ${browser.version()}\n`)
  context = await browser.newContext()
  const page = await context.newPage()
  const previewImages = []
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
      else {
        const x = (i / 4) % artwork.width, y = Math.floor(i / 4 / artwork.width)
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      if (pixels[i + 3] !== 255) opaque = false
    }
    if (maxX < 0 || maxY < 0) throw new Error(`${artwork.key} is empty`)
    const padding = Math.min(minX, minY, artwork.width - 1 - maxX, artwork.height - 1 - maxY)
    if (artwork.kind === 'prop' && padding < 8) throw new Error(`${artwork.key} alpha padding ${padding} < 8`)
    if (artwork.kind === 'material' && !opaque) throw new Error(`${artwork.key} is not fully opaque`)
    const bytes = encodePng(artwork.width, artwork.height, Uint8Array.from(pixels))
    await writeFile(new URL(`${artwork.key}.png`, publicRoot), bytes)
    const { art: _art, width, height, ...metadata } = artwork
    manifest.assets.push({ ...metadata, file: `${artwork.key}.png`, sourceFile: `${artwork.key}.svg`, pixelWidth: width, pixelHeight: height,
      sha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: createHash('sha256').update(artwork.art).digest('hex'), sizeBytes: bytes.length,
      alphaContentBoundsPx: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, minTransparentPaddingPx: artwork.kind === 'prop' ? padding : null, fullyOpaque: opaque })
    previewImages.push({ key: artwork.key, name: artwork.name, width, height, png: bytes.toString('base64') })
  }
  const license = await readFile(new URL('LICENSE', root), 'utf8')
  await writeFile(new URL('LICENSE.txt', sourceRoot), license)
  await writeFile(new URL('LICENSE.txt', publicRoot), license)
  await writeFile(new URL('manifest.json', sourceRoot), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(new URL('manifest.json', publicRoot), JSON.stringify(manifest, null, 2) + '\n')
  if (process.argv.includes('--preview')) {
    const preview = await page.evaluate(async images => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1000
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }); if (!ctx) throw new Error('No sRGB Canvas')
      ctx.fillStyle = '#EEE8D6'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#3E3C32'; ctx.font = '22px sans-serif'; ctx.fillText('Sceneweave — original outpost P2 candidates', 28, 34)
      const decoded = await Promise.all(images.map(async item => { const image = new Image(); image.src = `data:image/png;base64,${item.png}`; await image.decode(); return { ...item, image } }))
      for (const [index, item] of decoded.entries()) {
        const x = 22 + index % 3 * 395, y = 53 + Math.floor(index / 3) * 365, scale = Math.min(342 / item.width, 300 / item.height, 1)
        ctx.fillStyle = '#E1DDCB'; ctx.fillRect(x, y, 370, 320)
        ctx.drawImage(item.image, x + (370 - item.width * scale) / 2, y + (320 - item.height * scale) / 2, item.width * scale, item.height * scale)
        ctx.fillStyle = '#3E3C32'; ctx.font = '16px sans-serif'; ctx.fillText(`${item.key} · ${item.width}×${item.height}`, x + 5, y + 343)
      }
      const tile = decoded[0].image
      for (const count of [2, 3]) {
        const cell = 64, x = count === 2 ? 25 : 220, y = 805
        for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) ctx.drawImage(tile, x + col * cell, y + row * cell, cell, cell)
        ctx.fillStyle = '#3E3C32'; ctx.font = '16px sans-serif'; ctx.fillText(`${count}×${count} dirt repeat`, x, y - 12)
      }
      return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    }, previewImages)
    const previewRoot = new URL('work/', root)
    await mkdir(previewRoot, { recursive: true })
    await writeFile(new URL('m1d-outpost-art-review.png', previewRoot), encodePng(1200, 1000, Uint8Array.from(preview)))
  }
  process.stdout.write(`Wrote ${manifest.assets.length} original outpost SVG/PNG assets with verified alpha bounds.\n`)
  process.stdout.write(`${JSON.stringify(manifest.assets.map(({ key, pixelWidth, pixelHeight, minTransparentPaddingPx, sizeBytes }) => ({ key, pixelWidth, pixelHeight, minTransparentPaddingPx, sizeBytes })), null, 2)}\n`)
} finally {
  await context?.close()
  await browser.close()
}
