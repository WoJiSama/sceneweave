import type { CatalogItem } from '../../shared/library/types'

export const CATALOG_CATEGORIES = [
  { id: 'furniture', label: '家具' },
  { id: 'vegetation', label: '植被' },
  { id: 'rocks', label: '岩石' },
  { id: 'building', label: '建筑' },
  { id: 'ground', label: '地面' },
  { id: 'props', label: '道具' },
  { id: 'other', label: '其它' },
] as const

export type CatalogCategory = typeof CATALOG_CATEGORIES[number]['id']
type CategoryItem = Pick<CatalogItem, 'name' | 'publisherTags'> & { identity: Pick<CatalogItem['identity'], 'kind'> }

const building = /墙|围栏|栅栏|门窗|屋顶|屋檐|梁柱|石柱|台阶|楼梯|帐篷|\b(wall|fence|door|window|roof|pillar|stairs|tent)\b/i
const names: readonly [CatalogCategory, RegExp][] = [
  ['props', /桌灯|灯|火把|营火|篝火|书籍|叠书|手稿|纸张|信封|木箱|补给|酒桶|瓶|碗|杯|绳|墓碑|石棺|纪念|裂隙|\b(lamp|torch|campfire|book|paper|crate|barrel|bottle|tomb|sarcophagus)\b/i],
  ['furniture', /桌|椅|凳|床|柜|书架|衣架|木架|地毯|房毯|炉台|沙发|家具|\b(table|desk|chair|bench|bed|cabinet|shelf|furniture|rug|sofa)\b/i],
  ['building', building],
  ['vegetation', /树|灌|草|蕨|花|植被|盆栽|陶盆|叶簇|\b(tree|bush|shrub|grass|fern|plant|vegetation|foliage)\b/i],
  ['rocks', /岩|礁|碎石|石块|巨石|卵石|\b(rock|stone|boulder|pebble)\b/i],
  ['ground', /地面|铺装|地表|岸地|泥土|沙地|砂地|水面|海水|\b(ground|floor|surface|paving|sand|water)\b/i],
]

/** Browsing classification only: never changes fixed publisher tags or stored content. */
export function catalogCategory(item: CategoryItem, tags: readonly string[] = item.publisherTags): CatalogCategory {
  // A rock/grass texture belongs with surfaces, not with placeable rocks/plants.
  if (item.identity.kind === 'material') return building.test(item.name) ? 'building' : 'ground'
  for (const [category, pattern] of names) if (pattern.test(item.name)) return category
  for (const [category, pattern] of names) if (tags.some(tag => pattern.test(tag))) return category
  return 'other'
}

export function catalogSizeLabel(widthMm: number, heightMm: number): string {
  const meters = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value / 1000)
  return `${meters(widthMm)} × ${meters(heightMm)} m`
}
