import { freezeJson } from '../validation/json.js'

/** Finite production scope. Targets are never availability or art acceptance.
 * Cross-scene use points to one category; derivatives do not add base designs. */
export interface SceneCollectionCategory {
  id: string
  name: string
  target: number
  tier: 'major' | 'detail' | 'material'
}
export interface SceneCollectionGroup { id: string; name: string; categories: readonly SceneCollectionCategory[] }
const group = (id: string, name: string, major: readonly (readonly [string, string, number?])[],
  detail: readonly (readonly [string, string])[] = []): SceneCollectionGroup => ({ id, name,
  categories: [...major.map(([id, name, target = 24]) => ({ id, name, target, tier: 'major' as const })),
    ...detail.map(([id, name]) => ({ id, name, target: 8, tier: 'detail' as const }))] })

export const SCENE_COLLECTION_GROUPS: readonly SceneCollectionGroup[] = freezeJson([
  group('architecture', '建筑与户外构件', [
    ['door', '门'], ['window', '窗'], ['column', '柱'], ['arch', '拱门'], ['fence', '围栏'], ['railing', '栏杆'],
    ['stairs', '楼梯'], ['bridge', '桥'], ['roof', '屋顶'], ['chimney', '烟囱'],
  ], [['door-trim', '门框装饰'], ['shutter', '窗板'], ['eave-trim', '檐饰']]),
  group('furnishing', '家具与室内陈设', [
    ['bed', '床'], ['table', '桌'], ['chair', '椅'], ['stool', '凳'], ['bench', '长凳'], ['cabinet', '柜'],
    ['bookshelf', '书架'], ['sofa', '沙发与软座'], ['screen', '屏风'], ['rug', '地毯'], ['curtain', '帷幔'], ['mirror', '镜子'],
  ], [['wall-picture', '壁画与挂画']]),
  group('kitchen', '厨房、餐饮与酿造', [
    ['stove', '灶台'], ['oven', '烤炉'], ['prep-counter', '备餐台'], ['sink', '水槽'], ['bar-counter', '吧台'],
    ['wine-rack', '酒架'], ['brew-vessel', '酿造容器'],
  ], [['pot', '锅具'], ['tableware', '餐具'], ['food', '食物'], ['bottle', '酒瓶与饮料容器']]),
  group('wash', '卫浴、清洁与洗衣', [
    ['bathtub', '澡盆与浴缸'], ['washstand', '盥洗台'], ['toilet', '便器与茅厕设施'], ['laundry-trough', '洗衣槽'], ['drying-rack', '晾衣架'],
  ], [['ewer', '水壶'], ['towel', '毛巾与布草'], ['cleaning-tool', '清洁刷具']]),
  group('lighting', '照明与供热', [
    ['chandelier', '吊灯'], ['wall-lamp', '壁灯'], ['table-lamp', '台灯'], ['floor-lamp', '落地灯'], ['lantern', '提灯'],
    ['candelabrum', '烛台'], ['brazier', '火盆'], ['fireplace', '壁炉'],
  ], [['firewood', '柴薪'], ['coal-scuttle', '煤斗']]),
  group('storage', '仓储、贸易与货物', [
    ['chest', '箱'], ['barrel', '桶'], ['basket', '篮'], ['sack', '袋'], ['shelf', '货架'], ['shop-counter', '柜台'], ['market-stall', '摊位'],
  ], [['merchandise', '货品'], ['trade-scale', '秤具'], ['cargo-label', '货签'], ['packing', '包装']]),
  group('farm', '农牧与乡村', [
    ['haystack', '草垛'], ['granary', '粮仓'], ['well', '水井'], ['watering-trough', '饮水槽'], ['pen', '畜栏'], ['coop', '鸡舍'], ['beehive', '蜂箱'],
  ], [['farm-tool', '农具'], ['fodder', '饲料'], ['crop-row', '成行作物']]),
  group('workshop', '生产工坊与工业', [
    ['workbench', '工作台'], ['anvil', '铁砧'], ['forge', '锻炉'], ['bellows', '风箱'], ['loom', '织机'], ['spinning-wheel', '纺车'],
    ['kiln', '陶窑'], ['millstone', '磨盘'], ['sawbench', '锯台'], ['machine-tool', '机床与发动机台'],
  ], [['craft-tool', '工艺工具'], ['work-in-progress', '半成品']]),
  group('adventure', '军事、地牢与野营', [
    ['tent', '帐篷'], ['bedroll', '铺盖'], ['weapon-rack', '武器架'], ['armor-rack', '盔甲架'], ['barricade', '路障'],
    ['cheval-de-frise', '拒马'], ['target', '靶架'], ['cage', '笼具'], ['cell-gate', '牢门'], ['trap', '机关构件'],
  ], [['camp-kit', '营具'], ['exploration-supply', '探险物资']]),
  group('ritual', '宗教、魔法与墓葬', [
    ['altar', '祭坛'], ['statue', '神像'], ['sarcophagus', '石棺'], ['headstone', '墓碑'], ['offering-table', '供桌'],
    ['pulpit', '讲坛'], ['alchemy-bench', '炼金台'], ['crystal-device', '水晶装置'],
  ], [['magic-circle', '法阵'], ['relic', '圣物'], ['potion', '药剂'], ['scroll-book', '书卷']]),
  group('nature', '自然地貌与植被', [
    ['tree', '树木', 30], ['shrub', '灌木', 30], ['rock', '岩石', 30], ['fallen-log', '倒木'], ['stump', '树桩'], ['stalagmite', '洞穴石笋'],
  ], [['grass-clump', '草丛'], ['fern-clump', '蕨丛'], ['flower-clump', '花丛'], ['fungus-clump', '菌簇'],
    ['reed-clump', '芦苇'], ['leaf-litter', '枝叶'], ['shore-detail', '岸边小物']]),
  group('transport', '交通、街道与公共设施', [
    ['wagon', '马车', 20], ['handcart', '手推车', 20], ['boat', '舟船', 20], ['period-car', '1920年代汽车', 20],
    ['motorcycle', '1920年代摩托', 20], ['bicycle', '自行车', 20], ['rail-vehicle', '轨道车辆', 20],
    ['fountain', '喷泉'], ['street-sign', '路牌'], ['street-lamp', '路灯'], ['dock-post', '码头桩'], ['loading-rig', '装卸设施'],
  ]),
  group('period-equipment', '1920年代专用设备', [
    ['archive-unit', '档案设施'], ['safe', '保险柜'], ['medical-unit', '诊疗设备'], ['laboratory-unit', '实验设备'],
    ['piano', '钢琴'], ['billiard-table', '台球桌'],
  ], [['telephone', '电话'], ['typewriter', '打字机'], ['gramophone', '留声机'], ['radio', '收音机'], ['camera', '摄影器材']]),
  { id: 'surfaces-traces', name: '地材、痕迹与破坏细节', categories: [
    ...[['wood-surface', '木地材'], ['stone-surface', '石地材'], ['brick-surface', '砖地材'], ['earth-surface', '泥土地材'],
      ['sand-surface', '沙地材'], ['grass-surface', '草地材'], ['snow-surface', '雪冰地材'], ['water-surface', '水面材质']]
      .map(([id, name]) => ({ id, name, target: 8, tier: 'material' as const })),
    ...[['footprint', '脚印'], ['drag-mark', '拖痕'], ['blood-trace', '血迹'], ['soot', '烟灰'], ['cobweb', '蛛网'],
      ['broken-glass', '碎玻璃'], ['scattered-paper', '散纸'], ['rubble', '瓦砾']]
      .map(([id, name]) => ({ id, name, target: 8, tier: 'detail' as const })),
  ] },
])

export interface SceneCollectionScenario { id: string; name: string; era: 'medieval' | 'fantasy' | '1920s'; categories: readonly string[] }
const scene = (id: string, name: string, era: SceneCollectionScenario['era'], categories: string): SceneCollectionScenario =>
  ({ id, name, era, categories: categories.split(' ') })
export const SCENE_COLLECTION_SCENARIOS: readonly SceneCollectionScenario[] = freezeJson([
  scene('home-courtyard', '民居庭院', 'medieval', 'door window bed table chair cabinet stove washstand lantern chest well crop-row firewood'),
  scene('tavern-kitchen', '酒馆旅舍后厨', 'medieval', 'stove oven prep-counter sink bar-counter wine-rack barrel shelf pot food tableware lantern'),
  scene('market-warehouse', '集市仓库', 'medieval', 'market-stall shop-counter shelf chest barrel basket sack merchandise trade-scale packing'),
  scene('farm-stable', '农场马厩', 'medieval', 'haystack granary well watering-trough pen coop beehive farm-tool fodder crop-row'),
  scene('craft-workshop', '铁匠与木匠工坊', 'medieval', 'workbench anvil forge bellows sawbench craft-tool work-in-progress shelf barrel'),
  scene('gate-garrison', '城门军营', 'medieval', 'door arch fence stairs tent bedroll weapon-rack armor-rack barricade cheval-de-frise target brazier'),
  scene('cloister-church', '修道院教堂', 'medieval', 'arch column bench pulpit altar statue offering-table candelabrum scroll-book curtain'),
  scene('castle-hall', '城堡领主厅', 'medieval', 'door window column table chair bench rug curtain fireplace chandelier statue weapon-rack'),
  scene('woodland-camp', '林地营地', 'fantasy', 'tree shrub rock tent bedroll brazier chest camp-kit exploration-supply fallen-log grass-clump'),
  scene('mountain-outpost', '山路废哨', 'fantasy', 'rock stairs railing door barricade weapon-rack chest lantern rubble soot'),
  scene('cavern-lair', '洞穴巢穴', 'fantasy', 'rock stalagmite fungus-clump cage chest brazier exploration-supply cobweb rubble'),
  scene('dungeon-prison', '地牢监牢', 'fantasy', 'door cell-gate cage trap bedroll barrel lantern exploration-supply drag-mark rubble'),
  scene('tomb-sanctum', '墓穴祭室', 'fantasy', 'column altar statue sarcophagus headstone offering-table relic candelabrum cobweb rubble'),
  scene('arcane-workroom', '法师与炼金工房', 'fantasy', 'alchemy-bench crystal-device bookshelf workbench shelf magic-circle potion scroll-book relic lantern'),
  scene('elven-home', '精灵林居', 'fantasy', 'tree shrub bed table chair bookshelf screen basket lantern flower-clump'),
  scene('dwarven-mine', '矮人矿坑', 'fantasy', 'rock column railing forge anvil workbench handcart loading-rig lantern craft-tool'),
  scene('period-apartment', '公寓旧宅', '1920s', 'door window bed sofa table chair cabinet bathtub washstand toilet table-lamp rug radio'),
  scene('agency-archive', '事务所档案室', '1920s', 'table chair archive-unit safe bookshelf floor-lamp telephone typewriter scroll-book scattered-paper'),
  scene('clinic-laboratory', '诊所实验室', '1920s', 'medical-unit laboratory-unit sink screen shelf table-lamp cleaning-tool potion'),
  scene('hotel-restaurant', '酒店餐厅', '1920s', 'table chair sofa bar-counter chandelier rug curtain wine-rack tableware food'),
  scene('bar-alley', '酒吧后巷', '1920s', 'bar-counter wine-rack piano billiard-table gramophone barrel street-lamp bottle broken-glass'),
  scene('period-store', '商铺仓库', '1920s', 'shop-counter shelf safe chest basket sack trade-scale merchandise packing loading-rig'),
  scene('garage-repair', '车库修理铺', '1920s', 'period-car motorcycle bicycle machine-tool workbench shelf craft-tool barrel street-sign'),
  scene('station-harbor', '车站与码头', '1920s', 'rail-vehicle boat handcart loading-rig dock-post street-lamp street-sign chest sack packing'),
])

// Contract mistakes must fail at authoring/discovery, before any artwork load.
const categories = SCENE_COLLECTION_GROUPS.flatMap(group => group.categories)
const ids = new Set(categories.map(row => row.id))
if (ids.size !== categories.length || new Set(SCENE_COLLECTION_GROUPS.map(row => row.id)).size !== SCENE_COLLECTION_GROUPS.length
  || SCENE_COLLECTION_SCENARIOS.some(row => row.categories.some(id => !ids.has(id)))
  || categories.some(row => row.target < (row.tier === 'major' ? 20 : 6))) throw new Error('全场景素材规划含重复、缺失引用或不足的类别目标。')
export const SCENE_COLLECTION_CATEGORIES: readonly SceneCollectionCategory[] = freezeJson(categories)
