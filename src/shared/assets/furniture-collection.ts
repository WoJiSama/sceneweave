import { freezeJson } from '../validation/json.js'

/** Discovery metadata contains no artwork or image bytes. A style is a design
 * family, not a claim of historical authenticity or an accepted art review. */
export const FURNITURE_CATEGORIES = [
  { id: 'bed', name: '床' }, { id: 'table', name: '桌' },
  { id: 'chair', name: '椅' }, { id: 'cabinet', name: '柜' },
] as const
export type FurnitureCategory = typeof FURNITURE_CATEGORIES[number]['id']
export const FURNITURE_ERAS = [
  { id: 'medieval', name: '中世纪生活' }, { id: 'fantasy', name: '西幻' }, { id: '1920s', name: '1920年代' },
] as const
export type FurnitureEra = typeof FURNITURE_ERAS[number]['id']
export interface FurnitureStyle {
  id: string; name: string; era: FurnitureEra
  /** One distinct plan/silhouette and construction for each role. */
  designs: Record<FurnitureCategory, string>
  sizes: Record<FurnitureCategory, readonly [number, number]>
  palette: readonly [wood: string, light: string, dark: string, cloth: string, trim: string]
}
const style = (id: string, name: string, era: FurnitureEra, designs: string[], sizes: readonly (readonly [number, number])[],
  palette: FurnitureStyle['palette']): FurnitureStyle => ({ id, name, era,
  designs: Object.fromEntries(FURNITURE_CATEGORIES.map((row, i) => [row.id, designs[i]])) as FurnitureStyle['designs'],
  sizes: Object.fromEntries(FURNITURE_CATEGORIES.map((row, i) => [row.id, sizes[i]])) as FurnitureStyle['sizes'], palette })

export const FURNITURE_STYLES: readonly FurnitureStyle[] = freezeJson([
  style('peasant', '乡野粗木', 'medieval', ['草褥板床', '拼板农舍桌', '独板靠背椅', '钉板矮柜'], [[1100, 2200], [1800, 1000], [600, 650], [1200, 600]], ['#9E7751', '#C5A77A', '#594634', '#B9AB7A', '#70654F']),
  style('farmstead', '农庄编绳', 'medieval', ['编绳框床', '楔榫长桌', '编绳座椅', '通风食物柜'], [[1250, 2200], [2100, 1000], [650, 650], [1300, 650]], ['#A88758', '#D1B77E', '#665239', '#A99E71', '#887B53']),
  style('wayside-inn', '路边旅舍', 'medieval', ['床尾储箱床', '双折叶酒桌', '围背酒馆椅', '双抽旅舍柜'], [[1300, 2400], [1500, 1100], [650, 700], [1500, 700]], ['#875E3E', '#BA9261', '#4C392C', '#A58562', '#8A7760']),
  style('cloister', '修道院', 'medieval', ['窄榻卷毯床', '狭长斋堂桌', '直背礼拜椅', '分格布草柜'], [[1000, 2150], [2600, 900], [570, 650], [1600, 600]], ['#817058', '#B4A181', '#50483B', '#B7B29B', '#77766A']),
  style('garrison', '边境驻军', 'medieval', ['铁箍营房床', '铁包角军务桌', '皮带折背椅', '铁闩军械柜'], [[1150, 2250], [1700, 1000], [650, 700], [1600, 750]], ['#78654A', '#AA936B', '#443E33', '#788173', '#656D68']),
  style('hunting-lodge', '北地猎屋', 'medieval', ['兽皮原木床', '年轮树桩桌', '鹿角皮面椅', '原木猎具柜'], [[1650, 2400], [1450, 1350], [850, 850], [1400, 750]], ['#866247', '#BA9370', '#49372E', '#A0937D', '#D0C4A0']),
  style('manor-lord', '领主雕花', 'medieval', ['雕花橡木床', '八角镶拼桌', '雕花扶手椅', '雕花双门柜'], [[1900, 2450], [1800, 1500], [850, 850], [1900, 800]], ['#825138', '#BD8A54', '#472F27', '#7A5651', '#B39B65']),
  style('royal', '王室帷帐', 'medieval', ['四柱帷帐床', '曲缘宴会桌', '鎏金王座椅', '曲腹宫廷柜'], [[2300, 2650], [2800, 1250], [1050, 1050], [2100, 850]], ['#81552E', '#D0A865', '#4B3225', '#8C4651', '#D4B571']),
  style('elven', '精灵枝蔓', 'fantasy', ['枝蔓叶舟床', '尖叶花瓣桌', '交枝藤背椅', '流线藤木柜'], [[1800, 2550], [2000, 1150], [800, 850], [1800, 800]], ['#8B9468', '#CCD0A2', '#4A6550', '#8FA89B', '#C5BE84']),
  style('dwarven', '矮人石铸', 'fantasy', ['切角石基床', '六角岩台桌', '石铸方背椅', '阶肩石木柜'], [[1800, 2300], [1700, 1500], [900, 850], [1800, 850]], ['#7B8180', '#B9B7A3', '#414D50', '#8D6860', '#BD935B']),
  style('halfling', '半身人圆木', 'fantasy', ['圆角围窝床', '豆形茶点桌', '圆环矮背椅', '弧腹餐边柜'], [[1550, 1900], [1450, 1000], [650, 650], [1500, 650]], ['#A57F4C', '#D6B776', '#655033', '#BCA06B', '#A1A477']),
  style('arcanist', '法师星仪', 'fantasy', ['六角符文床', '星仪八角桌', '菱晶高背椅', '六角秘仪柜'], [[1750, 2500], [1850, 1850], [850, 900], [1550, 900]], ['#71657F', '#B4A6B8', '#433B57', '#748597', '#C3AF80']),
  style('orcish', '兽人骨木', 'fantasy', ['骨柱皮绳床', '骨撑粗石桌', '兽骨缝皮椅', '肋骨皮革柜'], [[2100, 2700], [2100, 1550], [1100, 1000], [2000, 1000]], ['#7A6650', '#AD9573', '#423D34', '#8B7861', '#C9BD97']),
  style('gothic', '哥特尖拱', 'fantasy', ['尖拱帷边床', '四叶尖角桌', '尖冠高背椅', '尖肋窄长柜'], [[1700, 2550], [1800, 1500], [850, 850], [1700, 700]], ['#65575B', '#A58C86', '#39363F', '#756C84', '#A79A79']),
  style('draconic', '龙纹宫廷', 'fantasy', ['翼缘龙爪床', '翼角鳞纹桌', '龙角翼扶椅', '龙爪鳞片柜'], [[2400, 2700], [2200, 1600], [1150, 1050], [2100, 1000]], ['#82634D', '#B89A6D', '#483D33', '#728975', '#C9A95D']),
  style('fey', '妖精花萼', 'fantasy', ['花萼围瓣床', '菌伞圆面桌', '花瓣围背椅', '橡实荚形柜'], [[1900, 1900], [1350, 1350], [800, 800], [1300, 850]], ['#AE8E89', '#DFC3AD', '#685C64', '#B5B18D', '#D6BE80']),
  style('brass-period', '旧式黄铜', '1920s', ['黄铜栏杆床', '黄铜大理石圆桌', '弯管藤面椅', '黄铜玻璃药柜'], [[1550, 2300], [1200, 1200], [650, 700], [1400, 650]], ['#A68A54', '#D7C28A', '#62583E', '#C0B69B', '#DAC487']),
  style('white-iron', '白漆铁艺', '1920s', ['环栏铁管床', '搪瓷器械桌', '铁环座椅', '搪瓷器械柜'], [[1250, 2250], [1350, 800], [600, 650], [1200, 650]], ['#B8C1B4', '#E1E2CF', '#65766F', '#C4C5AD', '#9FAF9F']),
  style('arts-crafts', '工艺美术橡木', '1920s', ['格栅橡木床', '皮垫书写桌', '板条方扶椅', '格栅书卷柜'], [[1650, 2350], [1700, 950], [800, 800], [1700, 700]], ['#937044', '#C6A36E', '#54432F', '#7D8770', '#A69A70']),
  style('art-nouveau', '新艺术曲木', '1920s', ['卷草曲木床', '曲腰写字桌', '环藤曲背椅', '弧线镶花柜'], [[1800, 2450], [1700, 1050], [800, 800], [1700, 800]], ['#8C6550', '#C6A17B', '#4E3E35', '#8EA39A', '#BDA574']),
  style('art-deco', 'Art Deco', '1920s', ['阶梯几何床', '阶缘镶金桌', '扇形软垫椅', '阶梯黑漆柜'], [[1900, 2450], [1900, 1150], [850, 850], [1900, 800]], ['#635557', '#BCA482', '#37383F', '#81958B', '#D1B578']),
  style('old-estate', '旧庄园深木', '1920s', ['深木雕顶床', '椭圆镶木桌', '卷臂皮面椅', '鼓腹抽屉柜'], [[1950, 2450], [2100, 1200], [900, 900], [1800, 850]], ['#74533E', '#AA805C', '#3D302A', '#8B6A59', '#B59C6B']),
  style('boarding-house', '出租公寓', '1920s', ['抽屉单人床', '紧凑折叶桌', '折叠木靠椅', '转角储物柜'], [[1200, 2250], [1250, 900], [600, 650], [1200, 1000]], ['#9A8060', '#C4AD89', '#5C4D3C', '#A7A18A', '#988D72']),
  style('grand-hotel', '都会酒店', '1920s', ['扇贝软包床', '拼花圆茶桌', '簇扣软包椅', '行李托侧衣柜'], [[2150, 2500], [1250, 1250], [900, 900], [2100, 850]], ['#8A6651', '#C7A789', '#4E3D37', '#8E9D9C', '#CAB07E']),
])
export const furnitureAssetId = (key: string) => `furniture-collection-v1-art-${key}`
export const furnitureDefinitionId = (key: string) => `furniture-collection-v1-prop-${key}`
export const furnitureKey = (category: FurnitureCategory, styleId: string) => `${category}-${styleId}`
export function furnitureStyles(era: FurnitureEra | 'all' = 'all', styleId = 'all'): readonly FurnitureStyle[] {
  return FURNITURE_STYLES.filter(row => (era === 'all' || row.era === era) && (styleId === 'all' || row.id === styleId))
}
