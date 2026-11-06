import type { SceneDocument } from '../model/scene.js'
import type { TerrainTransition } from '../terrain-generation/composition-contracts.js'
import { canonicalJson } from '../validation/json.js'
import { visualBase } from './base.js'
import { refreshTerrainTransition, terrainTransitionDependencyIds } from './transition.js'

export interface DerivedTransitionImpact {
  changedIds: string[]
  /** Includes transition/boundary IDs and physical binding seeds from both
   * documents. The command owner expands its own full physical dependencies. */
  affectedIds: string[]
  layerIds: string[]
  commandCost: number
}
const points = (row: TerrainTransition | undefined) => row
  ? row.polygons.reduce((sum, polygon) => sum + polygon.pointsMm.length, 0) + row.strokes.reduce((sum, stroke) => sum + stroke.pointsMm.length, 0) : 0
const empty = (): DerivedTransitionImpact => ({ changedIds: [], affectedIds: [], layerIds: [], commandCost: 0 })

/** Read-only inspection of actual before/after rows. It neither refreshes
 * geometry nor allocates IDs and is safe for repeated preview/scope readers. */
export function inspectScene5TransitionChanges(before: Readonly<SceneDocument>, after: Readonly<SceneDocument>): DerivedTransitionImpact {
  const left = before.visual?.version === 3 ? before.visual.transitions : {}, right = after.visual?.version === 3 ? after.visual.transitions : {}
  const changedIds: string[] = [], affected = new Set<string>(), layers = new Set<string>()
  let commandCost = 0
  for (const id of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (canonicalJson(left[id] ?? null) === canonicalJson(right[id] ?? null)) continue
    changedIds.push(id); affected.add(id)
    commandCost += 1 + Math.max(points(left[id]), points(right[id]))
    for (const document of [before, after]) {
      const row = document.visual?.version === 3 ? document.visual.transitions[id] : undefined
      if (!row) continue
      layers.add(row.layerId)
      const source = visualBase(document)?.boundaries[row.boundaryId]
      if (source) layers.add(source.layerId)
      for (const dependency of terrainTransitionDependencyIds(document, row)) {
        affected.add(dependency)
        const layer = document.entityLayers[dependency]; if (layer) layers.add(layer)
      }
    }
  }
  return { changedIds, affectedIds: [...affected].sort(), layerIds: [...layers].sort(), commandCost }
}

/** Scene5 physical edits own their true transition openings in the same
 * detached candidate. Never publish a new source hash with old geometry.
 * Old strict scene2–4 retain their previous command behavior. */
export function refreshScene5TransitionsAfterPhysicalEdit(before: Readonly<SceneDocument>, after: SceneDocument, floorIds?: readonly string[]): DerivedTransitionImpact {
  if (after.visual?.version !== 3) throw new Error('完整工程派生过渡必须使用visual3。')
  const floors = floorIds ? new Set(floorIds) : undefined, base = visualBase(after)!, previous = before.visual?.version === 3 ? before.visual.transitions : {}
  const pending: TerrainTransition[] = []
  for (const row of Object.values(after.visual.transitions).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (floors && !floors.has(row.floorId)) continue
    const source = base.boundaries[row.boundaryId]
    if (!source) throw new Error('物理修改遇到缺失的过渡来源。')
    // Physical masks and complete source areas participate in the input hash;
    // even an unchanged source curve can require genuinely new output.
    const refreshed = refreshTerrainTransition(after, { ...row, distanceSource: { ...row.distanceSource, sampleSpacingMm: source.sampleSpacingMm } })
    if (canonicalJson(row) === canonicalJson(refreshed)) continue
    const old = previous[row.id]
    if (row.editLocked || old?.editLocked || after.userLayers[row.layerId]?.editLocked || old && before.userLayers[old.layerId]?.editLocked) {
      throw new Error(`物理修改涉及锁定的派生过渡或图层：${row.id}。`)
    }
    if (!after.userLayers[row.layerId] || after.userLayers[row.layerId].floorId !== row.floorId) throw new Error('派生过渡须保留同Floor现存用户图层。')
    pending.push(refreshed)
  }
  const proposed: SceneDocument = { ...after, visual: { ...after.visual, transitions: { ...after.visual.transitions, ...Object.fromEntries(pending.map(row => [row.id, row])) } } }
  const impact = inspectScene5TransitionChanges(before, proposed), priorVisual = visualBase(before)
  for (const id of impact.changedIds) {
    const old = previous[id], row = proposed.visual?.version === 3 ? proposed.visual.transitions[id] : undefined
    for (const boundaryId of new Set([old?.boundaryId, row?.boundaryId].filter((value): value is string => !!value))) {
      const source = priorVisual?.boundaries[boundaryId]
      // Read original lock state. A lock established by this very transaction
      // must not block itself, while a previously locked source stays protected.
      if (source && (source.editLocked || before.userLayers[source.layerId]?.editLocked)) throw new Error(`物理修改涉及锁定的过渡来源曲线或图层：${boundaryId}。`)
    }
  }
  // A later source/lock failure cannot leave even the detached candidate with a
  // partially refreshed set. Command-level CAS/history remains the caller's job.
  for (const row of pending) after.visual.transitions[row.id] = row
  return impact
}
