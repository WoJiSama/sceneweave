import type { TerrainFacade } from '../../../shared/appearance/terrain-facade.js'

export type XY = [x: number, y: number]
export interface IndustrialLevel {
  title: string
  height: number
  platforms: [name: string, outline: XY[], elevation?: number, finish?: string][]
  facades?: [platform: string, profile: TerrainFacade['profile'], settings?: Partial<Omit<TerrainFacade, 'profile'>>][]
  bridge: [style: string, widthMm: number, centerline: XY[]]
  approaches: [platform: string, centerline: XY[], widthMm?: number][]
  walkways?: [name: string, platform: string, widthMm: number, centerline: XY[]][]
  entrances?: [room: string, widthMm: number, leadLengthMm: number, connection: XY[]][]
  stairs?: [start: string, from: XY, end: string, to: XY]
  fences?: [name: string, closed: boolean, centerline: XY[], openings: [fromMm: number, toMm: number][]][]
  platformFences: [platform: string, insetMm: number, edgeIndices?: number[]][]
  pipes?: [name: string, widthMm: number, centerline: XY[]][]
  rooms?: [name: string, platform: string, bounds: [number, number, number, number], purpose: string][]
  props: [art: string, x: number, y: number, rotationDeg: number, support: string][]
  groups?: [platform: string, x: number, y: number, rotationDeg: number][]
  gm: [text: string, x: number, y: number]
}
interface IndustrialLayout {
  file: string
  title: string
  access: [lower: XY, upper: XY]
  lower: IndustrialLevel
  upper: IndustrialLevel
}

const cooling: IndustrialLayout = {
  file: 'cooling-junction', title: '碧脉冷却枢纽', access: [[50200, 35500], [32500, 41300]],
  lower: {
    title: '冷却街与横桥', height: 1200,
    platforms: [
      ['west', [[2500,15800],[6000,11800],[18000,11800],[21100,14900],[21100,34300],[18600,37700],[3400,37700],[2500,35900]]],
      ['east', [[39000,17200],[42100,13800],[56600,13800],[58400,15600],[58400,37300],[55700,40200],[55000,40200],[46600,40200],[42500,40200],[39000,37100]]],
      ['service', [[46600,34700],[53900,34700],[55000,35900],[55000,40200],[55000,41200],[53800,42400],[46600,42400],[46600,40200]], 2150, 'grate'],
    ],
    facades: [
      ['west', 'ribbed-v1', { depthMm: 1460, pitchMm: 2270, facing: 'right', lightIntensity: .24 }],
      ['east', 'ribbed-v1', { depthMm: 1710, pitchMm: 2280, facing: 'right', lightIntensity: .23 }],
      ['service', 'ribbed-v1', { depthMm: 1620, pitchMm: 1920, facing: 'right', lightIntensity: .15 }],
    ],
    bridge: ['ember-bridge', 3200, [[20100,29400],[40000,29400]]],
    approaches: [ ['west', [[6700,29400],[19100,29400]]], ['east', [[40700,29400],[55600,29400]]]],
    walkways: [
      ['yard-gate', 'east', 1600, [[51200,29400],[51200,23350]]],
      ['service-stairs', 'east', 2120, [[50200,29400],[50200,32100]]],
    ],
    entrances: [['compressor', 1600, 850, [[9200,29400]]], ['relay', 1600, 780, [[15700,29400]]]],
    stairs: ['east', [50200,32500], 'service', [50200,35500]],
    fences: [
      ['yard', true, [[44500,16900],[55900,16900],[55900,25400],[44500,25400]], [[23500,26700]]],
    ],
    platformFences: [['west', 700], ['east', 700, [7, 8, 9, 0, 1, 2, 3, 4, 5]], ['service', 520]],
    pipes: [
      ['west-cooling', 1150, [[6700,34100],[10500,34100],[11800,35400],[15350,35400],[16780,34100]]],
      ['yard-loop', 980, [[48700,19700],[48700,18100],[52100,18100],[52100,19680]]],
    ],
    rooms: [ ['compressor', 'west', [5400,14300,13000,19300], '冷却机房'], ['relay', 'west', [12100,21300,19300,25200], '继电器间']],
    props: [
      ['transformer', 8350, 16200, 0, 'compressor'], ['access-hatch', 10750, 16100, 0, 'compressor'],
      ['coolant-tank', 15500, 22550, 0, 'relay'],
      ['gate-portal', 51150, 25500, 0, 'east'], ['hazard-stripe', 47500, 27200, 0, 'east'],
      ['roof-fan', 53400, 37250, 0, 'service'], ['access-hatch', 47850, 37000, 0, 'service'],
      ['cyan-tube', 50000, 37400, 90, 'service'], ['pink-tube', 42300, 33700, 90, 'east'],
      ['pole-lamp', 7650, 27320, 90, 'west'], ['pole-lamp', 12800, 32100, 270, 'west'],
      ['pole-lamp', 17350, 27250, 90, 'west'], ['pole-lamp', 43000, 26800, 0, 'east'], ['pole-lamp', 55750, 32300, 270, 'east'],
      ['coolant-tank', 5700, 34100, 90, 'west'], ['roof-fan', 17850, 34100, 0, 'west'],
      ['hazard-stripe', 9000, 31600, 0, 'west'], ['access-hatch', 11100, 26050, 0, 'west'], ['access-hatch', 55200, 26800, 0, 'east'],
    ],
    groups: [['east', 50300, 20500, 0]],
    gm: ['备用阀门可切断横桥导灯', 47700, 20700],
  },
  upper: {
    title: '高架冷却线与屋面', height: 5200,
    platforms: [
      ['north', [[25300,7100],[28200,3600],[39000,3600],[42700,6900],[42700,15700],[37400,17800],[24800,17800]]],
      ['south', [[27700,38000],[29400,35200],[39900,35200],[42700,37900],[42700,43500],[27700,43500]]],
      ['compressor-cap', [[4980,14100],[13200,14100],[13200,19400],[4980,19400]], 7020],
      ['relay-cap', [[11900,21000],[19500,21000],[19500,25700],[11900,25700]], 6860],
    ],
    facades: [['compressor-cap', 'glazed-v1', { depthMm: 3250, pitchMm: 1980, facing: 'right' }],
      ['relay-cap', 'ribbed-v1', { depthMm: 1450, lightColor: '#F18AA7', facing: 'right' }],
      ['north', 'girder-v1'], ['south', 'girder-v1']],
    bridge: ['ion-bridge', 3600, [[32500,15200],[32500,38100]]],
    approaches: [['north', [[32500,5800],[32500,14600]]], ['south', [[32500,38800],[32500,41500]]]],
    platformFences: [['north', 700], ['south', 700]],
    pipes: [
      ['north-return', 900, [[28000,10500],[28000,13250],[26900,14350],[26900,16200]]],
      ['south-return', 920, [[38500,40250],[38500,38100],[40100,38100]]],
    ],
    props: [
      ['compressor-roof', 9150, 16750, 0, 'compressor-cap'], ['sawtooth-roof', 15700, 23390, 0, 'relay-cap'],
      ['switch-roof', 37850, 10100, 90, 'north'], ['coolant-tank', 28000, 9200, 90, 'north'],
      ['cyan-tube', 34950, 8700, 90, 'north'],
      ['pole-lamp', 30300, 8230, 0, 'north'], ['pole-lamp', 36900, 13900, 180, 'north'],
      ['roof-fan', 38500, 40900, 0, 'south'],
      ['transformer', 29500, 40900, 90, 'south'], ['gate-portal', 32600, 41800, 0, 'south'], ['cyan-tube', 40100, 41100, 90, 'south'],
      ['hazard-stripe', 32500, 6480, 0, 'north'], ['pink-tube', 11600, 18300, 0, 'compressor-cap'], ['cyan-tube', 14300, 21750, 0, 'relay-cap'],
    ],
    gm: ['高架通风井的备用控制面板', 37800, 40800],
  },
}

const freight: IndustrialLayout = {
  file: 'freight-loop', title: '暮港吊运环线', access: [[32000, 35300], [52900, 24700]],
  lower: {
    title: '斜接运料道', height: 1400,
    platforms: [
      ['north', [[8300,4600],[11800,2300],[34300,2300],[36700,4700],[36700,14100],[28000,17500],[13700,17200],[8300,13500]]],
      ['south', [[17100,32200],[22200,30000],[41200,30000],[45900,34300],[45900,42600],[41400,44700],[18500,44700],[16100,42700]]],
      ['gantry', [[10200,8450],[15500,8450],[15500,11800],[14000,13100],[10300,13100]], 2450, 'grate'],
    ],
    facades: [
      ['north', 'ribbed-v1', { depthMm: 1610, pitchMm: 2260, facing: 'right', lightIntensity: .26 }],
      ['south', 'ribbed-v1', { depthMm: 890, pitchMm: 2250, facing: 'right', lightIntensity: .22 }],
      ['gantry', 'ribbed-v1', { depthMm: 820, pitchMm: 1700, facing: 'right', lightIntensity: .12 }],
    ],
    bridge: ['ion-bridge', 3100, [[25400,15500],[23300,22200],[28300,32000]]],
    approaches: [['north', [[29300,8300],[26000,15000]], 2700], ['south', [[28500,32500],[31600,39400]], 3700]],
    walkways: [
      ['yard-gate', 'south', 1460, [[29000,33600],[31450,32180],[32400,31900],[38200,31900],[39100,32500],[39300,33250],[39300,36100]]],
    ],
    entrances: [
      ['dispatch', 1600, 850, [[23700,11640],[27300,12360]]],
      ['store', 1600, 750, [[25550,42360],[27500,42380],[28200,42000],[28950,41150],[30300,39900]]],
    ],
    stairs: ['north', [12700,6200], 'gantry', [12700,9300]],
    fences: [
      ['yard', true, [[34200,33400],[43500,33400],[43500,42300],[34200,42300]], [[3150,6850]]],
    ],
    platformFences: [['north', 700], ['south', 700]],
    pipes: [
      ['dispatch-feed', 1130, [[23100,5780],[25250,5780],[26900,4820],[31400,4820],[33100,6190],[33100,7340]]],
      ['yard-return', 980, [[40200,38300],[40200,36200],[42600,36200],[42600,40000]]],
    ],
    rooms: [ ['dispatch', 'north', [16100,5070,23100,9700], '调度室'], ['store', 'south', [19700,35400,27100,40500], '吊运备料库']],
    props: [
      ['transformer', 19200, 6490, 0, 'dispatch'], ['roof-fan', 22100, 37400, 0, 'store'],
      ['access-hatch', 24500, 37200, 0, 'store'],
      ['transformer', 33100, 8400, 90, 'north'], ['coolant-tank', 19000, 13500, 0, 'north'], ['cyan-tube', 33000, 11600, 0, 'north'],
      ['pole-lamp', 29600, 12600, 270, 'north'], ['pole-lamp', 25300, 9450, 20, 'north'], ['pole-lamp', 17600, 11250, 0, 'north'],
      ['hazard-stripe', 29790, 7330, 26, 'north'],
      ['roof-fan', 12500, 11450, 0, 'gantry'], ['cyan-tube', 14020, 11050, 90, 'gantry'],
      ['gate-portal', 39140, 33100, 0, 'south'], ['pink-tube', 42900, 39400, 90, 'south'],
      ['pole-lamp', 32700, 34900, 180, 'south'], ['pole-lamp', 32150, 42600, 270, 'south'], ['access-hatch', 33900, 41800, 0, 'south'],
      ['hazard-stripe', 33450, 31550, 0, 'south'], ['hazard-stripe', 32230, 40720, 336, 'south'],
    ],
    groups: [['south', 39150, 39050, 0]],
    gm: ['备料库后墙可停用吊运信号', 34600, 41300],
  },
  upper: {
    title: '吊运高线与站房屋面', height: 5600,
    platforms: [
      ['west', [[7700,19500],[10200,17200],[17200,17200],[20400,18600],[21100,25000],[18400,29200],[9000,29200],[7700,27300]]],
      ['east', [[38600,23200],[42300,17800],[53700,16700],[55800,18800],[55800,29100],[53600,31300],[42600,31300],[39000,28300]]],
      ['dispatch-cap', [[15800,4900],[23400,4900],[23400,9900],[15800,9900]], 7010],
      ['store-cap', [[19300,35300],[27500,35300],[27500,40600],[19300,40600]], 7010],
    ],
    facades: [['dispatch-cap', 'glazed-v1', { depthMm: 3300, pitchMm: 1740, lightColor: '#75FFD0', facing: 'right' }],
      ['store-cap', 'ribbed-v1', { depthMm: 2250, lightColor: '#67EDD1', facing: 'right' }], ['east', 'ribbed-v1', { depthMm: 3800, facing: 'right', lightIntensity: .48 }],
      ['west', 'ribbed-v1', { depthMm: 2730, pitchMm: 2010, facing: 'right', lightIntensity: .37 }]],
    bridge: ['ember-bridge', 3450, [[18300,21100],[26500,21600],[34900,24700],[41650,24900]]],
    approaches: [['west', [[10150,21900],[18300,21100]]], ['east', [[41650,24900],[52900,24700]]]],
    platformFences: [['west', 700], ['east', 700]],
    pipes: [
      ['east-intake', 940, [[46060,27800],[47050,27800],[48050,28900],[50900,28900],[52050,27750],[53020,27750]]],
    ],
    props: [
      ['sawtooth-roof', 19600, 7450, 0, 'dispatch-cap'], ['compressor-roof', 23300, 37950, 0, 'store-cap'],
      ['switch-roof', 13400, 25300, 0, 'west'], ['hazard-stripe', 11000, 19550, 0, 'west'],
      ['gate-portal', 10350, 21700, 90, 'west'], ['pole-lamp', 15850, 19350, 90, 'west'],
      ['coolant-tank', 46550, 20650, 0, 'east'], ['roof-fan', 52500, 19500, 0, 'east'],
      ['cyan-tube', 46000, 21100, 0, 'east'], ['pink-tube', 49400, 28140, 0, 'east'], ['access-hatch', 53500, 27750, 90, 'east'],
      ['pole-lamp', 47000, 26800, 0, 'east'], ['pole-lamp', 52600, 26750, 0, 'east'], ['transformer', 45000, 27800, 0, 'east'],
      ['cyan-tube', 21600, 39400, 0, 'store-cap'], ['hazard-stripe', 52600, 24800, 90, 'east'],
    ],
    gm: ['吊车停泊控制器位于北侧屋面', 45200, 20300],
  },
}

export const INDUSTRIAL_LAYOUTS = [cooling, freight] as const
