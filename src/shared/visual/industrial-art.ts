import type { VisualSampleArt } from './sample-art.js'
import { freezeJson } from '../validation/json.js'

const seam = '#121A21', edge = '#687171'
const amber = '#FFD184', cyan = '#64F1DA', magenta = '#F889C5'
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`
const stroke = (d: string, color: string, width = 1, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${extra}/>`
const gradient = (id: string, first: string, last: string, middle?: string) =>
  `<linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${first}"/>${middle ? `<stop offset="0.40" stop-color="${middle}"/>` : ''}<stop offset="1" stop-color="${last}"/></linearGradient>`
const svg = (w: number, h: number, body: string, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
const repeat = (count: number, draw: (index: number) => string) => Array.from({ length: count }, (_, i) => draw(i)).join('')
const fastener = (x: number, y: number, radius = 3) => `<circle cx="${x}" cy="${y}" r="${radius + 1}" fill="#151F24"/><circle cx="${x}" cy="${y - 1}" r="${radius - 1}" fill="#95948B"/>${stroke(`M${x - 1} ${y}h2`, '#393E3B')}`
const rivets = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([a, b]) => fastener(a, b)).join('')
const grain = (seed: number, w: number, h: number, count: number) => repeat(count, i => {
  const a = Math.imul(i + 47, 0x1e35a7bd) ^ Math.imul(seed, 0x5851f42d)
  const b = Math.imul(a ^ (a >>> 14), 0x7feb352d) >>> 0
  return rect(b % w, (b >>> 13) % h, 1 + (b >>> 25) % 5, 1 + (b >>> 22) % 2, i % 3 ? '#C1C2AE' : '#080D12', 'opacity="0.13"')
})
function light(d: string, hue: string, power = 3): string {
  const round = 'stroke-linecap="round" stroke-linejoin="round"'
  return stroke(d, hue, power * 7, `${round} opacity="0.07"`) + stroke(d, hue, power * 4, `${round} opacity="0.14"`)
    + stroke(d, hue, power * 2, `${round} opacity="0.28"`) + stroke(d, hue, power, round) + stroke(d, '#FFF3CA', Math.max(1, power / 3), `${round} opacity="0.75"`)
}
function plate(x: number, y: number, w: number, h: number, fill = 'url(#steel)') {
  const bevel = Math.min(7, Math.floor(w / 4), Math.floor(h / 4)), horizontal = w - 2 * bevel, vertical = h - 2 * bevel
  const d = `M${x + bevel} ${y}h${horizontal}l${bevel} ${bevel}v${vertical}l-${bevel} ${bevel}h-${horizontal}l-${bevel} -${bevel}v-${vertical}Z`
  const insetX = Math.min(11, Math.floor(w / 4)), insetY = Math.min(9, Math.floor(h / 4))
  return `<path d="${d}" fill="${fill}" stroke="${seam}" stroke-width="2"/>`
    + stroke(`M${x + bevel + 1} ${y + 2}h${horizontal - 2}l${bevel} ${bevel}`, edge, 1.5, 'opacity="0.58"')
    + stroke(`M${x + bevel} ${y + h - 3}h${horizontal}`, '#080E13', 2, 'opacity="0.6"')
    + rivets(x + insetX, y + insetY, w - 2 * insetX, h - 2 * insetY)
}
function louver(x: number, y: number, w: number, h: number) {
  return rect(x, y, w, h, '#10191D', 'rx="4" stroke="#687269" stroke-width="1"')
    + repeat(Math.floor((h - 6) / 7), i => stroke(`M${x + 5} ${y + 5 + i * 7}h${w - 10}`, '#647477', 2, 'opacity="0.65"'))
}
const metal = gradient('steel', '#68777A', '#1F292E', '#3D494F')

function material(key: string, name: string, tile: number, body: string, defs = ''): VisualSampleArt {
  return { key, name, kind: 'material', widthMm: tile, heightMm: tile, sourceSvg: svg(256, 256, body, defs), tags: ['工业赛博朋克', '可平铺'] }
}
const asphalt = material('asphalt', '湿式玄灰沥青', 3200, rect(0, 0, 256, 256, '#333A40') + grain(15, 256, 256, 510)
  + repeat(12, i => stroke(`M${(i * 91) % 239} ${11 + i * 21}l8 -2 5 2`, i % 3 ? '#545752' : '#22282D', 1, 'opacity="0.34"')))
const deck = material('deck', '深钢桥面拼板', 2400, rect(0, 0, 256, 256, '#222D35')
  + repeat(4, i => rect(0, i * 64 + 2, 256, 59, 'url(#steel)') + stroke(`M0 ${i * 64 + 5}h256`, '#54646C', 2, 'opacity="0.65"')
    + stroke(`M${i % 2 ? 180 : 77} ${i * 64 + 3}v58`, '#141E25', 2) + rivets(9, i * 64 + 9, 238, 43)) + grain(28, 256, 256, 200),
  gradient('steel', '#404D55', '#2C373F', '#37424A'))
const platform = material('platform', '钛灰工业平台铺板', 3000, rect(0, 0, 256, 256, '#1B242A')
  + repeat(4, i => { const x = (i % 2) * 128, y = Math.floor(i / 2) * 128; return plate(x + 2, y + 2, 124, 124, 'url(#steel)')
    + stroke(`M${x + 8} ${y + 103}h112`, '#798281', 2, 'opacity="0.18"') }) + grain(6, 256, 256, 270),
  gradient('steel', '#515D61', '#3D474B', '#475155'))
const serviceFloor = material('service-floor', '磨损舱板', 5100, rect(0, 0, 256, 256, '#303B40')
  + [[0, 65, 84], [65, 72, 177], [137, 52, 121], [189, 67, 214]].map(([y, h, join], i) =>
    rect(0, y, 256, h, `url(#plate${i % 2})`)
    + stroke(`M0 ${y}h256M${join} ${y}v${h}`, '#151F25', 1.8, 'opacity=".72"')
    + stroke(`M0 ${y + 1.7}h256M${join + 1.5} ${y + 2}v${h - 2}`, '#82908B', .9, 'opacity=".24"')
    + [join - 5, join + 5].map(x => stroke(`M${x} ${y + 7}v3M${x} ${y + h - 10}v3`, '#141F26', 1.8)).join('')
  ).join('') + grain(47, 256, 256, 360) + repeat(28, i => {
    const x = (i * 79) % 251, y = (i * 53) % 249
    return stroke(`M${x} ${y}h${5 + i % 7}`, i % 3 === 0 ? '#151C21' : '#ABB4AD', .8, 'opacity=".12"')
  }), gradient('plate0', '#414D51', '#394449', '#3D494D') + gradient('plate1', '#3A454A', '#344047', '#3B464C'))
const serviceAsphalt = material('service-asphalt', '磨蚀湿沥青', 4700, rect(0, 0, 256, 256, '#292F35')
  + rect(0, 0, 256, 256, 'url(#wear)') + grain(11, 256, 256, 720)
  + repeat(16, i => stroke(`M${(i * 113) % 232} ${7 + i * 15}l${7 + i % 10} -1 5 2`, i % 3 ? '#5F625B' : '#0F1920', .85, 'opacity=".28"')),
  '<radialGradient id="wear" cx=".52" cy=".46" r=".52"><stop offset="0" stop-color="#42494A" stop-opacity=".65"/><stop offset="1" stop-color="#293036" stop-opacity="0"/></radialGradient>')
function rim(key: string, name: string, trim: string, bevel: string) {
  return material(key, name, 1600, rect(0, 0, 256, 256, '#171F26')
    + repeat(2, i => {
      const y = 128 * i
      return plate(3, y + 3, 250, 122, 'url(#steel)')
        + rect(19, y + 20, 218, 88, bevel)
        + rect(25, y + 24, 206, 80, '#29343C')
        + stroke(`M26 ${y + 29}h204`, trim, 3, 'opacity="0.8"')
        + rivets(10, y + 8, 236, 110)
        + repeat(9, j => stroke(`M${33 + j * 22} ${y + 48}v42`, bevel, 7))
    }) + grain(32, 256, 256, 180), metal)
}
const rivetedRim = rim('riveted-rim', '铆压钢平台收边板', '#AD8D59', '#505B5F')
const alloyRim = rim('alloy-rim', '青光合金平台收边板', '#52A999', '#374A51')
const grate = material('grate', '黑铁检修踏格', 1500, rect(0, 0, 256, 256, '#151E24')
  + repeat(16, i => rect(5 + i * 16, 0, 6, 256, '#4B585C') + rect(5 + i * 16, 0, 2, 256, '#6B797A') + rect(0, 6 + i * 16, 256, 3, '#35454C')))
const concrete = material('concrete', '冷灰压模混凝土', 2800, rect(0, 0, 256, 256, '#555D61') + grain(12, 256, 256, 420)
  + stroke('M0 60h256M0 188h256M61 0v256M189 0v256', '#31383F', 2)
  + stroke('M62 0v256M190 0v256M0 62h256M0 190h256', '#888C83', 1, 'opacity="0.6"'))

function prop(key: string, name: string, widthMm: number, heightMm: number, artWidth: number, artHeight: number,
  footprint: [number, number], body: string, options: { blocking?: boolean; sight?: boolean; layer?: 'ground' | 'object' | 'canopy'; defs?: string } = {}): VisualSampleArt {
  const { blocking = true, sight = false, layer = 'object', defs = '' } = options
  return { key, name, kind: 'prop', widthMm, heightMm, sourceSvg: svg(artWidth, artHeight, body, metal + defs),
    tags: ['工业赛博朋克'], footprintMm: { width: footprint[0], height: footprint[1] }, blocksMovement: blocking,
    blocksSight: sight, renderLayer: layer, shadowClass: blocking && layer !== 'ground' ? 'furniture' : 'none' }
}
function guard(key: string, name: string, hue: string, steel: boolean) {
  const body = rect(0, 22, 480, 43, '#0A1217', 'opacity="0.75"') + rect(0, 15, 480, 43, 'url(#steel)')
    + stroke('M0 17h480M0 58h480', '#809098', 2, 'opacity="0.60"')
    + repeat(5, i => plate(12 + i * 94, 20, 78, 31, steel ? '#34434C' : '#262E36'))
    + repeat(5, i => light(`M${32 + i * 94} ${steel ? 51 : 38}h40`, hue, steel ? 2 : 4))
    + repeat(4, i => plate(88 + i * 94, 10, 20, 55, '#424E53'))
  return prop(key, name, 2400, 440, 480, 78, [2380, 275], body)
}
const fence = prop('mesh-fence', '铆接网格围栏单节', 2400, 380, 480, 78, [2370, 210],
  rect(0, 20, 480, 40, '#243239', 'opacity="0.85"')
  + repeat(36, i => stroke(`M${i * 13} 23l12 31m2 -31l-12 31`, '#83938D', 1.5, 'opacity="0.62"'))
  + stroke('M0 20h480M0 58h480', '#70817D', 4) + plate(4, 8, 27, 60) + plate(449, 8, 27, 60) + plate(226, 13, 28, 49)
  + light('M16 31h10M454 31h10', amber, 3))
const gate = prop('gate-portal', '通道入口指示牌组', 3000, 460, 480, 78, [2890, 230],
  plate(2, 10, 476, 56) + rect(58, 16, 364, 44, '#242D34')
  + repeat(3, i => stroke(`M${151 + 65 * i} 25l16 14 -16 14`, cyan, 4)) + light('M69 38h48M362 38h49', amber, 4), { blocking: false, layer: 'ground' })
function roof(key: string, name: string, w: number, h: number, hue: string, kind: 'cooling' | 'truss' | 'switch') {
  const upstand = `<path d="M31 17H447L482 50V224L447 267H32L10 239V40Z" fill="#162127" stroke="#080D13" stroke-width="8"/>`
    + stroke('M35 18H445L482 51V220L448 266H35L11 238', '#627476', 3, 'opacity="0.63"')
    + plate(33, 31, 425, 217) + plate(62, 50, 367, 178, '#26343D') + grain(5 + w, 490, 282, 180)
    + repeat(9, i => plate(24 + i * 50, 239, 39, 33, '#313E45'))
    + repeat(5, i => plate(16, 45 + i * 37, 34, 31) + plate(441, 45 + i * 37, 34, 31))
  let modules: string
  if (kind === 'cooling') {
    modules = repeat(3, i => plate(81 + i * 109, 67, 94, 141) + louver(91 + i * 109, 81, 74, 109)
      + light(`M${101 + i * 109} 190v-98`, hue, 3) + stroke(`M${94 + i * 109} 79h70v110`, '#82A19A', 2))
  } else if (kind === 'truss') {
    modules = repeat(4, i => plate(79 + i * 83, 64, 72, 143, 'url(#roof)')
      + stroke(`M${95 + i * 83} 80v104l38 -104v104`, '#74867F', 2) + light(`M${93 + i * 83} 90v60`, hue, 3))
  } else {
    modules = plate(135, 60, 222, 152) + repeat(4, i => louver(152 + i * 48, 79, 42, 114))
      + light('M153 77h191M153 191h191', hue, 4) + stroke('M106 67v128M383 67v128', '#B09875', 7)
  }
  return prop(key, name, w, h, 492, 282, [w - 440, h - 410], upstand + modules
    + light('M57 62v-9h51M420 221v6h-59', hue, 3) + stroke('M74 237h333', '#B99C64', 2, 'opacity="0.7"'),
    { sight: true, defs: gradient('roof', '#556764', '#2C4549', '#365056') })
}
function pipe(key: string, name: string, w: number, h: number, lines: string[]) {
  return prop(key, name, w, h, 330, 140, [w - 155, h - 230], lines.map((d, i) =>
    stroke(d, '#0A141D', 32, 'stroke-linejoin="round"') + stroke(d, i % 2 ? '#386A66' : '#726A55', 25, 'stroke-linejoin="round"')
    + stroke(d, '#A0ACA0', 3, 'stroke-linejoin="round" opacity="0.55"') + stroke(d, '#183033', 8, 'stroke-linejoin="round" opacity="0.48"')).join('')
    + [14, 150, 306].map(x => plate(x, 26, 17, 68, '#40525A')).join('') + light('M79 98h38', cyan, 3), { blocking: false })
}
const tank = prop('coolant-tank', '青绿冷却压力罐', 3000, 2200, 300, 220, [2660, 1700],
  plate(16, 21, 268, 178) + rect(36, 47, 228, 132, 'url(#coolant)', 'rx="40" stroke="#748979" stroke-width="3"')
  + repeat(5, i => plate(56 + i * 41, 38, 15, 150, '#303D40')) + light('M41 90h32M228 90h28M47 143h32M225 143h30', cyan, 4)
  + stroke('M32 110h237', '#897355', 4) + louver(109, 10, 80, 56), { defs: gradient('coolant', '#78C3AF', '#1D3437', '#347F78') })
const transformer = prop('transformer', '配电整流机组', 2500, 1950, 275, 204, [2170, 1640],
  plate(5, 12, 265, 184) + plate(26, 34, 223, 143, '#313F46') + repeat(3, i => louver(35 + i * 70, 49, 61, 114))
  + light('M36 43h197', amber, 4) + light('M43 173h50M117 173h24', cyan, 3)
  + repeat(6,i=>stroke(`M${40 + i * 33} 190v-8`, '#E0AB66', 3)), { sight: true })
const ductFan = prop('roof-fan', '屋面轴流机与双辅扇', 2700, 1650, 288, 175, [2380, 1340],
  plate(8, 6, 272, 163) + [94, 211].map((x, i) => {
    const r = i ? 48 : 65
    return `<circle cx="${x}" cy="88" r="${r}" fill="#171F26" stroke="#839090" stroke-width="4"/>`
      + repeat(7, j => `<path d="M${x} 88q-11 -20 3 -${r - 14}q19 6 19 19Z" fill="#69767A" stroke="#323F48" stroke-width="2" transform="rotate(${(j * 360 / 7).toFixed(2)} ${x} 88)"/>`)
      + fastener(x, 88, 8)
  }).join('') + light('M36 144h30M226 39h19', amber, 3))
const streetLamp = prop('pole-lamp', '鹅颈琥珀路灯', 1100, 660, 180, 112, [285, 285],
  `<ellipse cx="61" cy="57" rx="23" ry="19" fill="#10181C" stroke="#737673" stroke-width="3"/>`
  + stroke('M59 56h29q11 0 17 -10l8 -12', '#151D23', 19, 'stroke-linecap="round"')
  + stroke('M59 54h29q11 0 17 -10l8 -12', '#83918B', 9, 'stroke-linecap="round"')
  + `<ellipse cx="122" cy="32" rx="38" ry="32" fill="url(#light)"/>` + light('M114 32h16', amber, 6),
  { defs: `<radialGradient id="light"><stop offset="0" stop-color="${amber}" stop-opacity="0.56"/><stop offset="1" stop-color="${amber}" stop-opacity="0"/></radialGradient>` })
function tube(key: string, name: string, hue: string) {
  return prop(key, name, 2500, 710, 410, 110, [2240, 280], plate(9, 22, 392, 68, '#283139')
    + stroke('M30 42h350M30 68h350', '#151B25', 13, 'stroke-linecap="round"') + light('M31 42h346M31 68h346', hue, 5)
    + repeat(5, i => plate(11 + i * 94, 44, 12, 21, '#3C4950')), { blocking: false })
}
const cable = prop('cable-rack', '桥侧布线架单节', 2400, 680, 330, 93, [2280, 490],
  plate(5, 11, 320, 72) + repeat(15, i => stroke(`M${21 + i * 20} 25v49`, '#758385', 2, 'opacity="0.53"'))
  + stroke('M8 36h315M8 43h315M8 56h315M8 63h315', '#17252B', 5)
  + stroke('M8 36h315M8 63h315', '#548C83', 2) + light('M146 54h38', magenta, 2), { blocking: false })
const hazard = prop('hazard-stripe', '琥珀危险界线单节', 2600, 520, 452, 90, [2580, 490],
  rect(1, 10, 450, 70, '#121C24', 'opacity="0.88"') + repeat(15, i => `<path d="M${i * 30} 79l25 -68h13l-24 68Z" fill="#B79455" opacity="0.78"/>`)
  + stroke('M1 12h448M1 80h448', '#D0AF70', 2, 'opacity="0.76"'), { blocking: false, layer: 'ground' })
const hatch = prop('access-hatch', '地面带灯检修盖', 1300, 1300, 160, 160, [1110, 1110],
  plate(9, 8, 142, 144, '#364751') + louver(23, 24, 114, 111) + light('M46 139h22M92 139h22', cyan, 3), { blocking: false, layer: 'ground' })
const haze = prop('haze', '雾青远景底图', 60000, 46000, 600, 460, [10, 10], rect(0, 0, 600, 460, 'url(#fog)')
  + repeat(14, i => {
    const x = (i * 83) % 600 - 20, y = 46 + (i * 101) % 395
    return `<path d="M${x} ${y}h45v-18h39v18h23v57h-10v17h-70v-13h-27Z" fill="#0B3440" opacity="0.30"/>`
      + repeat(5, j => stroke(`M${x + 8} ${y + 13 + j * 6}h90`, '#5EACB1', 1, 'opacity="0.18"'))
  }) + rect(0, 0, 600, 460, 'url(#mist)') + grain(82, 600, 460, 310), { blocking: false, layer: 'ground', defs:
    gradient('fog', '#162A34', '#10252E', '#297780') + '<radialGradient id="mist"><stop offset="0" stop-color="#56C7C1" stop-opacity="0.53"/><stop offset="1" stop-color="#1C5869" stop-opacity="0"/></radialGradient>' })

export const INDUSTRIAL_ART = freezeJson([
  asphalt, deck, platform, grate, concrete, rivetedRim, alloyRim, serviceFloor, serviceAsphalt,
  guard('amber-guard', '琥珀导光工业钢边梁', amber, true), guard('cyan-guard', '青绿连续合金边梁', cyan, false), fence, gate,
  roof('compressor-roof', '铆壳压缩机厂房屋面', 8200, 5150, cyan, 'cooling'),
  roof('sawtooth-roof', '双坡齿形吊运厂房屋面', 7400, 4650, amber, 'truss'),
  roof('switch-roof', '霓虹开关站屋面', 7100, 4600, magenta, 'switch'),
  pipe('pipe-straight', '双道冷却管直节', 3400, 1150, ['M0 40h330', 'M0 75h330']),
  pipe('pipe-elbow', '双道冷却管弯头', 3300, 1400, ['M0 40h220l72 57v25', 'M0 75h210l49 39v13']),
  tank, transformer, ductFan, streetLamp, tube('cyan-tube', '青绿双条霓虹灯', cyan), tube('pink-tube', '洋红双条霓虹灯', magenta), cable, hazard, hatch, haze,
])
