import { THEME_PACK_PLANS } from './theme-packs.js'
import { cloneJson, freezeJson } from '../validation/json.js'
import type { ThemePackArtId } from '../visual/theme-pack-art.js'

export type { ThemePackArtId } from '../visual/theme-pack-art.js'
const planIds: Record<ThemePackArtId, string> = { investigation: 'period-investigation', modern: 'modern-city',
  fantasy: 'fantasy-town', ruins: 'underground-ruins', wilderness: 'temperate-wilderness', coast: 'coastal-settlement' }
/** Lightweight discovery metadata. The source artwork and browser provider are
 * imported only by the explicit load operation; this module has no image bytes. */
export const THEME_PACK_CATALOGS = freezeJson((Object.keys(planIds) as ThemePackArtId[]).map(id => {
  const plan = THEME_PACK_PLANS.find(value => value.id === planIds[id])!
  return { id, planId: plan.id, name: plan.name, axes: cloneJson(plan.axes), fixedVersion: id === 'wilderness' ? 2 : 1,
    availability: 'candidate' as const, discovery: 'listed' as const,
    counts: id === 'wilderness' ? { materials: 7, props: 21, prefabs: 5 } : { materials: 6, props: 14, prefabs: 3 },
    scenarios: plan.scenarios.map(value => ({ id: value.id, name: value.name })) }
}))
