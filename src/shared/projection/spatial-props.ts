import { resolvePropContact } from '../attachments/contact.js'
import type { Prop, SceneDocument } from '../model/scene.js'
import type { Projection } from './types.js'
import { reliefBounds, sampleTerrainRelief } from '../geometry/terrain-relief.js'
import type { PropVolume } from '../model/prop-volume.js'

export interface ProjectedPropVolume extends PropVolume { baseMm: number }

const has = (tags: readonly string[], options: readonly string[]) => options.some(option => tags.includes(option))
const limited = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** Only approved instances are passed in. Heights of existing explicit contacts
 * come from the attachment solver, including chains of supported objects. */
export function projectPropVolumes(scene: SceneDocument, projection: Projection): Record<string, ProjectedPropVolume> {
  const tops = new Map<string, number>()
  const visible = new Set(projection.props.map(prop => prop.id))
  for (const surface of Object.values(scene.attachmentSurfaces ?? {})) {
    if (surface.feature.kind === 'propTop' && visible.has(surface.owner.id) && surface.capabilities.includes('support')) {
      tops.set(surface.owner.id, Math.max(tops.get(surface.owner.id) ?? 0, surface.feature.heightLocalMm))
    }
  }
  const attached = new Set(Object.values(scene.attachments ?? {}).filter(row => row.mode !== 'embed' && visible.has(row.child.id)).map(row => row.child.id))
  const levels = new Map([...projection.terrain, ...projection.rooms].map(surface => [surface.id, surface]))
  const boxes = new Map(projection.terrain.filter(surface => surface.relief).map(surface => [surface.id, reliefBounds(surface.points)]))
  return Object.fromEntries(projection.props.map(prop => {
    const surface = levels.get(prop.supportRef.id)
    const offset = surface?.relief ? sampleTerrainRelief(surface.relief, boxes.get(surface.id)!, prop.positionMm).offsetMm : 0
    const baseMm = attached.has(prop.id) ? resolvePropContact(scene, prop.id).contactElevationMm : (surface?.elevationMm ?? 0) + offset
    const definition = prop.definitionRef ? scene.propDefinitions[prop.definitionRef.id] : undefined
    const tags = definition?.tags ?? []
    const shape = prop.volume ?? definition?.defaultVolume ?? defaultVolume(prop, tags)
    const brush = prop.appearance.kind === 'image' ? projection.materialBrushes?.[prop.appearance.assetId] : undefined
    let kind = shape.kind
    if (!prop.volume && !definition?.defaultVolume && kind === 'box' && (brush === 'wood' || brush === 'cloth')) {
      if (has(tags, ['table', 'desk', '小桌', '圆桌', '书桌'])) kind = 'table'
      else if (has(tags, ['chair', 'seat', 'stool', '椅', '木椅'])) kind = 'seat'
    }
    const supportTop = tops.get(prop.id)
    return [prop.id, { ...shape, baseMm, kind: supportTop && kind === 'flat' ? 'box' : kind, heightMm: supportTop ?? shape.heightMm }]
  }))
}

export function projectSpatialProps(scene: SceneDocument, projection: Projection): void {
  const propVolumes = projectPropVolumes(scene, projection)
  projection.propVolumes = propVolumes
  const sideAssets = Object.values(propVolumes).flatMap(volume => volume.sideAssetId ?? [])
  if (sideAssets.length) projection.assetIds = [...new Set([...projection.assetIds, ...sideAssets])].sort()
}

export function defaultVolume(prop: Prop, tags: readonly string[]): PropVolume {
  if (prop.volume) return prop.volume
  const { appearance, footprintMm, visualBoundsMm } = prop
  const width = Math.min(footprintMm.width, footprintMm.height), span = Math.min(visualBoundsMm.width, visualBoundsMm.height)
  const role = appearance.kind === 'symbol' ? appearance.symbol : undefined
  const art = appearance.kind === 'symbol' ? appearance.bridgeArt : undefined
  if (prop.renderLayer === 'ground' || role === 'rug') return { kind: 'flat', heightMm: 0 }
  if (prop.renderLayer === 'canopy' || has(tags, ['树木', '树', 'tree'])) return { kind: 'tree', heightMm: limited(span * .9, 900, 6500) }
  if (art && /rail|fence|guard/.test(art)) return { kind: 'rail', heightMm: 1050 }
  if (art && /post|light|lamp/.test(art)) return { kind: 'lamp', heightMm: 950 }
  if (role === 'table' || has(tags, ['桌子', '餐桌'])) return { kind: 'table', heightMm: 780 }
  if (role === 'chair' || has(tags, ['凳子', '椅子', '座具', '石凳'])) return { kind: 'seat', heightMm: 470 }
  if (has(tags, ['小舟', '漂流木', '倒木', '床', '沙发'])) return { kind: 'box', heightMm: limited(width * .42, 220, 720) }
  if (has(tags, ['帐篷'])) return { kind: 'tent', heightMm: limited(span * .68, 700, 2400) }
  if (has(tags, ['岩石', '岩块', '巨石', '礁石', 'rock', '灌木', 'shrub'])) return { kind: 'rock', heightMm: limited(span * .36, 60, 2200) }
  if (has(tags, ['桶', '骨灰罐', '炊具', '粮袋', '鱼篓', '柱', '石柱'])) return { kind: 'round', heightMm: limited(width * .8, 160, 1500) }
  if (has(tags, ['照明', '灯具', '蜡烛', '火盆'])) return { kind: 'lamp', heightMm: limited(width * .85, 100, 550) }
  if (role === 'shelf' || has(tags, ['书架', '货架', '档案柜', '石像'])) return { kind: 'box', heightMm: limited(width * 2.3, 700, 2350) }
  if (role === 'crate' || has(tags, ['木箱', '货箱', '祭台', '石棺', '收银台', '炉灶', '灶', 'counter', '台'])) return { kind: 'box', heightMm: limited(width * .88, 240, 1250) }
  if (prop.blocksMovement) return { kind: 'box', heightMm: limited(width * .68, 110, 1900) }
  return { kind: 'flat', heightMm: 0 }
}
