import type { VisualSampleArt } from './sample-art.js'
import { freezeJson } from '../validation/json.js'

/** Original editable vector candidates, not photographs or a P3 approval.
 * Every source is in the existing static SVG subset and has no embedded media,
 * external references, lettering, cast shadow or implied structural behaviour. */
export type ThemePackArtId = 'investigation' | 'modern' | 'fantasy' | 'ruins' | 'wilderness' | 'coast'
interface Palette { ink: string; dark: string; base: string; light: string; accent: string; metal: string; cloth: string }
const palettes: Record<ThemePackArtId, Palette> = {
  investigation: { ink: '#40382F', dark: '#65503B', base: '#96724E', light: '#D2BC8C', accent: '#AA925E', metal: '#7D867F', cloth: '#65716B' },
  modern: { ink: '#38454C', dark: '#62737A', base: '#A4B2B6', light: '#E2E6DE', accent: '#79A4A4', metal: '#81959A', cloth: '#6A818D' },
  fantasy: { ink: '#4C3D2C', dark: '#785837', base: '#B68B53', light: '#E3C995', accent: '#B56F4B', metal: '#7F8576', cloth: '#879764' },
  ruins: { ink: '#3D474C', dark: '#5E6D72', base: '#8D9D9C', light: '#C3CBC0', accent: '#89966F', metal: '#667C80', cloth: '#7D737A' },
  wilderness: { ink: '#3D5847', dark: '#557456', base: '#88A06D', light: '#C4CB98', accent: '#A48E68', metal: '#909D86', cloth: '#A7AD80' },
  coast: { ink: '#3D5554', dark: '#637F76', base: '#A2AC8D', light: '#E0D3AD', accent: '#B29268', metal: '#829A98', cloth: '#839F9C' },
}
const n = (value: number) => Math.round(value * 10) / 10
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
const rect = (x: number, y: number, width: number, height: number, fill: string, stroke: string, radius = 0, line = 5) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${line}"/>`
const circle = (x: number, y: number, radius: number, fill: string, stroke: string, line = 5) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${line}"/>`
const path = (d: string, fill: string, stroke: string, line = 5) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${line}" stroke-linecap="round" stroke-linejoin="round"/>`
const line = (d: string, color: string, width = 3) => path(d, 'none', color, width)
const repeat = (count: number, draw: (index: number) => string) => Array.from({ length: count }, (_, index) => draw(index)).join('')
const grain = (p: Palette, x: number, y: number, width: number, rows = 4) => repeat(rows, i => line(`M${x} ${y + i * 31}q${n(width / 4)} -5 ${n(width / 2)} 0t${n(width / 2)} 0`, i % 2 ? p.light : p.dark, 2))
function prop(pack: ThemePackArtId, key: string, name: string, body: string, widthMm: number, heightMm: number,
  footprint: [number, number], tags: string[], options: Partial<VisualSampleArt> = {}): VisualSampleArt {
  return { key, name, kind: 'prop', sourceSvg: svg(body), widthMm, heightMm,
    footprintMm: { width: footprint[0], height: footprint[1] }, blocksMovement: true, blocksSight: false,
    renderLayer: 'object', shadowClass: 'furniture', ...options, tags: ['主题艺术候选', pack, ...tags] }
}
const detail = (pack: ThemePackArtId, key: string, name: string, body: string, width: number, height: number, tags: string[], ground = false) =>
  prop(pack, key, name, body, width, height, [Math.max(1, Math.round(width * .65)), Math.max(1, Math.round(height * .65))], tags,
    { blocksMovement: false, shadowClass: 'none', ...(ground ? { renderLayer: 'ground' as const } : {}) })

/** Every free-form mark is wrapped in both axes. The tile's edges therefore
 * have the same continuation, rather than relying on a visually quiet seam. */
function periodic(count: number, draw: (index: number) => string): string {
  return repeat(9, cell => `<g transform="translate(${(cell % 3 - 1) * 512} ${(Math.floor(cell / 3) - 1) * 512})">${repeat(count, draw)}</g>`)
}
// Consolidate marks with the same paint into subpaths before wrapping them.
// Dense full-coverage patterns otherwise spend the path budget on copies.
function periodicLines(count: number, draw: (index: number) => string, color: string, width: number): string {
  return periodic(1, () => line(repeat(count, draw), color, width))
}
function noise(seed: number, index: number): number {
  let value = Math.imul(seed + index * 827, 0x45d9f3b)
  value ^= value >>> 16
  return (Math.imul(value, 0x45d9f3b) >>> 0) / 0x100000000
}
type TilePattern = 'plank' | 'parquet' | 'brick' | 'tile' | 'terrazzo' | 'carpet' | 'plaster' | 'gravel' | 'slab' | 'cracked' | 'soil' | 'grass' | 'water' | 'sand' | 'rock' | 'moss'
function material(pack: ThemePackArtId, key: string, name: string, pattern: TilePattern, base: string, accent: string,
  tileMm: number, seed: number, tags: string[]): VisualSampleArt {
  let marks = ''
  if (pattern === 'plank') {
    marks = repeat(8, row => {
      const y = row * 64, joint = row % 2 ? 160 : 384
      return line(`M0 ${y}H512M${joint} ${y}v64`, accent, 3)
        + periodic(1, () => line(`M5 ${y + 19}q72 -5 144 0t144 0t144 0t144 0M15 ${y + 43}q93 4 186 0t186 0t186 0`, accent, 1))
    })
  } else if (pattern === 'parquet') {
    marks = repeat(16, index => {
      const x = index % 4 * 128, y = Math.floor(index / 4) * 128, vertical = (index % 4 + Math.floor(index / 4)) % 2 === 0
      return rect(x, y, 128, 128, base, accent, 0, 2) + repeat(4, strip => vertical
        ? line(`M${x + strip * 32} ${y}v128M${x + strip * 32 + 12} ${y + 8}v110`, accent, strip ? 1 : 2)
        : line(`M${x} ${y + strip * 32}h128M${x + 8} ${y + strip * 32 + 12}h110`, accent, strip ? 1 : 2))
    })
  } else if (pattern === 'brick') {
    marks = repeat(8, row => line(`M0 ${row * 64}H512`, accent, 5)
      + repeat(4, column => line(`M${column * 128 + row % 2 * 64} ${row * 64}v64`, accent, 4)))
  } else if (pattern === 'tile') {
    marks = repeat(4, row => repeat(4, column => rect(column * 128 + 3, row * 128 + 3, 122, 122, base, accent, 2, 3)))
  } else if (pattern === 'slab' || pattern === 'cracked') {
    marks = repeat(4, row => line(`M0 ${row * 128}H512`, accent, 6) + repeat(2, column =>
      line(`M${column * 256 + row % 2 * 128} ${row * 128}v128`, accent, 4)))
    if (pattern === 'cracked') marks += periodic(5, i => {
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return line(`M${x} ${y}l31 24 -13 18 39 22m-26 -40 27 -12`, accent, 2)
    })
  } else if (pattern === 'carpet') {
    marks = periodicLines(64, i => `M${i % 8 * 64} ${Math.floor(i / 8) * 64}l25 12 25 -12m-25 -12v48`, accent, 1)
  } else if (pattern === 'water') {
    marks = periodicLines(32, i => {
      const x = i % 4 * 128, y = Math.floor(i / 4) * 64
      return `M${x} ${y}q22 -8 44 0t44 0m-63 22q15 -4 30 0`
    }, accent, 2)
  } else if (pattern === 'grass') {
    marks = periodicLines(60, i => {
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return `M${x} ${y}l-5 -13m5 13 3 -18m-3 18 10 -10`
    }, accent, 1.6)
  } else if (pattern === 'rock') {
    marks = periodic(12, i => {
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return line(`M${x} ${y}l18 -12 38 7 18 -16m-56 9 6 24`, accent, 2)
    })
  } else if (pattern === 'moss') {
    marks = periodic(25, i => {
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return path(`M${x} ${y}q-9 -12 3 -19 13 -8 23 4 16 -5 19 7 -3 17 -23 15 -16 10 -22 -7Z`, accent, accent, 1)
    })
  } else if (pattern === 'gravel' || pattern === 'terrazzo') {
    marks = periodic(1, () => repeat(2, paint => path(repeat(80, i => {
      if ((i % 3 === 0 ? 0 : 1) !== paint) return ''
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return `M${x} ${y}l4 -3 7 2 2 6 -6 3 -6 -2Z`
    }), paint ? accent : '#D8D3BB', accent, .8)))
  } else if (pattern === 'soil') {
    marks = periodicLines(52, i => {
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return `M${x} ${y}l6 -2m5 4 4 -1`
    }, accent, 1.5)
  } else {
    marks = periodic(pattern === 'sand' ? 96 : 52, i => {
      const x = n(noise(seed, i * 2) * 512), y = n(noise(seed, i * 2 + 1) * 512)
      return circle(x, y, pattern === 'plaster' ? 1.2 : .8, accent, accent, .5)
    })
  }
  return { key, name, kind: 'material', sourceSvg: svg(`<rect x="0" y="0" width="512" height="512" fill="${base}"/>${marks}`),
    widthMm: tileMm, heightMm: tileMm, tags: ['主题艺术候选', pack, '平铺材质', pattern, ...tags] }
}

function investigation(): VisualSampleArt[] {
  const p = palettes.investigation, pack = 'investigation' as const
  return [
    material(pack, 'oak-parquet', '旧宅拼花橡木', 'parquet', '#947655', '#665239', 2000, 101, ['室内', '木地板']),
    material(pack, 'archive-plank', '档案室窄木板', 'plank', '#7B6651', '#574B3C', 2000, 102, ['室内', '木板']),
    material(pack, 'clinic-tile', '诊所暖白瓷砖', 'tile', '#C4C2AB', '#959B8A', 1600, 103, ['诊所', '地板']),
    material(pack, 'aged-plaster', '旧宅灰黄灰泥', 'plaster', '#C3B899', '#A49D82', 2000, 104, ['墙面', '灰泥']),
    material(pack, 'study-carpet', '书房细纹地毯', 'carpet', '#777968', '#626855', 1800, 105, ['室内', '织物']),
    material(pack, 'courtyard-brick', '旧院红褐砖地', 'brick', '#9E7B63', '#665E4D', 2000, 106, ['室外', '铺装']),
    prop(pack, 'walnut-desk', '嵌皮胡桃木办公桌', rect(35, 80, 442, 352, p.base, p.ink, 15, 8)
      + rect(56, 104, 400, 305, p.light, p.dark, 7, 3) + rect(105, 137, 302, 236, p.cloth, p.dark, 7)
      + line('M61 390H450M77 111V401M435 111V401', p.dark, 3) + repeat(4, i => circle(68 + i % 2 * 376, 119 + Math.floor(i / 2) * 275, 4, p.accent, p.dark, 1)),
      2100, 1400, [1850, 1100], ['桌子', '办公', '书房']),
    prop(pack, 'leather-chair', '弧背皮面扶手椅', path('M95 174Q83 63 159 48H352Q431 64 417 174L385 209H126Z', p.dark, p.ink, 8)
      + rect(120, 174, 272, 275, p.base, p.ink, 42, 7) + rect(150, 207, 212, 205, p.cloth, p.ink, 32)
      + rect(72, 188, 67, 216, p.light, p.dark, 23) + rect(373, 188, 67, 216, p.light, p.dark, 23)
      + line('M170 232Q254 261 343 232M169 387H342', p.light, 2), 950, 1050, [760, 830], ['座具', '扶手椅']),
    prop(pack, 'filing-cabinet', '钢制横列档案柜', rect(38, 86, 436, 338, p.metal, p.ink, 8, 7)
      + rect(56, 104, 400, 302, '#A0A69A', p.dark, 3) + repeat(3, i => rect(75 + i * 125, 122, 112, 262, '#8C958C', p.ink, 3, 3)
        + rect(102 + i * 125, 322, 59, 19, p.light, p.ink, 3, 2) + line(`M${103 + i * 125} 303h57`, p.ink, 4)),
      1800, 850, [1600, 650], ['档案柜', '收纳', '金属']),
    prop(pack, 'archive-shelf', '敞口卷宗架', rect(31, 100, 450, 310, p.dark, p.ink, 4, 8)
      + repeat(9, i => rect(51 + i * 46, 125 + i % 3 * 6, 36, 253 - i % 3 * 6, [p.light, '#A99C7C', p.cloth][i % 3], p.ink, 2, 2)
        + line(`M${57 + i * 46} 350h22`, p.dark, 3)) + line('M42 398H469', p.base, 12),
      2200, 1000, [2000, 750], ['书架', '档案', '收纳']),
    prop(pack, 'medical-couch', '旧式分段诊疗床', rect(87, 33, 338, 446, p.metal, p.ink, 18, 7)
      + rect(104, 53, 304, 125, '#C7CFB7', p.dark, 24) + rect(104, 194, 304, 252, p.cloth, p.dark, 13)
      + line('M118 258H395M118 379H395M83 161H57V284M429 161H455V284', p.ink, 5),
      1000, 2350, [780, 2050], ['诊所', '诊疗床']),
    detail(pack, 'instrument-tray', '剪钳诊疗器械盘', rect(44, 79, 424, 351, p.metal, p.ink, 50, 7)
      + rect(68, 104, 376, 299, '#C4C8B5', p.dark, 35, 3)
      + line('M129 154L324 330M170 152L294 281M340 141L226 332', p.ink, 10)
      + circle(123, 154, 24, 'none', p.ink, 7) + circle(164, 150, 24, 'none', p.ink, 7)
      + line('M350 145l21 -10M233 337l-23 26', p.light, 6), 650, 550, ['诊所', '器械', '桌面']),
    detail(pack, 'brass-lamp', '黄铜圆罩桌灯', circle(256, 276, 124, p.accent, p.ink, 7)
      + circle(256, 276, 101, p.base, p.light, 4) + line('M256 293V148Q256 107 316 106', p.dark, 20)
      + path('M176 116Q256 35 338 116L328 191Q254 225 183 190Z', p.cloth, p.ink, 7)
      + line('M192 124Q256 81 321 124', p.light, 3), 500, 520, ['照明', '灯具', '无自动光源']),
    detail(pack, 'rotary-phone', '黑壳拨盘电话', path('M80 217L126 145H385L436 218L420 419H94Z', '#4F534D', p.ink, 8)
      + circle(257, 296, 91, p.base, p.ink, 6) + circle(257, 296, 45, p.light, p.ink, 3)
      + repeat(9, i => circle(n(257 + Math.cos(i * .62) * 68), n(296 + Math.sin(i * .62) * 68), 11, p.dark, p.ink, 2))
      + path('M93 108Q250 45 421 108L413 169Q372 184 341 152Q256 130 173 152Q127 189 91 169Z', '#444B45', p.ink, 8),
      650, 600, ['电话', '桌面', '调查']),
    detail(pack, 'typewriter', '机械打字机', rect(67, 154, 378, 286, '#5E675F', p.ink, 25, 8)
      + rect(133, 45, 246, 191, '#E0D7B8', p.dark, 3, 3) + line('M155 83H356M155 108H340M155 134H351', '#A19D82', 2)
      + rect(52, 185, 408, 39, p.metal, p.ink, 12, 4)
      + repeat(28, i => circle(114 + i % 7 * 47 + Math.floor(i / 7) % 2 * 9, 265 + Math.floor(i / 7) * 38, 13, p.light, p.ink, 3))
      + rect(158, 412, 194, 13, p.dark, p.ink, 4, 2), 750, 650, ['打字机', '办公', '桌面']),
    detail(pack, 'case-files', '散页案件卷宗', path('M78 98L338 65L370 424L111 452Z', p.base, p.ink, 4)
      + path('M114 71L410 119L354 444L58 395Z', '#DDD2AF', p.dark, 3)
      + repeat(8, i => line(`M${116 - i * 5} ${135 + i * 31}l${201 - i % 3 * 21} 33`, '#AAA087', 2))
      + path('M335 153q30 -24 41 3l-28 139q-11 17 -24 2l26 -130', 'none', p.metal, 5), 620, 650, ['纸张', '档案', '线索空白']),
    detail(pack, 'closed-ledger', '皮脊无字账本', path('M103 54H396V458H103Q70 448 70 425V90Q70 65 103 54Z', '#647363', p.ink, 7)
      + rect(113, 72, 264, 367, '#7C896E', p.dark, 7, 3) + rect(140, 111, 209, 130, p.light, p.dark, 3, 3)
      + line('M92 71V436M123 408H365', p.light, 3), 420, 600, ['书籍', '账本', '桌面']),
    prop(pack, 'coat-stand', '六臂木衣帽架', circle(256, 256, 105, p.dark, p.ink, 7)
      + repeat(6, i => { const a = i * Math.PI / 3, x = n(256 + Math.cos(a) * 188), y = n(256 + Math.sin(a) * 188); return line(`M256 256L${x} ${y}`, p.base, 24) + circle(x, y, 17, p.light, p.dark, 4) })
      + circle(256, 256, 37, p.light, p.ink, 5), 800, 800, [480, 480], ['衣帽架', '家具']),
    prop(pack, 'travel-case', '皮带旅行箱', rect(57, 89, 398, 333, p.dark, p.ink, 32, 7)
      + rect(76, 105, 360, 299, p.base, p.light, 23, 3) + rect(116, 100, 41, 309, '#6D5C43', p.ink, 4, 3)
      + rect(355, 100, 41, 309, '#6D5C43', p.ink, 4, 3) + rect(120, 259, 31, 39, p.accent, p.dark, 3, 2)
      + rect(360, 259, 31, 39, p.accent, p.dark, 3, 2) + path('M209 93V64Q257 40 304 64V93', 'none', p.ink, 15),
      850, 650, [700, 500], ['旅行箱', '储物']),
    prop(pack, 'exam-stool', '螺旋升降诊疗凳', repeat(3, i => { const a = i * Math.PI * 2 / 3, x = n(256 + Math.cos(a) * 190), y = n(256 + Math.sin(a) * 190); return line(`M256 256L${x} ${y}`, p.metal, 28) + circle(x, y, 21, p.dark, p.ink, 4) })
      + circle(256, 256, 133, p.cloth, p.ink, 8) + circle(256, 256, 112, '#829083', p.light, 3),
      680, 680, [500, 500], ['座具', '诊所']),
  ]
}

function modern(): VisualSampleArt[] {
  const p = palettes.modern, pack = 'modern' as const
  return [
    material(pack, 'ceramic-tile', '现代浅灰方砖', 'tile', '#C8D1CD', '#9DAAA7', 2000, 201, ['瓷砖', '室内']),
    material(pack, 'poured-concrete', '细孔浇筑混凝土', 'plaster', '#A2ADAB', '#7D8C8C', 2400, 202, ['混凝土', '仓库']),
    material(pack, 'road-asphalt', '城市细粒沥青', 'gravel', '#59686C', '#768183', 3000, 203, ['道路', '沥青']),
    material(pack, 'laminate-floor', '浅橡复合地板', 'plank', '#B9AC8D', '#918775', 2400, 204, ['室内', '木地板']),
    material(pack, 'office-carpet', '办公室织线地毯', 'carpet', '#788D96', '#647780', 2000, 205, ['办公室', '织物']),
    material(pack, 'terrazzo-floor', '公共区细屑水磨石', 'terrazzo', '#CCD0BE', '#9CA99E', 2000, 206, ['商店', '铺装']),
    prop(pack, 'office-desk', '圆角现代办公桌', rect(35, 106, 442, 304, '#D1C5A8', p.ink, 30, 7)
      + rect(51, 122, 410, 272, p.light, '#B2B8AB', 21, 3) + line('M60 377H449', p.dark, 3)
      + rect(376, 144, 59, 111, p.accent, p.dark, 7, 2), 1800, 1150, [1600, 900], ['桌子', '办公']),
    prop(pack, 'swivel-chair', '五爪网背办公椅', repeat(5, i => { const a = i * Math.PI * 2 / 5, x = n(256 + Math.cos(a) * 199), y = n(278 + Math.sin(a) * 174); return line(`M256 278L${x} ${y}`, p.metal, 19) + circle(x, y, 15, p.ink, p.ink, 2) })
      + rect(140, 169, 232, 219, p.cloth, p.ink, 46, 7) + path('M114 118Q257 45 398 118L375 189Q255 145 137 189Z', p.dark, p.ink, 7)
      + repeat(6, i => line(`M${147 + i * 43} 119l-5 40`, p.metal, 2)), 850, 850, [650, 650], ['椅子', '办公']),
    prop(pack, 'two-seat-sofa', '双人布艺沙发', rect(43, 87, 426, 341, p.cloth, p.ink, 36, 7)
      + rect(80, 123, 352, 64, '#8D9FA6', p.dark, 17, 3) + rect(88, 202, 159, 178, '#91A6AC', p.dark, 23, 3)
      + rect(263, 202, 159, 178, '#91A6AC', p.dark, 23, 3) + rect(43, 169, 48, 229, p.dark, p.ink, 15, 4)
      + rect(421, 169, 48, 229, p.dark, p.ink, 15, 4), 2200, 1200, [1900, 950], ['沙发', '居住']),
    prop(pack, 'single-bed', '现代折角薄被床', rect(82, 32, 348, 447, p.dark, p.ink, 15, 7)
      + rect(100, 55, 312, 402, '#BBCDC8', p.dark, 12, 3) + rect(122, 74, 268, 109, p.light, p.dark, 29, 4)
      + path('M100 211H412V457H100Z', p.cloth, p.ink, 4) + path('M412 211L331 278H412Z', '#A8BAC0', p.dark, 3)
      + line('M121 398H390M122 415H388', '#A5B7BB', 3), 1500, 2450, [1250, 2150], ['床', '居住']),
    prop(pack, 'shop-shelf', '双排开放商品架', rect(38, 83, 436, 347, p.metal, p.ink, 6, 7)
      + rect(60, 106, 392, 300, '#C1C9BE', p.dark, 3, 3) + line('M65 256H447', p.ink, 13)
      + repeat(12, i => rect(77 + i % 6 * 61, 128 + Math.floor(i / 6) * 148, 44, 103, [p.accent, '#B9AB87', '#A28E84'][i % 3], p.dark, 4, 2)),
      2100, 1100, [1900, 850], ['货架', '商店']),
    prop(pack, 'checkout-counter', '转角收银台', path('M51 65H460V215H239V449H51Z', '#A8B4B0', p.ink, 7)
      + path('M70 83H441V196H220V430H70Z', '#D7D7C6', p.dark, 3)
      + rect(103, 118, 131, 74, p.dark, p.ink, 7, 3) + rect(120, 128, 98, 41, p.accent, p.ink, 3, 2)
      + rect(106, 286, 83, 105, '#B8BDAE', p.dark, 4, 2), 2200, 2200, [1900, 1900], ['收银台', '商店']),
    prop(pack, 'medical-bed', '带护栏病床', rect(99, 32, 314, 447, '#D0D9D1', p.ink, 20, 6)
      + rect(117, 54, 278, 406, '#A7C6C0', p.dark, 19, 3) + rect(136, 77, 240, 96, '#E3E6DA', p.dark, 23, 3)
      + path('M119 200H394V452H119Z', '#86AEAC', p.dark, 3)
      + line('M72 173V352M441 173V352M65 190H99M65 330H99M413 190H447M413 330H447', p.metal, 14),
      1300, 2450, [1050, 2200], ['病床', '医院']),
    prop(pack, 'washbasin', '台式陶瓷洗手盆', rect(40, 76, 432, 365, '#CBD3CC', p.ink, 24, 6)
      + rect(72, 146, 368, 260, p.light, p.dark, 75, 4) + rect(113, 184, 286, 174, '#B1C4C0', '#809B9C', 56, 3)
      + circle(257, 288, 16, p.dark, p.ink, 3) + path('M254 156V95Q288 77 302 104V154', 'none', p.metal, 13)
      + circle(200, 106, 12, p.metal, p.dark, 2) + circle(358, 106, 12, p.metal, p.dark, 2),
      1000, 850, [850, 650], ['卫生设施', '洗手盆']),
    prop(pack, 'toilet', '陶瓷水箱座便器', rect(96, 36, 320, 127, p.light, p.ink, 24, 6)
      + path('M157 156H355Q425 192 407 307Q395 454 256 478Q115 454 105 308Q87 194 157 156Z', '#E0E6DD', p.ink, 7)
      + `<ellipse cx="256" cy="302" rx="107" ry="141" fill="#BCCFC8" stroke="${p.dark}" stroke-width="4"/>`
      + `<ellipse cx="256" cy="302" rx="74" ry="103" fill="#8EAFAC" stroke="${p.metal}" stroke-width="3"/>`
      + rect(333, 67, 42, 17, p.metal, p.dark, 4, 2), 800, 1150, [620, 950], ['卫生设施', '座便器']),
    detail(pack, 'computer-terminal', '显示器与键盘', rect(53, 43, 406, 228, p.dark, p.ink, 13, 6)
      + rect(71, 63, 370, 187, '#8AA9A9', p.ink, 5, 3) + path('M89 216L195 121L279 162L346 101L425 162V234H89Z', '#B5C9BC', '#729598', 2)
      + rect(221, 272, 70, 40, p.metal, p.dark, 4, 3) + rect(77, 335, 359, 125, '#B8C6C4', p.dark, 9, 4)
      + repeat(36, i => rect(94 + i % 12 * 27, 353 + Math.floor(i / 12) * 27, 19, 17, p.light, p.dark, 2, 1)),
      800, 700, ['电脑', '办公', '桌面']),
    prop(pack, 'refrigerator', '双门冷藏柜', rect(69, 37, 374, 438, '#D5DEDA', p.ink, 19, 7)
      + rect(87, 55, 338, 402, '#BAC9C6', p.dark, 12, 3) + line('M256 62V450', p.dark, 4)
      + rect(218, 146, 12, 180, p.metal, p.ink, 3, 2) + rect(282, 146, 12, 180, p.metal, p.ink, 3, 2)
      + rect(107, 81, 107, 67, '#8AA8A5', p.dark, 4, 2), 1200, 1400, [1000, 1150], ['电器', '冷藏']),
    prop(pack, 'waste-bin', '脚踏盖垃圾桶', rect(110, 66, 292, 374, '#9FAEAD', p.ink, 55, 7)
      + rect(127, 79, 258, 329, '#BBC7BF', p.dark, 48, 3) + rect(160, 128, 191, 207, '#788E8E', p.dark, 27, 3)
      + rect(191, 413, 131, 36, p.dark, p.ink, 8, 3), 600, 700, [430, 500], ['杂物', '垃圾桶']),
    prop(pack, 'traffic-cone', '方底反光路锥', path('M72 76L424 76L450 436L62 436Z', p.dark, p.ink, 8)
      + circle(256, 256, 163, '#C98055', p.ink, 7) + circle(256, 256, 116, '#E2C6A3', p.dark, 4)
      + circle(256, 256, 74, '#C98055', p.dark, 4) + circle(256, 256, 28, '#816D58', p.ink, 3),
      700, 700, [550, 550], ['道路', '路锥', '道具']),
    prop(pack, 'shipping-cartons', '封箱纸板货箱', rect(61, 67, 388, 379, '#B79C75', p.ink, 8, 6)
      + path('M79 84H432V425H79Z', '#C9B08A', '#9B835F', 3) + line('M255 86V423M80 256H430', '#927B59', 4)
      + rect(230, 85, 51, 338, '#DED3AC', '#AE9D78', 0, 2) + rect(319, 129, 74, 101, p.light, '#9B967D', 3, 2)
      + line('M332 154H380M332 174H373M332 197H378', '#9B967D', 3), 1000, 1000, [830, 830], ['仓库', '货箱', '收纳']),
  ]
}

function fantasy(): VisualSampleArt[] {
  const p = palettes.fantasy, pack = 'fantasy' as const
  return [
    material(pack, 'tavern-plank', '酒馆宽木地板', 'plank', '#AE8A58', '#775735', 2400, 301, ['酒馆', '木地板']),
    material(pack, 'town-cobble', '城镇错缝石路', 'slab', '#A5A38A', '#737C6B', 2400, 302, ['街道', '石路']),
    material(pack, 'market-earth', '集市夯实土面', 'soil', '#B39D71', '#887857', 3000, 303, ['集市', '土地']),
    material(pack, 'lime-plaster', '民居暖色灰泥', 'plaster', '#D5C8A0', '#B5A882', 2200, 304, ['墙面', '民居']),
    material(pack, 'hearth-stone', '炉边旧方石', 'tile', '#9F9680', '#726A59', 1800, 305, ['炉边', '石地板']),
    material(pack, 'stable-gravel', '马厩细砾地', 'gravel', '#AD9B71', '#847859', 2400, 306, ['室外', '碎砾']),
    prop(pack, 'trestle-table', '榫接长餐桌', path('M45 102L464 88L475 410L38 424Z', p.base, p.ink, 10)
      + path('M65 119L448 108L451 390L59 403Z', '#C69D61', p.dark, 4) + line('M65 189L451 179M62 264L452 256M61 338L451 329', p.dark, 5)
      + grain(p, 84, 151, 338, 7), 2500, 1400, [2250, 1100], ['桌子', '餐桌', '酒馆']),
    prop(pack, 'wooden-bench', '厚板长凳', rect(38, 139, 436, 234, p.dark, p.ink, 16, 9)
      + rect(56, 155, 400, 200, p.base, p.light, 10, 3) + line('M60 254H451M112 162V347M401 162V347', p.dark, 4)
      + grain(p, 70, 185, 370, 5), 2200, 700, [2000, 520], ['凳子', '座具', '酒馆']),
    prop(pack, 'three-leg-stool', '三脚圆木凳', repeat(3, i => { const a = i * Math.PI * 2 / 3, x = n(256 + Math.cos(a) * 185), y = n(256 + Math.sin(a) * 185); return circle(x, y, 35, p.dark, p.ink, 5) })
      + circle(256, 256, 162, p.base, p.ink, 10) + circle(256, 256, 140, '#CAA369', p.light, 4)
      + line('M133 204H376M121 270H391M155 337H355', p.dark, 4), 700, 700, [530, 530], ['凳子', '座具']),
    prop(pack, 'straw-bed', '草褥木框床', rect(78, 35, 356, 442, p.dark, p.ink, 13, 9)
      + rect(99, 58, 313, 395, '#C5AD76', p.ink, 15, 4) + repeat(18, i => line(`M${121 + i % 6 * 51} ${83 + Math.floor(i / 6) * 119}l-13 83`, '#9C8D5F', 2))
      + rect(125, 77, 265, 99, '#DBCCA3', p.dark, 20, 4) + path('M100 218L409 204V453H100Z', p.cloth, p.dark, 5)
      + line('M123 390L385 379', '#ACB485', 4), 1400, 2400, [1150, 2100], ['床', '旅舍']),
    prop(pack, 'market-stall', '开放木摊台', path('M46 103H466V413H46Z', p.dark, p.ink, 9)
      + rect(65, 119, 382, 274, p.base, p.light, 3, 4) + line('M65 200H446M65 287H446', p.dark, 5)
      + rect(59, 43, 49, 425, p.dark, p.ink, 6, 4) + rect(404, 43, 49, 425, p.dark, p.ink, 6, 4)
      + repeat(5, i => rect(124 + i * 57, 152, 44, 73, ['#B98259', '#B8AD70', '#8F9A65'][i % 3], p.dark, 9, 3)),
      2500, 1800, [2250, 1500], ['摊位', '集市']),
    prop(pack, 'anvil', '宽角锻造铁砧', path('M52 215L176 120H383L445 184L414 226H356L391 382H156L181 226H84Z', p.metal, p.ink, 9)
      + path('M176 120L203 185H416M181 227H357M172 356H375', 'none', '#B2B39A', 5)
      + path('M186 252H335L352 339H172Z', '#6B766B', p.ink, 4), 1600, 1100, [1250, 850], ['铁砧', '铁匠铺']),
    prop(pack, 'forge', '圆口冷炉台', rect(49, 46, 414, 420, '#8B8D74', p.ink, 23, 9)
      + circle(256, 253, 158, '#626B59', p.ink, 8) + circle(256, 253, 112, '#4C5145', '#A5A080', 8)
      + repeat(7, i => path(`M${149 + i * 31} 276l13 -32 19 27 -12 27Z`, '#7F6B4E', p.ink, 2))
      + line('M66 103H139M373 103H448M67 410H144M371 410H448', p.light, 6),
      1800, 1800, [1500, 1500], ['炉台', '铁匠铺', '无自动危险']),
    prop(pack, 'barrel', '箍铁橡木桶', circle(256, 256, 209, p.dark, p.ink, 9) + circle(256, 256, 181, p.base, p.light, 4)
      + line('M145 109V402M218 79V435M291 79V435M364 111V402', p.dark, 5)
      + circle(256, 256, 195, 'none', p.metal, 17) + circle(312, 216, 26, p.dark, p.ink, 4)
      + grain(p, 135, 174, 230, 6), 1000, 1000, [800, 800], ['桶', '储物', '酒馆']),
    prop(pack, 'grain-sack', '麻绳扎口粮袋', path('M191 71L310 66L298 133Q434 204 433 329Q435 445 269 460Q84 454 80 329Q81 206 211 136Z', '#B7A374', p.ink, 8)
      + path('M133 263Q190 231 241 262M274 170Q355 214 367 289M145 382Q255 430 370 376', 'none', '#D1BF8A', 5)
      + line('M193 124L312 133M199 141L305 150M256 136L286 199M260 142L218 182', p.dark, 7),
      1000, 1200, [730, 920], ['粮袋', '储物', '集市']),
    prop(pack, 'cross-crate', '斜撑厚木箱', rect(53, 54, 406, 403, p.dark, p.ink, 8, 9)
      + rect(73, 73, 365, 363, p.base, p.light, 2, 4) + line('M154 79V432M236 79V432M319 79V432M398 79V432', p.dark, 5)
      + path('M85 96L414 411M413 95L89 412', 'none', '#D0AA6F', 24) + line('M85 96L414 411M413 95L89 412', p.dark, 3),
      1100, 1100, [900, 900], ['木箱', '储物']),
    detail(pack, 'iron-lantern', '锻铁六角提灯', path('M203 98V68Q256 23 309 68V98', 'none', p.ink, 14)
      + path('M172 112H340L397 210V365L337 430H175L115 365V210Z', p.metal, p.ink, 7)
      + path('M184 138H328L365 217V346L324 399H188L146 345V217Z', '#D7BC76', p.dark, 6)
      + line('M183 140L190 397M328 140L323 397M145 220H365M147 344H364', p.ink, 10)
      + path('M253 225Q210 284 258 327Q304 286 253 225Z', '#F0DBA5', '#B39D68', 3), 500, 620, ['灯具', '提灯', '无自动光源']),
    prop(pack, 'open-cask', '敞口饮水木桶', circle(256, 256, 208, p.base, p.ink, 9) + circle(256, 256, 182, p.dark, p.light, 5)
      + circle(256, 256, 149, '#7B9C94', p.ink, 6) + path('M142 243Q217 206 363 235M171 298Q255 269 341 288', 'none', '#B6C5AC', 4)
      + circle(256, 256, 194, 'none', p.metal, 13), 1100, 1100, [850, 850], ['桶', '饮水', '生活']),
    prop(pack, 'tool-rack', '敞口工坊工具架', rect(35, 90, 442, 330, p.dark, p.ink, 5, 8)
      + rect(55, 111, 400, 288, p.base, p.light, 3, 3) + line('M75 160H434M75 348H434', p.dark, 10)
      + line('M129 175V334M212 179V335M297 175V333M381 175V334', '#D6BB85', 13)
      + path('M91 165H166V205H91Z M184 164H246L231 216H198Z M269 164H327V192H269Z M354 163H408L398 217H365Z', p.metal, p.ink, 4),
      2100, 1100, [1850, 850], ['工具架', '工坊']),
    prop(pack, 'cauldron', '耳柄铁锅', circle(256, 256, 169, p.metal, p.ink, 9) + circle(256, 256, 140, '#536B58', p.dark, 8)
      + path('M99 194Q25 158 44 252Q45 302 98 304M413 194Q489 158 469 252Q467 302 414 304', 'none', p.ink, 17)
      + path('M156 227Q221 196 289 228M207 305Q264 280 335 303', 'none', '#94A274', 4)
      + circle(216, 256, 12, '#B8B58A', '#70866A', 3) + circle(306, 220, 8, '#B8B58A', '#70866A', 2),
      1200, 1000, [820, 820], ['炊具', '厨房', '无自动危险']),
  ]
}

function ruins(): VisualSampleArt[] {
  const p = palettes.ruins, pack = 'ruins' as const
  return [
    material(pack, 'old-slab', '遗迹冷灰大石板', 'slab', '#9CA7A3', '#687B7C', 2400, 401, ['遗迹', '石地板']),
    material(pack, 'cracked-paving', '裂缝旧石铺装', 'cracked', '#929E9E', '#5D7276', 2200, 402, ['破损', '铺装']),
    material(pack, 'burial-earth', '墓室灰褐土面', 'soil', '#8D9081', '#626F67', 2400, 403, ['墓室', '土地']),
    material(pack, 'pale-limestone', '浅色风化石灰岩', 'rock', '#B6BEAF', '#89958E', 2000, 404, ['石灰岩', '墙面']),
    material(pack, 'dark-basalt', '暗青冷岩地面', 'rock', '#687E7F', '#435E64', 2400, 405, ['岩石', '地面']),
    material(pack, 'lichen-stone', '斑苔侵蚀石面', 'moss', '#89978D', '#7A8867', 2200, 406, ['苔痕', '石材']),
    prop(pack, 'stone-altar', '缺角石祭台', path('M42 99H466V402H70L42 373Z', p.base, p.ink, 8)
      + path('M66 120H442V379H85L65 358Z', '#B2BEB3', p.dark, 4)
      + path('M143 177H369V320H143ZM256 146V351M112 248H399', 'none', p.dark, 3)
      + line('M99 105L117 142L99 162M412 349L388 370L400 393', p.ink, 3),
      2300, 1500, [2000, 1200], ['祭台', '遗迹']),
    prop(pack, 'sarcophagus', '双层石棺盖', path('M135 37H377L432 133L400 460H112L80 133Z', p.dark, p.ink, 8)
      + path('M151 59H361L407 140L379 439H133L105 140Z', p.light, p.dark, 4)
      + path('M185 99H327L354 147L336 387H176L158 147Z', p.base, p.dark, 4)
      + circle(256, 158, 35, '#A7B4A9', p.dark, 3) + path('M230 194L212 293L239 350H273L299 293L281 194Z', '#A7B4A9', p.dark, 3)
      + line('M135 410L155 426L147 442M362 96L344 117L353 135', p.ink, 2),
      1250, 2600, [1000, 2250], ['石棺', '墓室']),
    prop(pack, 'burial-urn', '裂口陶骨灰罐', path('M180 80Q255 46 331 80L319 154Q400 204 408 314Q418 426 256 458Q95 426 104 315Q111 203 193 154Z', '#A7A38B', p.ink, 7)
      + `<ellipse cx="256" cy="93" rx="83" ry="39" fill="#697776" stroke="${p.ink}" stroke-width="5"/>`
      + path('M180 233Q252 266 332 230M165 338Q255 374 349 334', 'none', p.light, 5)
      + line('M313 87L295 135L314 183L291 220', p.dark, 3), 800, 1050, [530, 680], ['骨灰罐', '墓室']),
    prop(pack, 'column-base', '八角断柱基座', path('M150 46H362L466 150V362L362 466H150L46 362V150Z', p.dark, p.ink, 7)
      + path('M165 76H347L436 165V347L347 436H165L76 347V165Z', p.light, p.dark, 4)
      + circle(256, 256, 134, p.base, p.ink, 5) + circle(256, 256, 101, 'none', p.light, 5)
      + line('M193 147L217 208L203 244M341 310L309 296L291 323', p.dark, 3),
      1800, 1800, [1500, 1500], ['石柱', '断柱', '遗迹']),
    prop(pack, 'fallen-column', '断裂倒地柱段', path('M68 166L130 117H394L449 170L426 346L375 391H128L64 341Z', p.base, p.ink, 8)
      + path('M131 118L146 174V343L129 390M381 120L364 168V344L375 390', 'none', p.dark, 5)
      + line('M158 177H352M157 221H351M157 266H351M157 312H351', p.light, 7)
      + path('M68 166L117 187L97 236L131 271L94 309L64 341M449 170L409 208L432 244L401 278L426 346', 'none', p.dark, 5),
      2800, 1350, [2450, 1050], ['石柱', '倒塌', '遗迹']),
    prop(pack, 'broken-statue', '残损披袍石像', path('M205 47L287 38L331 99L302 162L340 207L382 304L349 440H154L125 308L169 204L215 161L181 107Z', p.base, p.ink, 7)
      + path('M215 160L253 194L302 162M172 229L216 264L181 410M309 219L274 272L323 422M252 207L247 419', 'none', p.light, 8)
      + path('M177 203L128 217L101 279L131 301L169 263M338 207L385 228L398 269L370 286L349 253', p.dark, p.ink, 5)
      + path('M182 109L221 93L233 129L219 160', 'none', p.dark, 4),
      1350, 1900, [850, 1200], ['石像', '残损', '遗迹']),
    prop(pack, 'iron-cage', '空置铁笼道具', rect(47, 48, 418, 417, '#758988', p.ink, 5, 8)
      + rect(69, 70, 374, 373, '#A1ABA0', p.dark, 3, 3)
      + repeat(7, i => line(`M${95 + i * 54} 71V441M71 ${95 + i * 54}H441`, p.dark, 7))
      + rect(207, 193, 99, 126, p.base, p.ink, 5, 4) + circle(257, 250, 12, p.ink, p.ink, 2),
      2100, 2100, [1850, 1850], ['铁笼', '监牢', '装饰物件']),
    prop(pack, 'brazier', '三足冷灰火盆', repeat(3, i => { const a = i * Math.PI * 2 / 3, x = n(256 + Math.cos(a) * 192), y = n(256 + Math.sin(a) * 192); return line(`M256 256L${x} ${y}`, p.dark, 21) + circle(x, y, 19, p.base, p.ink, 4) })
      + circle(256, 256, 157, p.metal, p.ink, 7) + circle(256, 256, 127, '#5D6E6C', p.dark, 5)
      + path('M169 235L302 332M186 325L321 184M220 180L291 320', 'none', '#A3A08A', 22),
      1100, 1100, [800, 800], ['火盆', '无自动光源', '无自动危险']),
    prop(pack, 'grave-slab', '磨蚀墓碑平盖', path('M143 47L370 43L423 123L399 463L112 459L89 126Z', p.base, p.ink, 7)
      + path('M158 72H354L396 135L375 437L137 433L116 136Z', p.light, p.dark, 4)
      + path('M188 123H325V239H188ZM256 102V259M166 179H345', 'none', p.dark, 3)
      + line('M165 334H343M165 357H323M165 380H338M378 78L348 107L361 139', p.dark, 3),
      1350, 2400, [1050, 2000], ['墓碑', '墓室', '无字纹饰']),
    detail(pack, 'rubble-pile', '不规则石砾堆', path('M54 281L83 207L145 190L192 239L175 321L98 345Z M188 141L246 86L319 101L350 178L309 232L229 221Z M325 267L358 206L434 218L462 295L418 346L351 329Z M164 370L219 302L292 308L330 379L286 440L211 432Z', p.base, p.ink, 5)
      + line('M82 223L130 245L170 235M231 113L272 158L338 172M365 228L393 275L451 285M218 324L249 366L313 380', p.light, 5),
      1800, 1600, ['碎石', '遗迹', '装饰'], true),
    detail(pack, 'chain-ring', '锈蚀铁环与短链', circle(256, 139, 88, 'none', p.dark, 23) + circle(256, 139, 88, 'none', p.metal, 9)
      + repeat(5, i => `<ellipse cx="${256 + i % 2 * 17}" cy="${242 + i * 39}" rx="${i % 2 ? 26 : 15}" ry="30" fill="none" stroke="${p.ink}" stroke-width="12"/>`),
      700, 1000, ['铁链', '监牢', '装饰'], true),
    detail(pack, 'candle-cluster', '石盘残烛组', path('M89 102L369 77L446 205L417 399L215 446L67 327Z', p.dark, p.ink, 6)
      + circle(189, 199, 61, '#D6D0AE', p.ink, 4) + circle(331, 267, 73, '#CBC6A5', p.ink, 4)
      + circle(185, 347, 46, '#E0D8B5', p.ink, 4) + repeat(3, i => { const x = [189, 331, 185][i], y = [199, 267, 347][i]; return circle(x, y, 10, p.ink, p.ink, 2) + line(`M${x} ${y}l3 -18`, p.dark, 4) }),
      750, 750, ['蜡烛', '无自动光源']),
    prop(pack, 'stone-bench', '断角长石凳', path('M46 132H448L474 177L460 375H72L43 343Z', p.base, p.ink, 7)
      + path('M70 151H431L450 184L438 351H85L66 330Z', p.light, p.dark, 4)
      + line('M108 157L125 202L111 237M365 346L349 316L366 287M83 257H429', p.dark, 3),
      2400, 950, [2050, 680], ['石凳', '座具', '遗迹']),
    prop(pack, 'ceremony-basin', '八瓣浅石盆', path('M173 48H338L397 113L464 173V338L398 398L338 464H173L113 398L48 338V173L113 113Z', p.base, p.ink, 7)
      + circle(256, 256, 160, p.light, p.dark, 5) + circle(256, 256, 126, '#7C9792', p.dark, 5)
      + path('M169 239Q230 210 343 241M190 290Q257 268 323 287', 'none', '#ABBFB0', 4),
      1500, 1500, [1200, 1200], ['石盆', '祭祀', '遗迹']),
  ]
}

function treeCanopy(p: Palette, lobes: number, seed: number): string {
  return repeat(lobes, i => {
    const a = i * Math.PI * 2 / lobes, radius = 121 + noise(seed, i) * 27, x = n(256 + Math.cos(a) * radius), y = n(256 + Math.sin(a) * radius)
    return `<ellipse cx="${x}" cy="${y}" rx="${n(82 + noise(seed, i + 20) * 20)}" ry="${n(72 + noise(seed, i + 30) * 20)}" fill="${i % 2 ? p.base : p.dark}" stroke="${p.ink}" stroke-width="4"/>`
  }) + circle(256, 256, 95, p.base, p.ink, 4) + repeat(lobes, i => {
    const a = i * Math.PI * 2 / lobes
    return line(`M256 256Q${n(256 + Math.cos(a + .2) * 92)} ${n(256 + Math.sin(a + .2) * 92)} ${n(256 + Math.cos(a) * 176)} ${n(256 + Math.sin(a) * 176)}`, p.light, 2.5)
  })
}
function tentBody(p: Palette): string {
  return path('M73 105L256 45L439 105L469 432L256 469L43 432Z', p.cloth, p.ink, 8)
    + path('M256 45L256 469M73 105L256 381L439 105M43 432L256 381L469 432', 'none', p.light, 6)
    + path('M256 80L256 351L131 131Z', p.base, p.dark, 3) + line('M72 108L37 60M439 105L477 58M43 431L28 475M469 431L484 475', p.dark, 4)
}
function wilderness(): VisualSampleArt[] {
  const p = palettes.wilderness, pack = 'wilderness' as const
  return [
    material(pack, 'meadow-grass', '温带疏簇草地', 'grass', '#97AA78', '#788F62', 3000, 501, ['草地', '植被']),
    material(pack, 'forest-loam', '林下落叶腐土', 'soil', '#938A66', '#6B7253', 2400, 502, ['林地', '土地']),
    material(pack, 'river-water', '灰青缓流水面', 'water', '#739F9D', '#A0B9AB', 3200, 503, ['河水', '水面']),
    material(pack, 'river-gravel', '河滩细圆砾', 'gravel', '#A9AD94', '#808E7E', 2200, 504, ['河滩', '碎砾']),
    material(pack, 'hill-rock', '林坡浅层岩', 'rock', '#A1A78F', '#758677', 2400, 505, ['山道', '裸岩']),
    material(pack, 'forest-moss', '林荫连片苔地', 'moss', '#819466', '#6D845A', 2400, 506, ['苔藓', '地面']),
    prop(pack, 'broadleaf-tree', '分瓣阔叶树冠', treeCanopy(p, 11, 514), 3500, 3500, [650, 650], ['树木', '阔叶', '植被'], { blocksSight: true, renderLayer: 'canopy', shadowClass: 'vegetation' }),
    prop(pack, 'pine-tree', '轮生针叶松冠', repeat(5, ring => repeat(7, i => {
      const a = i * Math.PI * 2 / 7 + ring * .22, length = 208 - ring * 28
      return path(`M256 256L${n(256 + Math.cos(a - .22) * (length - 12))} ${n(256 + Math.sin(a - .22) * (length - 12))}L${n(256 + Math.cos(a) * length)} ${n(256 + Math.sin(a) * length)}L${n(256 + Math.cos(a + .22) * (length - 12))} ${n(256 + Math.sin(a + .22) * (length - 12))}Z`, ring % 2 ? '#729065' : p.dark, p.ink, 2.5)
    })) + circle(256, 256, 32, '#A6B37D', p.ink, 3), 3200, 3200, [550, 550], ['树木', '松树', '植被'], { blocksSight: true, renderLayer: 'canopy', shadowClass: 'vegetation' }),
    prop(pack, 'dead-tree', '裸枝枯树俯冠', path('M243 458L250 277L159 186L112 68L139 60L186 161L242 205L230 62L258 48L271 221L343 151L401 65L423 84L366 177L287 267L327 348L415 376L407 402L307 370L268 300L273 458Z', '#99866B', p.ink, 5)
      + line('M174 171L83 191L74 215M269 233L336 242L401 221M252 287L163 331L134 402M247 199L193 102', '#C0B391', 5),
      2700, 3000, [500, 500], ['树木', '枯树', '植被'], { blocksSight: false, renderLayer: 'canopy', shadowClass: 'vegetation' }),
    prop(pack, 'river-willow', '垂枝河岸柳冠', treeCanopy({ ...p, base: '#9DB77A', dark: '#789866', light: '#D0D59D' }, 8, 519)
      + repeat(12, i => { const a = i * Math.PI * 2 / 12; return path(`M${n(256 + Math.cos(a) * 95)} ${n(256 + Math.sin(a) * 95)}Q${n(256 + Math.cos(a + .15) * 172)} ${n(256 + Math.sin(a + .15) * 172)} ${n(256 + Math.cos(a) * 205)} ${n(256 + Math.sin(a) * 205)}`, 'none', '#BACA89', 5) }),
      3800, 3300, [700, 650], ['树木', '柳树', '河岸'], { blocksSight: true, renderLayer: 'canopy', shadowClass: 'vegetation' }),
    prop(pack, 'low-shrub', '低矮圆叶灌丛', treeCanopy({ ...p, base: '#8AA16F', dark: '#708D60', light: '#B9C88B' }, 7, 525),
      1450, 1300, [700, 600], ['灌木', '植被'], { blocksMovement: false, shadowClass: 'vegetation' }),
    detail(pack, 'fern', '放射分叶蕨丛', repeat(9, i => {
      const a = i * Math.PI * 2 / 9, endX = n(256 + Math.cos(a) * 205), endY = n(256 + Math.sin(a) * 205)
      return path(`M256 256Q${n(256 + Math.cos(a - .3) * 130)} ${n(256 + Math.sin(a - .3) * 130)} ${endX} ${endY}Q${n(256 + Math.cos(a + .3) * 130)} ${n(256 + Math.sin(a + .3) * 130)} 256 256Z`, i % 2 ? '#80A274' : '#649263', p.ink, 2)
        + line(`M256 256L${endX} ${endY}`, '#B4C68B', 2)
    }), 1100, 1100, ['蕨类', '植被'], true),
    detail(pack, 'flower-patch', '野花与细叶小簇', repeat(14, i => {
      const x = n(110 + noise(534, i * 2) * 290), y = n(90 + noise(534, i * 2 + 1) * 310)
      return path(`M${x} ${y + 25}l-17 -22m17 22 18 -29`, 'none', p.dark, 5)
        + repeat(5, petal => circle(n(x + Math.cos(petal * Math.PI * 2 / 5) * 13), n(y + Math.sin(petal * Math.PI * 2 / 5) * 13), 10, i % 2 ? '#D8C59B' : '#BDAD9A', p.dark, 1))
        + circle(x, y, 6, '#AD985D', p.ink, 1)
    }), 1000, 1100, ['野花', '植被'], true),
    detail(pack, 'grass-tuft', '分叉长叶草簇', repeat(11, i => {
      const a = i * Math.PI * 2 / 11, x = n(256 + Math.cos(a) * 200), y = n(256 + Math.sin(a) * 200)
      return path(`M250 263Q${n(256 + Math.cos(a - .2) * 140)} ${n(256 + Math.sin(a - .2) * 140)} ${x} ${y}Q${n(256 + Math.cos(a + .1) * 120)} ${n(256 + Math.sin(a + .1) * 120)} 263 270Z`, i % 2 ? p.base : '#ACC18B', p.dark, 2)
    }), 850, 850, ['草簇', '植被'], true),
    prop(pack, 'boulder', '折面覆苔巨石', path('M51 247L103 111L227 53L358 84L461 208L434 373L309 460L156 422L64 352Z', '#98A38E', p.ink, 7)
      + path('M103 111L223 168L358 84L326 253L461 208M64 352L186 299L309 460M186 299L326 253L434 373', 'none', '#748775', 5)
      + path('M102 136L213 85L297 103M89 265L111 322M321 333L390 306', 'none', '#C3C7A4', 6)
      + path('M136 360Q189 334 233 375L216 411L169 401Z', '#809566', p.dark, 2),
      2200, 2100, [1750, 1550], ['岩石', '巨石']),
    prop(pack, 'fallen-log', '分枝倒木', path('M51 201L83 156L406 181L458 228L443 339L401 367L76 327L46 284Z', '#927E5C', p.ink, 7)
      + path('M143 166L171 102L198 94L192 171M321 354L337 418L363 430L360 359', '#927E5C', p.ink, 5)
      + `<ellipse cx="91" cy="245" rx="45" ry="81" fill="#C4B28B" stroke="${p.ink}" stroke-width="5"/>`
      + `<ellipse cx="91" cy="245" rx="26" ry="56" fill="none" stroke="#9D8B65" stroke-width="3"/>`
      + line('M146 212L400 237M143 272L408 293M194 184L216 320M303 201L280 329', '#C0AB7A', 4),
      2900, 1300, [2550, 850], ['倒木', '树木']),
    prop(pack, 'canvas-tent', '低顶帆布营帐', tentBody(p), 3000, 3000, [2500, 2350], ['帐篷', '营地', '非可进入建筑']),
    detail(pack, 'cold-campfire', '石圈熄灭营火', repeat(9, i => { const a = i * Math.PI * 2 / 9; return `<ellipse cx="${n(256 + Math.cos(a) * 167)}" cy="${n(256 + Math.sin(a) * 167)}" rx="43" ry="34" transform="rotate(${n(a * 180 / Math.PI)} ${n(256 + Math.cos(a) * 167)} ${n(256 + Math.sin(a) * 167)})" fill="#A3AA91" stroke="${p.ink}" stroke-width="4"/>` })
      + path('M143 206L329 341M166 352L358 189M222 157L291 358', 'none', '#816C4E', 32)
      + path('M143 206L329 341M166 352L358 189M222 157L291 358', 'none', '#B09970', 6),
      1800, 1800, ['营火', '营地', '无自动危险', '无自动光源'], true),
    prop(pack, 'bedroll', '捆带野营铺盖', rect(87, 45, 338, 420, '#9AAB81', p.ink, 30, 6)
      + rect(106, 72, 300, 358, '#B5BF94', p.dark, 24, 3) + rect(104, 76, 304, 97, '#8B9F75', p.dark, 33, 4)
      + rect(152, 54, 24, 397, '#7C8060', p.ink, 3, 2) + rect(335, 54, 24, 397, '#7C8060', p.ink, 3, 2)
      + line('M122 387H391M124 406H388', '#D0D3AA', 3),
      1050, 2300, [800, 2000], ['铺盖', '床', '营地']),
    prop(pack, 'rucksack', '侧袋野营背囊', path('M128 104Q254 40 383 104L414 415Q256 476 98 415Z', '#8D9C6C', p.ink, 6)
      + rect(132, 111, 249, 131, '#ADB78B', p.dark, 32, 3) + rect(153, 282, 208, 132, '#A2AF82', p.dark, 23, 3)
      + rect(77, 230, 62, 151, '#8F9D71', p.ink, 18, 3) + rect(373, 230, 62, 151, '#8F9D71', p.ink, 18, 3)
      + line('M187 104V240M327 104V240M220 85V51H290V85', '#6A7655', 11),
      850, 1000, [620, 730], ['背囊', '营地', '储物']),
  ]
}

function coast(): VisualSampleArt[] {
  const p = palettes.coast, pack = 'coast' as const
  return [
    material(pack, 'dry-sand', '浅湾干燥细沙', 'sand', '#D7C69D', '#BAA97F', 3200, 601, ['沙滩', '干沙']),
    material(pack, 'wet-sand', '潮线湿润沙面', 'soil', '#B4AB8A', '#90967E', 2400, 602, ['沙滩', '湿沙']),
    material(pack, 'coastal-water', '潮湾青绿海水', 'water', '#6E999A', '#A6BFB4', 3200, 603, ['海水', '水面']),
    material(pack, 'weathered-plank', '盐风风化木板', 'plank', '#A6A28A', '#727E71', 2400, 604, ['木板', '码头外观']),
    material(pack, 'tidal-rock', '潮间带苔灰岩', 'rock', '#929F91', '#6B8177', 2200, 605, ['岸岩', '石材']),
    material(pack, 'shore-shingle', '贝砂圆砾地面', 'gravel', '#B9BA9F', '#929D8A', 2400, 606, ['海岸', '碎砾']),
    prop(pack, 'wind-pine', '偏冠海岸松树', treeCanopy({ ...p, base: '#88A17A', dark: '#66866F', light: '#B9C99B' }, 7, 613)
      + path('M173 180Q264 128 349 196M151 300Q253 352 360 292', 'none', '#C4CB9D', 3),
      3200, 2900, [620, 580], ['树木', '海岸', '松树'], { blocksSight: true, renderLayer: 'canopy', shadowClass: 'vegetation' }),
    prop(pack, 'salt-shrub', '盐风厚叶灌丛', repeat(11, i => {
      const a = i * Math.PI * 2 / 11, x = n(256 + Math.cos(a) * 138), y = n(256 + Math.sin(a) * 126)
      return `<ellipse cx="${x}" cy="${y}" rx="101" ry="49" transform="rotate(${n(a * 180 / Math.PI)} ${x} ${y})" fill="${i % 2 ? '#9DAE89' : '#819C7B'}" stroke="${p.ink}" stroke-width="4"/>`
        + line(`M256 256L${x} ${y}`, '#C2CAA0', 3)
    }), 1600, 1400, [700, 550], ['灌木', '海岸', '植被'], { blocksMovement: false, shadowClass: 'vegetation' }),
    prop(pack, 'eroded-reef', '回凹海蚀礁石', path('M47 250L84 131L176 77L292 65L402 123L469 239L437 387L345 447L294 387L327 321L291 270L228 286L217 363L164 434L82 380Z', '#AAB3A0', p.ink, 7)
      + path('M84 131L176 158L292 65L316 179L402 123L390 255L469 239M82 380L150 287L217 363M327 321L390 255L437 387', 'none', '#7D9387', 5)
      + line('M107 155L155 112M196 111L253 94M109 319L119 357M369 374L400 348', '#D3CDB0', 6)
      + path('M257 102L243 169L264 205M143 226L175 240L168 281', 'none', '#667F76', 3),
      2400, 2200, [1850, 1550], ['礁石', '岩石', '不提供支撑面']),
    prop(pack, 'drift-log', '分叉漂流木', path('M48 231L92 188L224 195L300 121L338 102L354 122L303 175L278 218L439 241L467 286L437 325L278 294L207 361L164 403L136 390L170 344L213 280L78 283Z', '#A69C7C', p.ink, 6)
      + path('M84 245L240 242L321 140M245 246L433 282M237 266L173 365', 'none', '#D5C6A1', 5)
      + line('M111 221L137 272M358 256L367 302', '#7E8E7B', 3),
      2600, 1600, [2150, 1000], ['漂流木', '海岸']),
    detail(pack, 'rope-coil', '盘绕粗麻绳', repeat(6, i => `<ellipse cx="256" cy="253" rx="${198 - i * 24}" ry="${163 - i * 18}" fill="none" stroke="${i % 2 ? '#B5AB81' : '#D2C49B'}" stroke-width="17"/>`)
      + path('M317 347Q379 387 415 443M94 211Q50 170 71 105', 'none', '#D2C49B', 17)
      + repeat(12, i => line(`M${94 + i * 27} 115l-7 13`, '#938E70', 3)),
      1000, 1000, ['绳索', '渔具', '道具'], true),
    detail(pack, 'folded-net', '折叠菱格渔网', path('M66 111L413 72L451 374L178 445L51 325Z', '#A2AF95', p.dark, 5)
      + repeat(10, i => line(`M${69 + i * 35} 100L${125 + i * 32} 413`, '#D2C8A3', 3))
      + repeat(9, i => line(`M61 ${135 + i * 31}L433 ${94 + i * 33}`, p.ink, 2))
      + repeat(6, i => circle(103 + i * 55, 105 - i * 5, 14, '#B5A984', p.dark, 3)),
      1600, 1500, ['渔网', '渔具', '道具'], true),
    prop(pack, 'fish-basket', '柳编鱼篓', `<ellipse cx="256" cy="270" rx="185" ry="172" fill="#B5A57B" stroke="${p.ink}" stroke-width="7"/>`
      + `<ellipse cx="256" cy="248" rx="151" ry="123" fill="#718F86" stroke="#D1BE91" stroke-width="9"/>`
      + repeat(6, i => line(`M${111 + i * 58} 135Q${121 + i * 54} 285 ${121 + i * 54} 408`, '#D1BE91', 5))
      + repeat(5, i => line(`M89 ${198 + i * 42}Q256 ${240 + i * 42} 423 ${198 + i * 42}`, '#8D8D6E', 4))
      + path('M117 162Q167 41 256 48Q350 45 397 164', 'none', '#B5A57B', 17),
      1000, 1100, [750, 800], ['鱼篓', '渔具', '储物']),
    prop(pack, 'wooden-buoy', '旧木浮标道具', path('M181 85L256 40L331 85L373 318L333 426H179L139 318Z', '#B29B73', p.ink, 7)
      + path('M164 170H348L365 273H147Z', '#8CAAA3', p.dark, 5)
      + line('M256 56V407M190 102L170 311M319 102L342 311', '#D2C2A0', 3)
      + path('M192 426V454H320V426', 'none', p.dark, 13),
      650, 1250, [400, 850], ['浮标', '渔具', '装饰物件']),
    detail(pack, 'oar-pair', '交错木桨', path('M94 72L148 42L194 118L238 246L423 424L401 448L216 273L104 153Z', '#AF9C76', p.ink, 5)
      + path('M419 67L366 42L321 120L275 245L88 424L111 448L297 273L409 153Z', '#C0AD86', p.ink, 5)
      + line('M123 68L164 134L228 262L411 436M392 66L350 137L286 263L99 437', '#DDD0AE', 3),
      1800, 1800, ['木桨', '渔具', '道具'], true),
    detail(pack, 'shell-cluster', '贝壳与圆卵石', path('M62 220Q75 89 201 115Q288 170 229 272L170 310L116 278Z', '#DDCAA2', p.dark, 4)
      + line('M177 132L166 292M105 151L150 283M228 177L182 291', '#B3A382', 4)
      + path('M283 330Q259 217 365 205Q466 226 443 335L391 392H334Z', '#D0BFA1', p.dark, 4)
      + line('M363 223L364 378M308 248L346 375M420 259L382 376', '#A99C82', 4)
      + `<ellipse cx="149" cy="390" rx="56" ry="37" fill="#A9B4A0" stroke="${p.dark}" stroke-width="4"/>`,
      800, 800, ['贝壳', '卵石', '海滩'], true),
    detail(pack, 'reed-tuft', '岸边细芦苇簇', repeat(13, i => {
      const a = i * Math.PI * 2 / 13, x = n(256 + Math.cos(a) * 206), y = n(256 + Math.sin(a) * 206)
      return path(`M250 263Q${n(256 + Math.cos(a - .2) * 115)} ${n(256 + Math.sin(a - .2) * 115)} ${x} ${y}Q${n(256 + Math.cos(a + .1) * 130)} ${n(256 + Math.sin(a + .1) * 130)} 263 264Z`, i % 3 ? '#A3B78B' : '#C3C69A', p.dark, 2)
    }), 1400, 1300, ['芦苇', '植被', '海岸'], true),
    prop(pack, 'fish-crate', '开口渔货木箱', rect(47, 72, 418, 368, '#969C7E', p.ink, 8, 7)
      + rect(74, 100, 365, 310, '#657E74', p.dark, 3, 3)
      + repeat(5, i => path(`M${104 + i * 66} 150q-33 60 0 111q34 -51 0 -111Zm0 111l-21 32 39 -4Z`, ['#B8C5B6', '#9FB8AD', '#D3C9AA'][i % 3], p.ink, 3))
      + line('M61 83H450M62 427H449M65 96V414M450 96V414', '#BEB38D', 13),
      1300, 1100, [1050, 850], ['木箱', '渔货', '储物']),
    prop(pack, 'rowboat-decoration', '上岸空舟装饰', path('M256 27Q406 96 436 245Q438 385 256 485Q73 385 77 245Q105 97 256 27Z', '#9E9778', p.ink, 7)
      + path('M256 58Q378 116 405 248Q404 365 256 451Q109 365 108 248Q135 116 256 58Z', '#6C857C', p.dark, 5)
      + line('M256 65V447M143 172H370M121 282H393M167 385H348', '#C0AF89', 14)
      + path('M151 179Q126 279 177 375M362 179Q387 279 337 375', 'none', '#A69D7E', 4),
      1900, 4200, [1450, 3400], ['小舟', '海岸', '纯装饰', '不提供支撑或船舱']),
    prop(pack, 'quay-bollard', '圆顶系缆桩', rect(80, 80, 352, 352, '#8B9D8E', p.ink, 16, 7)
      + circle(256, 256, 139, '#96AAA2', p.ink, 7) + circle(256, 256, 111, '#AEBCAE', p.dark, 4)
      + path('M130 181Q255 99 383 181M134 329Q255 389 380 329', 'none', '#D2C8A4', 12)
      + repeat(4, i => circle(112 + i % 2 * 288, 112 + Math.floor(i / 2) * 288, 11, p.metal, p.ink, 3)),
      1000, 1000, [750, 750], ['系缆桩', '码头', '设施']),
  ]
}

/** Each pack contains six opaque repeating surfaces and fourteen individually
 * editable props. Membership is fixed; new art must use a new fixed identity.
 * These are source candidates until pixels, placement and scenes are reviewed. */
export const THEME_PACK_ART: Readonly<Record<ThemePackArtId, readonly VisualSampleArt[]>> = freezeJson({
  investigation: investigation(), modern: modern(), fantasy: fantasy(), ruins: ruins(), wilderness: wilderness(), coast: coast(),
})

export const THEME_PACK_LICENSE = 'Sceneweave Theme Pack Vector Candidates, version 1\nCopyright (c) 2026 Sceneweave contributors\n\nOriginal editable static SVG artwork created for Sceneweave with coding assistance. No reference-map pixels, external image assets or third-party artwork are embedded. This source batch is an art candidate and carries no P3 or user art approval.\n\n'
  + 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n'
  + 'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n'
  + 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
