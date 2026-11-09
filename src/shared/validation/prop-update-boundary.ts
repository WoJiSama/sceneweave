import type { Prop, SceneDocument } from '../model/scene.js'
import { propFootprint } from '../geometry/geometry.js'
import { getLegacyGeneration } from '../terrain-generation/composition-contracts.js'

/** Conservative read dependencies of the finite Prop-position executor.
 * This is not a validation certificate. Only certified baselines reach its owner. */
interface PropUpdateBoundary {
  excludedIds: ReadonlySet<string>
  globalGenerationDependency: boolean
}
const boundaries = new WeakMap<SceneDocument, PropUpdateBoundary>()

function boundary(scene: SceneDocument): PropUpdateBoundary {
  const known = boundaries.get(scene)
  if (known) return known
  const excludedIds = new Set<string>()
  for (const group of [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)]) {
    for (const member of Object.values(group.members)) if (member.propId !== null) excludedIds.add(member.propId)
  }
  for (const cluster of Object.values(scene.decorationClusters)) {
    for (const member of Object.values(cluster.members)) if (member.entityId !== null) excludedIds.add(member.entityId)
  }
  const legacy = getLegacyGeneration(scene)!
  const include = (ref: { kind: string; entityId: string }) => { if (ref.kind === 'prop') excludedIds.add(ref.entityId) }
  // Even paused/manual rows retain exact input/output meanings. Exclude every
  // referenced Prop rather than guessing which field an old algorithm reads.
  for (const rule of Object.values(legacy.rules)) { rule.inputs.forEach(include); rule.outputs.forEach(include) }
  for (const row of Object.values(legacy.ownership)) include(row.target)
  for (const row of Object.values(scene.generation.compositions)) row.outputRefs.forEach(include)
  for (const row of Object.values(scene.generation.dependencies)) {
    row.reads.forEach(read => include(read.target)); row.writes.forEach(include)
  }
  // These receipts deliberately hash the complete physical scene. A new local
  // executor cannot silently keep them current after a remote Prop moves.
  const globalGenerationDependency = Object.values(legacy.checks).some(row => row.state !== 'unchecked')
    || Object.values(scene.generation.checks).some(row => row.state !== 'unchecked'
      || Object.values(scene.generation.compositions).some(composition => composition.state === 'active' && composition.requirementIds.includes(row.requirementId)))
    || ('surroundings' in legacy && Object.values(legacy.surroundings).some(row => row.state === 'current'))
    || ('topology' in legacy && Object.values(legacy.topology).some(row => row.state === 'current'))
  const result = { excludedIds, globalGenerationDependency }
  boundaries.set(scene, result)
  return result
}

/** The footprint and finite influence rectangle use the transition builder's
 * same clip+width boundary. Touching or uncertain edges conservatively fall back. */
function mayAffectTransition(scene: SceneDocument, prop: Prop): boolean {
  if (!prop.blocksMovement && !prop.blocksSight) return false
  const points = propFootprint(prop)
  const x1 = Math.min(...points.map(point => point.x)), x2 = Math.max(...points.map(point => point.x))
  const y1 = Math.min(...points.map(point => point.y)), y2 = Math.max(...points.map(point => point.y))
  return Object.values(scene.visual.transitions).some(row => {
    if (row.floorId !== prop.floorId) return false
    const clip = row.distanceSource.clipMm, margin = row.widthMm + 1 // transition masks round to integer mm
    return x1 <= clip.x + clip.width + margin && x2 >= clip.x - margin
      && y1 <= clip.y + clip.height + margin && y2 >= clip.y - margin
  })
}

export function independentPropUpdateSupported(scene: SceneDocument, before: Prop, after: Prop): boolean {
  const scope = boundary(scene)
  return !scope.globalGenerationDependency && !scope.excludedIds.has(before.id)
    && !mayAffectTransition(scene, before) && !mayAffectTransition(scene, after)
}
