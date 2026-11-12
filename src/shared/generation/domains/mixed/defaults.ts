import type { SceneDocument } from '../../../model/scene.js'
import { cloneJson } from '../../../validation/json.js'
import { forestRectangle } from '../forest/index.js'
import { defaultVolcanoInput } from '../volcano/index.js'
import type { InteriorLayoutParameters } from '../interior/contracts.js'
import type { MixedGenerationInput } from './contracts.js'

/** Editable parameter templates only. No sampled map or hand-placed fixture is
 * copied into a candidate; the registered domain modules create every entity. */
export function defaultMixedInput(document: SceneDocument, environment: 'forest' | 'volcano', seed = 'mixed-1'): MixedGenerationInput {
  const floor = Object.values(document.floors)[0], layer = Object.values(document.userLayers).find(row => row.floorId === floor.id && !row.editLocked)
  if (!floor || !layer) throw new Error('混合生成需要明确Floor和未锁定图层。')
  const b = floor.boundsMm, at = (x: number, y: number) => ({ x: b.x + Math.round(b.width * x), y: b.y + Math.round(b.height * y) })
  const box = (x: number, y: number, w: number, h: number) => { const a = at(x, y), z = at(x + w, y + h); return { ...a, width: z.x - a.x, height: z.y - a.y } }
  const material = (id: string) => document.materials[id]?.version === 1 ? { id, version: 1 } : null
  const building: InteriorLayoutParameters = {
    floorId: floor.id, layerId: layer.id, boundsMm: environment === 'forest' ? box(.6, .18, .25, .25) : box(.32, .25, .14, .15), wallThicknessMm: 200,
    rooms: [{ id: 'main', purpose: environment === 'forest' ? '营地休息室' : '火山观测工作室', minAreaMm2: 1_000_000, maxAreaMm2: 1_000_000_000_000, minClearSideMm: 1200 }],
    relations: [], corridor: { axis: 'none', clearWidthMm: 1200 }, materials: { floor: null, wall: null },
    arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 1400, clearWidthMm: 1000,
      palette: ([['bed', 'bed-indigo'], ['seat', 'chair-slat'], ['table', 'table-round'], ['storage', 'cupboard-linen'], ['work', 'counter-kitchen'], ['hearth', 'stove-masonry'], ['shelf', 'shelf-books']] as const)
        .map(([role, key]) => {
          const original = `refined-prop-interior-${key}`, scoped = `mixed-interior-v1-${original}`
          return { role, ref: { id: document.propDefinitions[scoped] ? scoped : original, version: 1 } }
        }).filter(row => document.propDefinitions[row.ref.id]?.version === row.ref.version) },
  }
  if (environment === 'volcano') {
    const volcano = cloneJson(defaultVolcanoInput(document, seed)).parameters
    volcano.platform.boundaryMm = forestRectangle(box(.27, .18, .22, .53))
    volcano.platform.anchorMm = at(.405, .6)
    volcano.route.widthMm = 1200
    return { version: 1, algorithmVersion: 2, seed, parameters: { outdoor: { kind: 'volcano', parameters: volcano }, building,
      approach: { fromMm: cloneJson(volcano.platform.anchorMm), viaMm: [], widthMm: 1000, materialRef: cloneJson(volcano.materials.route) } } }
  }
  const tree = 'terrain-variants-v2-prop-tree-highland-copse', shrub = 'terrain-variants-v1-prop-shrub-heath-mound', grass = 'terrain-variants-v1-prop-grass-sedge-fan'
  for (const id of [tree, shrub, grass]) if (document.propDefinitions[id]?.version !== 1) throw new Error('混合森林模板缺少确切授权植被定义。')
  const entry = at(.08, .65), camp = box(.2, .5, .22, .25)
  return { version: 1, algorithmVersion: 2, seed, parameters: {
    outdoor: { kind: 'forest', parameters: { floorId: floor.id, layerId: layer.id, boundsMm: cloneJson(b), ground: { kind: 'new', elevationMm: 0, materialRef: material('shore-v1-material-grass') },
      zones: [{ id: 'woodland', supportRef: { kind: 'generated-ground' }, boundaryMm: forestRectangle(b), vegetation: [
        { role: 'tree', coveragePpm: 50000, spacingMm: 2500, clusterRadiusMm: 6000, clearanceMm: 200, palette: [{ key: 'tree', definitionRef: { id: tree, version: 1 }, kind: 'prop', weight: 1 }] },
        { role: 'shrub', coveragePpm: 4000, spacingMm: 800, clusterRadiusMm: 4000, clearanceMm: 180, palette: [{ key: 'shrub', definitionRef: { id: shrub, version: 1 }, kind: 'decoration', weight: 1 }] },
        { role: 'grass', coveragePpm: 1000, spacingMm: 300, clusterRadiusMm: 3000, clearanceMm: 180, palette: [{ key: 'grass', definitionRef: { id: grass, version: 1 }, kind: 'decoration', weight: 1 }] },
      ] }],
      clearings: [{ id: 'camp', supportRef: { kind: 'generated-ground' }, boundaryMm: forestRectangle(camp), anchorMm: at(.31, .625), clearanceMm: 200 }],
      entrances: [{ id: 'entry', supportRef: { kind: 'generated-ground' }, positionMm: entry, directionDeg: 0, widthMm: 1400 }],
      routes: [{ id: 'camp-route', fromEntranceId: 'entry', toClearingId: 'camp', viaMm: [], widthMm: 1200, materialRef: material('shore-v1-material-sand-dry') }],
    } }, building, approach: { fromMm: entry, viaMm: [], widthMm: 1000, materialRef: material('shore-v1-material-sand-dry') },
  } }
}

/** Explicit new recipe selection; the established defaultMixedInput remains
 * version 2 so old programmatic requests keep their original replay meaning. */
export function defaultMixedInputV3(document: SceneDocument, environment: 'forest' | 'volcano', seed = 'mixed-1'): MixedGenerationInput {
  return { ...defaultMixedInput(document, environment, seed), algorithmVersion: 3 }
}

/** The current composition combines seat/use-space reservations with the
 * established normal doorway approach and tree-first vegetation generation. */
export function defaultMixedInputV4(document: SceneDocument, environment: 'forest' | 'volcano', seed = 'mixed-1'): MixedGenerationInput {
  return { ...defaultMixedInput(document, environment, seed), algorithmVersion: 4 }
}
