import type { PointMm, Prop, SceneDocument, ScatterGroup } from '../../../shared/model/scene.js'
import { buildScatterRegeneration } from '../../../shared/geometry/scatter.js'
import { pathPolygon, polygonDistance, polygonInside, polygonsOverlap, propFootprint, roomPoints, terrainPoints } from '../../../shared/geometry/geometry.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { VEGETATION_DETAIL_SPECS } from '../../../shared/visual/vegetation-detail-art.js'
import { applyOutpostVegetation, OUTPOST_VEGETATION_GROUP_IDS, type OutpostVegetationDensity } from './outpost-vegetation.js'

export const OUTPOST_VEGETATION_V2_GROUP_IDS = ['outpost-woodland-v2-main-trees', 'outpost-woodland-v2-secondary-trees',
  'outpost-woodland-v2-shrubs', 'outpost-woodland-v2-grass'] as const
const factors = { sparse: .43, balanced: .72, dense: 1 } as const
const oldFactors = { sparse: .38, balanced: .7, dense: 1 } as const
const point = (x: number, y: number): PointMm => ({ x: Math.round(x), y: Math.round(y) })
const rectangle = (left: number, top: number, right: number, bottom: number): PointMm[] => [point(left, top), point(right, top), point(right, bottom), point(left, bottom)]
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)
function bounds(points: PointMm[], margin: number): PointMm[] {
  return rectangle(Math.floor(Math.min(...points.map(p => p.x)) - margin), Math.floor(Math.min(...points.map(p => p.y)) - margin),
    Math.ceil(Math.max(...points.map(p => p.x)) + margin), Math.ceil(Math.max(...points.map(p => p.y)) + margin))
}
function ids(value: unknown, output = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return output
  if ('id' in value && typeof value.id === 'string') output.add(value.id)
  for (const child of Object.values(value)) ids(child, output)
  return output
}
function checked(scene: SceneDocument): SceneDocument {
  const result = validateSceneDocument(scene)
  if (!result.ok) throw new Error(`哨站植被v2无效：${result.errors.map(issue => `${issue.entityId ?? ''}:${issue.message}`).join('；')}`)
  return result.document
}
function visualPolygon(prop: Prop): PointMm[] {
  const b = prop.visualBoundsMm
  return propFootprint({ ...prop, footprintMm: { width: b.width, height: b.height }, footprintOffsetMm: { x: b.x + b.width / 2, y: b.y + b.height / 2 } })
}

/** Prove the complete previous construction, rather than trusting a managed
 * label or a seed. Actual member records, props, layers and exclusions must
 * equal the original v1 recipe replay on the same unchanged external scene. */
function originalConstruction(scene: SceneDocument): { oldPropIds: string[]; clearings: PointMm[][] } {
  const first = scene.scatterGroups[OUTPOST_VEGETATION_GROUP_IDS[0]]
  const density = (Object.keys(oldFactors) as OutpostVegetationDensity[]).find(key => first?.densityFactor === oldFactors[key])
  if (!density) throw new Error('原哨站植被不是可证明的固定v1编排。')
  const oldPropIds: string[] = [], clearings: PointMm[][] = []
  for (const groupId of OUTPOST_VEGETATION_GROUP_IDS) {
    const group = scene.scatterGroups[groupId], layer = group && scene.userLayers[scene.entityLayers[groupId]]
    if (!group || group.visibility !== 'public' || group.editLocked || !layer || layer.editLocked
      || !group.exclusions[0] || group.exclusions[0].id !== `${groupId}-activity-clearing`) throw new Error('原哨站植被包含私密、锁定或未知记录，不替换。')
    clearings.push(cloneJson(group.exclusions[0].boundaryMm))
    for (const member of Object.values(group.members)) {
      const prop = member.propId && scene.props[member.propId], propLayer = prop && scene.userLayers[scene.entityLayers[prop.id]]
      if (member.state !== 'managed' || member.overrideFields.length || !prop || prop.visibility !== 'public' || prop.editLocked || !propLayer || propLayer.editLocked) {
        throw new Error('原哨站植被包含人工、删除、退出、锁定或私密成员，不替换。')
      }
      oldPropIds.push(prop.id)
    }
  }
  if (new Set(oldPropIds).size !== oldPropIds.length) throw new Error('原哨站植被成员归属不唯一。')
  const replay = cloneJson(scene)
  for (const id of oldPropIds) { delete replay.props[id]; delete replay.entityLayers[id] }
  for (const id of OUTPOST_VEGETATION_GROUP_IDS) { delete replay.scatterGroups[id]; delete replay.entityLayers[id] }
  applyOutpostVegetation(replay, density)
  for (const id of OUTPOST_VEGETATION_GROUP_IDS) if (!same(scene.scatterGroups[id], replay.scatterGroups[id]) || scene.entityLayers[id] !== replay.entityLayers[id]) {
    throw new Error('原哨站植被配置、成员或排除范围与固定v1重放不一致，不替换。')
  }
  for (const id of oldPropIds) if (!same(scene.props[id], replay.props[id]) || scene.entityLayers[id] !== replay.entityLayers[id]) {
    throw new Error('原哨站植被实际物件与固定v1重放不一致，不覆盖人工改动。')
  }
  return { oldPropIds, clearings }
}
function assertDefinitions(scene: SceneDocument): void {
  for (const spec of VEGETATION_DETAIL_SPECS) {
    const def = scene.propDefinitions[spec.definitionId], asset = scene.assets[spec.assetId]
    if (!def || def.version !== spec.version || def.catalogId !== `prop.sceneweave.vegetation-detail-v1.${spec.key}`
      || !same(def.defaultAppearance, { kind: 'image', assetId: spec.assetId, tint: null, opacity: 1 })
      || !same(def.defaultVisualBoundsMm, spec.visualBoundsMm) || !same(def.defaultFootprintMm, spec.footprintMm)
      || !same(def.defaultFootprintOffsetMm, { x: 0, y: 0 }) || def.defaultBlocksMovement !== spec.blocksMovement
      || def.defaultBlocksSight !== spec.blocksSight || def.defaultRenderLayer !== spec.renderLayer || def.defaultShadowClass !== spec.shadowClass
      || !asset || !same(asset.logicalSizeMm, { width: spec.widthMm, height: spec.heightMm })) {
      throw new Error(`新哨站植被需要已采用且标定完整的固定素材：${spec.key}。`)
    }
  }
}
interface Zone { left: number; top: number; right: number; bottom: number }
/** A union of rectangular growth patches has a finite rectangular complement;
 * persist that exact domain as exclusions instead of an invisible paint mask. */
function outsideZones(zones: readonly Zone[]): PointMm[][] {
  const xs = [...new Set([0, 36000, ...zones.flatMap(zone => [zone.left, zone.right])])].sort((a,b) => a-b)
  const ys = [...new Set([0, 28000, ...zones.flatMap(zone => [zone.top, zone.bottom])])].sort((a,b) => a-b)
  const output: PointMm[][] = []
  for (let y = 1; y < ys.length; y++) for (let x = 1; x < xs.length; x++) {
    const cx = (xs[x-1]+xs[x])/2, cy = (ys[y-1]+ys[y])/2
    if (!zones.some(zone => cx >= zone.left && cx <= zone.right && cy >= zone.top && cy <= zone.bottom)) output.push(rectangle(xs[x-1], ys[y-1], xs[x], ys[y]))
  }
  return output
}

/** New construction only. Existing manual/deleted/locked records are refused;
 * the returned complete groups/members are saved, never regenerated on open. */
export function applyOutpostVegetationV2(input: SceneDocument, density: OutpostVegetationDensity = 'balanced'): SceneDocument {
  if (!Object.hasOwn(factors, density)) throw new Error('哨站植被v2仅支持疏、适中、密三档。')
  const source = checked(input), ground = source.terrainAreas['sample-ground'], floor = ground && source.floors[ground.floorId]
  if (source.presetSnapshot.presetId !== 'sceneweave-outpost-layout' || source.presetSnapshot.presetVersion !== 1
    || !ground || ground.editLocked || ground.visibility !== 'public' || ground.blocksMovement || ground.groundElevationMm !== 0
    || !floor || !same(floor.boundsMm, { x: 0, y: 0, width: 36000, height: 28000 })
    || source.userLayers[source.entityLayers[ground.id]]?.editLocked
    || Object.values(source.terrainAreas).some(area => area.floorId !== ground.floorId || area.groundElevationMm !== 0 || area.visibility !== 'public' || area.editLocked || source.userLayers[source.entityLayers[area.id]]?.editLocked)) {
    throw new Error('哨站植被v2只用于新建36×28米、同层同高程公开且未锁定的原编排。')
  }
  assertDefinitions(source)
  const occupied = ids(source)
  if (OUTPOST_VEGETATION_V2_GROUP_IDS.some(id => occupied.has(id) || [...occupied].some(value => value.startsWith(`${id}-`)))) {
    throw new Error('哨站植被v2身份已存在，不重复编排或覆盖。')
  }
  const { oldPropIds, clearings } = originalConstruction(source), working = cloneJson(source)
  for (const id of oldPropIds) { delete working.props[id]; delete working.entityLayers[id] }
  for (const id of OUTPOST_VEGETATION_GROUP_IDS) { delete working.scatterGroups[id]; delete working.entityLayers[id] }
  const layerId = 'theme-pack-props', layer = working.userLayers[layerId]
  if (!layer || layer.editLocked || layer.floorId !== ground.floorId) throw new Error('新哨站植被需要明确同Floor未锁定的物件层。')
  const specs = [
    { id: OUTPOST_VEGETATION_V2_GROUP_IDS[0], keys: ['tree-spreading-oak', 'tree-broken-fan-pine'], cell: 1850, gap: 700, margin: 1900, clearing: clearings[0],
      zones: [{left:15000,top:1200,right:26000,bottom:10400}] },
    { id: OUTPOST_VEGETATION_V2_GROUP_IDS[1], keys: ['tree-narrow-birch', 'tree-broken-fan-pine'], cell: 2050, gap: 550, margin: 1800, clearing: clearings[0],
      zones: [{left:800,top:11800,right:4800,bottom:23000},{left:8000,top:23000,right:20000,bottom:27600},{left:31000,top:3000,right:35600,bottom:21500}] },
    { id: OUTPOST_VEGETATION_V2_GROUP_IDS[2], keys: ['shrub-notched-thicket', 'shrub-splayed-fern'], cell: 1700, gap: 180, margin: 900, clearing: clearings[1],
      zones: [{left:1000,top:1000,right:35000,bottom:27500}] },
    { id: OUTPOST_VEGETATION_V2_GROUP_IDS[3], keys: ['grass-bent-verge'], cell: 1750, gap: 100, margin: 850, clearing: clearings[2],
      zones: [{left:1100,top:1100,right:35000,bottom:27500}] },
  ]
  const protectedAreas = Object.values(working.terrainAreas).filter(area => area.floorId === ground.floorId && area.id !== ground.id).map(terrainPoints)
  const protectedRooms = Object.values(working.rooms).filter(room => room.floorId === ground.floorId).map(room => roomPoints(working, room))
  const roads = Object.values(working.paths).filter(path => path.floorId === ground.floorId)
  const added: Prop[] = []
  for (const [index, spec] of specs.entries()) {
    const exclusion = (key: string, boundaryMm: PointMm[], reason: 'manual' | 'entrance' = 'manual') => ({ id: `${spec.id}-${key}`, boundaryMm, reason, sourceCandidateKey: null })
    const exclusions: ScatterGroup['exclusions'] = [exclusion('activity-clearing', cloneJson(spec.clearing))]
    outsideZones(spec.zones).forEach((ring,i) => exclusions.push(exclusion(`outside-growth-patch-${i}`,ring)))
    protectedAreas.forEach((ring,i) => exclusions.push(exclusion(`terrain-${i}`,bounds(ring,spec.margin),'entrance')))
    protectedRooms.forEach((ring,i) => exclusions.push(exclusion(`building-${i}`,bounds(ring,spec.margin),'entrance')))
    for (const path of roads) for (let i = 1; i < path.centerlineMm.length; i++) {
      exclusions.push(exclusion(`road-${path.id}-${i}`,bounds(path.centerlineMm.slice(i-1,i+1),Math.ceil(path.widthMm/2+spec.margin+200)),'entrance'))
    }
    const palette = spec.keys.map((key,i) => {
      const definition = VEGETATION_DETAIL_SPECS.find(value => value.key === key)!
      return { key, propDefinitionRef: { id: definition.definitionId, version: 1 }, weight: index === 0 && i === 0 ? 3 : 1 }
    })
    working.scatterGroups[spec.id] = { id: spec.id, floorId: ground.floorId, editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: ground.id }, palette,
      seed: `sceneweave-outpost-woodland-layout2-${index}`, algorithmVersion: 'scatter-cell-v2', gridOriginMm: point(0,0), cellSizeMm: spec.cell,
      densityFactor: factors[density] * (index === 3 ? .85 : 1), minDistanceMm: spec.gap, rotationRangeDeg: { min: 0, max: 359 }, members: {}, exclusions }
    working.entityLayers[spec.id] = layerId
    const proposal = buildScatterRegeneration(working,spec.id,undefined,{ allocatePropId: key => `${spec.id}-${key}` })
    if (proposal.removePropIds.length) throw new Error('新哨站植被不得移除范围外物件。')
    for (const prop of proposal.props) {
      const visual = visualPolygon(prop), footprint = propFootprint(prop)
      // Saved exclusions additionally remember rejected canopy cells, so later
      // ordinary regeneration does not put those crowns back over the clearing.
      if (!polygonInside(visual, terrainPoints(ground)) || polygonDistance(visual,spec.clearing) < 180
        || protectedAreas.some(ring => polygonDistance(visual,ring) < 180)
        || protectedRooms.some(ring => polygonDistance(visual,ring) < 250)
        || roads.some(path => polygonDistance(visual,pathPolygon(path)) < 180)) {
        delete proposal.group.members[Object.keys(proposal.group.members).find(key => proposal.group.members[key].propId === prop.id)!]
        proposal.group.exclusions.push(exclusion(`canopy-cell-${prop.id.slice(-64)}`,bounds(footprint,1)))
        continue
      }
      if (!polygonInside(footprint,terrainPoints(ground)) || roads.some(path => polygonsOverlap(footprint,pathPolygon(path)))) throw new Error('新哨站植被真实占地侵入道路或支撑之外。')
      working.props[prop.id] = prop; working.entityLayers[prop.id] = layerId; added.push(prop)
    }
    working.scatterGroups[spec.id] = proposal.group
  }
  if (added.length > 180) throw new Error('哨站植被v2超过180个实际成员预算。')
  if (specs.some(spec => !Object.values(working.scatterGroups[spec.id].members).some(member => member.propId))) throw new Error('哨站植被v2的分区没有实际成员，未创建布局。')
  if (VEGETATION_DETAIL_SPECS.some(spec => !added.some(prop => prop.definitionRef?.id === spec.definitionId))) throw new Error('哨站植被v2须实际使用全部六种固定变体。')
  return checked(working)
}
