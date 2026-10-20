/**
 * Original Sceneweave pen-and-ink artwork, authored as SVG below with Codex assistance.
 * No external pictures, fonts, traced reference contours, AI image endpoint, or baked cast shadows.
 * Run: node tools/build-study-art.mjs (uses installed desktop Chrome through Playwright).
 * SVG is the editable source. The raster encoder writes only IHDR/sRGB/IDAT/IEND.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const root = new URL('../', import.meta.url)
const sourceRoot = new URL('assets/sceneweave-handdrawn/', root)
const publicRoot = new URL('public/assets/sceneweave-handdrawn/', root)
await mkdir(sourceRoot, { recursive: true }); await mkdir(publicRoot, { recursive: true })
const ink = '#3E3C32', fine = 2.048, line = 4.096
const path = (d, stroke = ink, width = fine, fill = 'none', extra = '') => `<path d="${d}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`
const rect = (x, y, w, h, fill, stroke = ink, width = line, radius = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
const circle = (x, y, r, fill, stroke = ink, width = fine) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
const ellipse = (x, y, rx, ry, fill, stroke = ink, width = fine) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`
const rgb = color => [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16))
const shade = (color, amount) => `#${rgb(color).map(v => Math.min(255, Math.max(0, v + amount)).toString(16).padStart(2, '0')).join('')}`
let randomState = 987654321
const rand = () => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 4294967296 }

function wood(worn = false) {
  let body = rect(0, 0, 512, 512, worn ? '#89715A' : '#72533D', 'none', 0)
  for (let col = 0; col < 8; col++) {
    const x = col * 64, phase = col % 2 ? 128 : 0
    body += rect(x + 1.3, 0, 61.4, 512, shade(worn ? '#89715A' : '#72533D', [-2, 5, -5, 1, 7, -3, 3, -6][col]), 'none', 0)
    for (let joint = phase - 256; joint <= 512; joint += 256) {
      body += path(`M${x + 1} ${joint}H${x + 63}`, worn ? '#544B3D' : '#493B2E', 2.3)
      for (const nailX of [x + 7, x + 57]) for (const nailY of [joint - 7, joint + 7]) body += circle(nailX, nailY, 1.15, '#493F32', 'none', 0)
    }
    for (let grain = 0; grain < 7; grain++) {
      const gx = x + 6 + grain * 8, amplitude = 1.2 + ((col + grain) % 3) * .6
      let d = `M${gx} -8`
      for (let y = -8; y <= 520; y += 16) d += `L${(gx + Math.sin((y / 512 * Math.PI * 4) + grain) * amplitude).toFixed(2)} ${y}`
      body += path(d, grain % 3 ? '#E2C79C' : '#332D23', 1.25, 'none', `opacity="${grain % 3 ? .10 : .14}"`)
    }
    body += path(`M${x} 0V512`, '#403A2D', 2.05, 'none', 'opacity=".68"')
    body += path(`M${x + 2.5} 0V512`, '#D8B886', 1.15, 'none', 'opacity=".19"')
    if (worn) for (let i = 0; i < 6; i++) {
      const wx = x + 8 + ((i * 17 + col * 9) % 45), wy = (i * 79 + col * 41) % 450
      body += path(`M${wx} ${wy}q-2 18 1 35m0 9q1 5 0 13`, '#C7B18D', 2.2, 'none', 'opacity=".29"')
    }
  }
  // Equal opposite-edge seam halves make the 2 m unit repeat without a bright strip.
  body += path('M512 0V512', '#403A2D', 2.05, 'none', 'opacity=".68"')
  return svg(512, 512, body)
}
function pavers() {
  let body = rect(0, 0, 512, 512, '#77796C', 'none', 0)
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = col * 128, y = row * 128
    body += rect(x + 1.536, y + 1.536, 124.928, 124.928, shade('#AAA99B', [4, -3, 6, -6, 0][(row * 3 + col) % 5]), 'none', 0)
    body += path(`M${x + 9} ${y + 17}q38 -4 65 0m21 4 0 45M${x + 16} ${y + 114}q38 3 83 -1`, '#D2CAB3', 2, 'none', 'opacity=".35"')
    for (let grain = 0; grain < 5; grain++) {
      const gx = x + 18 + ((grain * 29 + row * 13) % 94), gy = y + 22 + ((grain * 19 + col * 23) % 86)
      body += path(`M${gx} ${gy}l${6 + grain % 3 * 3} ${grain % 2 ? 1 : -1}`, '#72786C', 1.6, 'none', 'opacity=".26"')
    }
  }
  return svg(512, 512, body)
}
function wallStone() {
  let body = rect(0, 0, 512, 512, '#C8BEA8', 'none', 0)
  // Restrained mineral wisps; no black mortared grid that could split a 200 mm wall.
  for (let i = 0; i < 125; i++) {
    const x = rand() * 512, y = rand() * 512, width = 5 + rand() * 20
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) body += path(`M${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}q${(width / 2).toFixed(2)} -2 ${width.toFixed(2)} 1`, i % 3 ? '#9D9E8D' : '#E4DCC7', 1.7, 'none', 'opacity=".32"')
  }
  return svg(512, 512, body)
}
function desk() {
  let body = path('M34 26H478L486 34V222L478 230H34L26 222V34Z', ink, line, '#7F5D40')
  body += path('M42 36H470L476 42V214L470 220H42L36 214V42Z', '#5C4834', fine, '#A47D54')
  for (const y of [97, 159]) body += path(`M37 ${y}H475`, '#71543A', 2.1)
  for (let i = 0; i < 15; i++) {
    const y = 44 + i * 11.5
    body += path(`M45 ${y}C122 ${y + (i % 2 ? 3 : -4)} 161 ${y - 2} 226 ${y}S377 ${y + 4} 467 ${y - 1}`, '#533F2C', 1.4, 'none', 'opacity=".25"')
  }
  for (const x of [46, 466]) for (const y of [46, 210]) body += circle(x, y, 3.2, '#5C4632', 'none', 0)
  body += path('M66 43H145M363 212H442', '#C7A675', 2, 'none', 'opacity=".65"')
  body += ellipse(390, 127, 18, 6, 'none', '#735338', 1.8) + path('M382 127q8 -4 16 0', '#735338', 1.4)
  return svg(512, 256, body)
}
function chair(worn = false) {
  let body = rect(52, 65, 152, 146, '#8E6A48', ink, line, 12)
  body += rect(65, 88, 126, 109, worn ? '#8A8A68' : '#899476', '#544F3E', fine, 15)
  body += path('M74 105q54 -7 108 0M75 180q52 5 106 0', '#D2C7A2', 1.7, 'none', 'opacity=".65"')
  body += rect(40, 40, 176, 39, worn ? '#A48860' : '#A47D54', ink, line, 8)
  body += path('M52 51q76 4 151 0M61 61q68 4 131 0', '#634F36', fine)
  body += path('M45 91q-2 43 8 79h14V92ZM211 91q2 43 -8 79h-14V92Z', ink, line, '#A47D54')
  for (const x of [58, 198]) body += circle(x, 53, 2, '#D7BD8E', '#70553A', 1)
  if (worn) {
    body += path('M87 135l10 9 -9 10 8 7M143 100l5 7 -8 11', '#585E49', 2)
    body += path('M48 47l17 -1M60 69l19 -1M193 55l12 -1M76 188l11 2M187 179l-5 10', '#D1BD8E', 3, 'none', 'opacity=".75"')
  }
  return svg(256, 256, body)
}
function books() {
  let body = rect(21, 43, 84, 50, '#8B6251', ink, line, 2)
  body += rect(25, 40, 77, 6, '#D3C5A6', '#786E55', 1.6)
  body += rect(26, 32, 80, 52, '#667465', ink, line, 2)
  body += path('M35 36V79M43 39H96V75H43Z', '#B5B38C', 1.5)
  body += rect(24, 24, 82, 47, '#A17F52', ink, line, 2)
  body += rect(30, 26, 6, 43, '#776047', 'none', 0)
  body += rect(44, 33, 52, 29, 'none', '#D7C39B', 1.6)
  body += path('M49 47H91M60 41H80M62 53H78', '#6E5F43', 1.4)
  return svg(128, 128, body)
}
function papers() {
  let body = path('M41 35L139 29 151 98 53 104Z', ink, fine, '#C9BFA1')
  body += path('M47 25H144V93H47Z', ink, fine, '#DDD2B1')
  body += path('M47 25H144V93H47Z', '#6F6B55', 1)
  body += path('M59 38H130M59 46H132M60 54H117M59 64H128M61 72H113M60 80H126', '#817B61', 1.65, 'none', 'opacity=".72"')
  body += path('M117 80q6 -3 11 -1', '#5C5B49', 1.4)
  return svg(192, 128, body)
}
function shelf() {
  let body = rect(40, 53, 176, 534, '#72533D', ink, line, 3)
  body += rect(50, 63, 156, 514, '#9A7952', '#524535', fine, 1)
  const colors = ['#817454', '#906854', '#5D7064', '#B09B6B', '#707A71', '#99734F']
  // Parallel top-down: book depths run across x, their narrow spines face +x.
  // This is a long 700 × 2100 mm rack, rather than a front-view upright cabinet.
  for (let row = 0; row < 5; row++) {
    const y = 75 + row * 100
    body += rect(55, y + 78, 146, 9, '#BC9362', '#514734', fine, 0)
    let by = y
    for (let b = 0; b < 6; b++) {
      const height = [9, 10, 12, 9, 11, 10][b], width = 112 + (b * 7 + row * 9) % 22, color = colors[(row + b) % colors.length]
      body += rect(64, by, width, height, color, '#494735', 1.7, 1)
      body += rect(68, by + 2, width - 17, height - 4, '#CFC4A6', '#9D9578', .65, 0)
      body += rect(64 + width - 12, by + .6, 11, height - 1.2, color, '#494735', 1.1, .5)
      body += path(`M${65 + width - 7} ${by + 2}v${height - 4}`, '#C8B382', 1.1)
      by += height + 2
    }
  }
  for (const x of [44, 212]) body += path(`M${x} 75V561`, '#D5B786', 1.6, 'none', 'opacity=".45"')
  return svg(256, 640, body)
}
function rug() {
  let body = rect(81, 66, 606, 444, '#7E574A', ink, line, 4)
  body += rect(94, 78, 580, 420, '#9A7761', '#C4AD86', 3, 1)
  body += rect(115, 99, 538, 378, '#8E6E59', '#5B5748', 3, 1)
  body += rect(137, 121, 494, 334, '#A58C70', '#C7B48C', 4, 1)
  for (let i = 0; i < 18; i++) {
    const x = 128 + i * 30
    body += path(`M${x} 110l9 -9 9 9 -9 9Z M${x} 467l9 -9 9 9 -9 9Z`, '#CDBB95', 1.4, '#7B5C4D')
  }
  for (let i = 0; i < 9; i++) {
    const y = 146 + i * 33
    body += path(`M126 ${y}l-8 9 8 9 8 -9ZM642 ${y}l-8 9 8 9 8 -9Z`, '#CDBB95', 1.4, '#7B5C4D')
  }
  body += path('M384 164L506 288 384 412 262 288Z', '#695E4C', 4, '#8B6654')
  body += path('M384 193L478 288 384 383 290 288Z', '#D0BD96', 3, '#A18A6D')
  body += path('M384 236l51 52 -51 52 -51 -52Z', '#745D4B', 3, '#946755')
  for (let y = 137; y < 450; y += 9) body += path(`M146 ${y}H622`, '#DDD2B1', .8, 'none', 'opacity=".065"')
  for (let x = 89; x <= 681; x += 9) body += path(`M${x} 54v12M${x} 510v12`, '#BBA584', 2.1)
  return svg(768, 576, body)
}
function roundTable() {
  let body = circle(128, 128, 89.6, '#785A3F', ink, line)
  body += circle(128, 128, 80, '#B18B5F', '#5B4935', fine)
  for (const x of [90, 128, 166]) {
    const dy = Math.sqrt(78 ** 2 - (x - 128) ** 2)
    body += path(`M${x} ${128 - dy}V${128 + dy}`, '#786043', 2)
  }
  for (let y = 72; y <= 184; y += 17) {
    const dx = Math.sqrt(74 ** 2 - (y - 128) ** 2)
    body += path(`M${128 - dx} ${y}q${dx} 3 ${dx * 2} 0`, '#5E5037', 1.3, 'none', 'opacity=".3"')
  }
  for (const [x, y] of [[128, 51], [51, 128], [128, 205], [205, 128]]) body += circle(x, y, 2, '#D4BB8B', '#685238', 1)
  return svg(256, 256, body)
}
function flowerpot() {
  let body = circle(128, 128, 63, '#B77F5C', ink, line)
  body += circle(128, 128, 52, '#6E6446', '#D0A476', 4)
  body += circle(128, 128, 44, '#554D35', '#655940', fine)
  for (let i = 0; i < 10; i++) {
    const angle = i * 36 + (i % 2 ? 8 : -8), length = i % 3 ? 86 : 98
    body += `<g transform="translate(128 128) rotate(${angle})">${path(`M0 0Q-26 -24 -10 -${length}Q27 -${length - 24} 0 0Z`, ink, 2.8, i % 2 ? '#77865C' : '#8E9A6A')}${path(`M0 -6Q-4 -38 -10 -${length - 8}`, '#506242', 1.7)}</g>`
  }
  body += circle(128, 127, 11, '#6C7954', '#495C3E', fine)
  return svg(256, 256, body)
}
function lamp() {
  let body = circle(64, 64, 34, '#A68C55', ink, line)
  body += circle(64, 64, 27, '#C0A76D', '#756846', fine)
  body += path('M44 64q20 -13 40 0M49 52q15 -8 30 0M48 76q16 7 32 0', '#817045', 1.6)
  body += circle(64, 64, 9, '#D1BF85', '#6C6141', fine)
  body += path('M61 56l-8 -20 9 -5 9 22', ink, fine, '#A78C57')
  return svg(128, 128, body)
}
function envelope() {
  let body = rect(25.6, 38.4, 76.8, 51.2, '#DDD2B1', ink, fine, 1)
  body += path('M27 40l37 30 37 -30M27 88l25 -23M101 88L77 65', '#8D8266', 1.8)
  body += circle(64, 69, 6.5, '#946755', '#775446', 1.1)
  body += path('M61 68l3 -2 3 3 -3 3Z', '#C8A782', 1.2)
  return svg(128, 128, body)
}

const material = (key, name, art, surfaces) => ({ key, catalogId: `material.sw.${key}`, kind: 'material', name, width: 512, height: 512, logicalSizeMm: { width: 2000, height: 2000 }, surfaces, art })
const prop = (key, name, width, height, bounds, foot, blocks, shadow, art) => ({ key, catalogId: `prop.sw.${key}`, kind: 'prop', name, width, height,
  logicalSizeMm: { width: bounds[2], height: bounds[3] }, visualBoundsMm: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] },
  footprintMm: { width: foot[0], height: foot[1] }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: blocks, blocksSight: false,
  renderLayer: key === 'rug-study' ? 'ground' : 'object', shadowClass: shadow, art })
const artworks = [
  material('wood-dark', '深色木板', wood(), ['room']), material('wood-worn', '磨损木板', wood(true), ['room']),
  material('stone-paver', '露台石板', pavers(), ['room', 'terrain', 'path']), material('wall-stone', '浅灰墙石', wallStone(), ['wall']),
  prop('desk-oak', '深橡木书桌', 512, 256, [-1000, -500, 2000, 1000], [1800, 800], true, 'furniture', desk()),
  prop('chair-oak', '橡木座椅', 256, 256, [-500, -500, 1000, 1000], [600, 600], true, 'furniture', chair()),
  prop('chair-worn', '磨损座椅', 256, 256, [-500, -500, 1000, 1000], [600, 600], true, 'furniture', chair(true)),
  prop('book-stack', '三本叠书', 128, 128, [-250, -250, 500, 500], [350, 250], false, 'none', books()),
  prop('papers', '手稿纸张组', 192, 128, [-375, -250, 750, 500], [450, 300], false, 'none', papers()),
  prop('bookshelf', '橡木书架', 256, 640, [-500, -1250, 1000, 2500], [600, 2000], true, 'furniture', shelf()),
  prop('rug-study', '暖灰红纹书房毯', 768, 576, [-1500, -1125, 3000, 2250], [2400, 1800], false, 'none', rug()),
  prop('table-round', '露台圆桌', 256, 256, [-500, -500, 1000, 1000], [700, 700], true, 'furniture', roundTable()),
  prop('flowerpot', '陶盆与叶簇', 256, 256, [-500, -500, 1000, 1000], [500, 500], true, 'furniture', flowerpot()),
  prop('lamp-table', '铜色桌灯', 128, 128, [-250, -250, 500, 500], [200, 200], false, 'none', lamp()),
  prop('envelope', '封蜡空白信封', 128, 128, [-250, -250, 500, 500], [300, 200], false, 'none', envelope()),
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
const manifest = { catalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野', status: 'P2',
  author: 'Sceneweave contributors; original SVG artwork authored with Codex assistance',
  source: 'tools/build-study-art.mjs and assets/sceneweave-handdrawn/*.svg',
  rights: 'Project original artwork; no external reference tracing or extracted image components',
  licenseRef: 'MIT', licenseFile: 'LICENSE.txt', densityPxPerMetre: 256, longCastShadowBaked: false,
  colorSpace: 'sRGB', bitDepth: 8, alpha: 'straight; zero-alpha RGB cleared', assets: [] }
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
      sha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: createHash('sha256').update(artwork.art).digest('hex'), sizeBytes: bytes.length, alphaContentBoundsPx: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      minTransparentPaddingPx: artwork.kind === 'prop' ? padding : null, fullyOpaque: opaque })
  }
  const license = await readFile(new URL('LICENSE', root), 'utf8')
  await writeFile(new URL('LICENSE.txt', sourceRoot), license); await writeFile(new URL('LICENSE.txt', publicRoot), license)
  await writeFile(new URL('manifest.json', sourceRoot), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(new URL('manifest.json', publicRoot), JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`Wrote ${manifest.assets.length} original SVG/PNG assets and checked alpha/pixel provenance.\n`)
} finally { await browser.close() }
