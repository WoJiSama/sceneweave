import { buildAggregateCapacityDocument, prepareAggregateCapacityFixture, assertAggregateCapacityPlayerPrivacy, type AggregateCapacityKind } from './aggregate-capacity-fixtures.js'
import { fromBundle, toBundle, type EditableProject } from '../../src/application/workspace/project.js'
import { prepareCompositionCommands } from '../../src/application/workspace/prepare.js'
import { validation } from '../../src/platform/browser/runtime.js'
import { decorationAsProp } from '../../src/shared/decorations/geometry.js'
import { createHistoryIdentity } from '../../src/shared/history/identity.js'
import { syncAppearanceGraph } from '../../src/shared/appearance/graph.js'
import { bindTerrainVariantPresentations, bindTerrainVariantV2Presentations } from '../../src/shared/visual/terrain-variant-presentations.js'
import { selectManualTransactionBudget } from '../../src/shared/budget/command-budget.js'
import { inspectAggregateDomain } from '../../src/shared/aggregates/domain-adapters.js'
import { detachChangedOutputs } from '../../src/shared/terrain-generation/integrity.js'
import { pauseChangedCompositions } from '../../src/shared/terrain-generation/composition-lifecycle.js'
import { exportProject, importProject } from '../../src/shared/project/file.js'
import { projectContentHash } from '../../src/shared/project/validate.js'
import { canonicalJson, captureJson } from '../../src/shared/validation/json.js'
import { sha256Bytes, sha256Text } from '../../src/shared/validation/hash.js'
import { validateSceneDocument } from '../../src/shared/validation/scene.js'
import type { SceneDocument } from '../../src/shared/model/scene.js'

export type FormalCapacityKind = AggregateCapacityKind
export interface FormalCapacityVariant {
  remoteExtraProps?: 0 | 500
  /** These are real connections from an owned terrain to an unowned support.
   * The current finite contract must reject moving that incomplete support. */
  localExternalPorts?: 0 | 16
}
export const FORMAL_CAPACITY_FIXTURE_FORMAT = 'sceneweave-current-formal-fixtures' as const
export const FORMAL_CAPACITY_FIXTURE_VERSION = 'current-full-props-v1' as const
const stamp = '2026-11-06T00:00:00.000Z'
const count = (value: object) => Object.keys(value).length
const clone = <T>(value: T): T => captureJson(value)
type ComplexBuilt = ReturnType<typeof buildAggregateCapacityDocument>

function formalVariant(value: FormalCapacityVariant) {
  if (Object.keys(value).some(key => !['remoteExtraProps', 'localExternalPorts'].includes(key))
    || ![0, 500].includes(value.remoteExtraProps ?? 0) || ![0, 16].includes(value.localExternalPorts ?? 0)) throw new Error('正式容量夹具变体只允许远端500个完整物件或16条真实局部外接连接。')
  return { remoteExtraProps: value.remoteExtraProps ?? 0, localExternalPorts: value.localExternalPorts ?? 0 }
}

/** The authored image, size, footprint, rotation and support are retained
 * explicitly on every full Prop. This is a real representation conversion in
 * fixture preparation, never a product shortcut or light-detail count. */
function convertToFormalDocument(built: ComplexBuilt, input: FormalCapacityVariant = {}) {
  const variant = formalVariant(input), source = built.document, scene = clone(source)
  const convertedIds = new Set(Object.keys(scene.decorations))
  for (const decoration of Object.values(scene.decorations)) {
    const prop = decorationAsProp(scene, decoration)
    if (prop.supportRef.kind === 'room') prop.roomId = prop.supportRef.id
    scene.props[prop.id] = prop
  }
  scene.decorations = {}
  for (const group of Object.values(scene.aggregateCoordinates!.groups)) for (const member of group.members) {
    if (member.kind === 'decoration' && convertedIds.has(member.id)) member.kind = 'prop'
  }
  for (const cluster of Object.values(scene.decorationClusters)) {
    for (const entry of cluster.palette) if (entry.kind === 'decoration') entry.kind = 'prop'
    // Empty deleted/detached slots are deliberately retained as manual evidence.
    for (const member of Object.values(cluster.members)) if (member.kind === 'decoration') member.kind = 'prop'
  }
  scene.title = `正式容量 · ${built.summary.kind} · ${built.summary.detailCount}完整物件`
  scene.units.gridVisible = true
  scene.units.gridSizeMm = 3600
  scene.presetSnapshot.gridSizeMm = 3600
  scene.exportBoundsMm = clone(scene.floors[Object.keys(scene.floors)[0]].boundsMm)
  const localExternalPortIds: string[] = [], localExternalSupportIds: string[] = []
  if (variant.localExternalPorts) {
    if (built.controls.domain !== 'natural') throw new Error('局部外接连接负例只适用于本次自然/混合夹具。')
    const ownedId = `capacity-${built.summary.kind}-focus-extension`, owned = scene.terrainAreas[ownedId]
    if (!owned || owned.groundElevationMm !== 0) throw new Error('外接连接负例需要确切的零高程组内扩展地面。')
    const id = `formal-${built.summary.kind}-external-terrace`, floorId = owned.floorId
    const corners = [{ x: 102000, y: 1000 }, { x: 106000, y: 1000 }, { x: 106000, y: 60000 }, { x: 102000, y: 60000 }]
    scene.terrainAreas[id] = { ...clone(owned), id, groundElevationMm: 1000,
      boundaryMm: corners.map((positionMm, i) => ({ id: `${id}-p${i}`, segmentId: `${id}-s${i}`, positionMm })) }
    scene.entityLayers[id] = scene.entityLayers[ownedId]
    localExternalSupportIds.push(id)
    for (let i = 0; i < variant.localExternalPorts; i++) {
      const connectionId = `formal-${built.summary.kind}-local-external-stairs-${i}`, y = 32000 + i * 1000
      scene.terrainConnections[connectionId] = { id: connectionId, floorId, editLocked: false, visibility: 'public', kind: 'stairs',
        from: { surfaceRef: { kind: 'terrainArea', id: ownedId }, positionMm: { x: 101000, y } },
        to: { surfaceRef: { kind: 'terrainArea', id }, positionMm: { x: 103000, y } },
        widthMm: 600, openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null }
      scene.entityLayers[connectionId] = scene.entityLayers[ownedId]
      scene.aggregateCoordinates!.groups[built.controls.groupId].members.push({ kind: 'terrainConnection', id: connectionId })
      localExternalPortIds.push(connectionId)
    }
  }
  detachChangedOutputs(source, scene)
  pauseChangedCompositions(source, scene)
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`正式完整物件夹具校验失败：${checked.errors.slice(0, 12).map(issue => `${issue.entityId ?? ''}:${issue.code}:${issue.message}`).join('；')}`)
  const expectedProps = built.summary.detailCount + variant.remoteExtraProps
  if (count(scene.props) !== expectedProps || count(scene.decorations) !== 0) throw new Error(`正式负载必须恰有${expectedProps}个完整Prop且无轻量替代。`)
  const controls = { ...built.controls, selectionMemberIds: [built.controls.editableMemberId, built.controls.remoteEntityId],
    localExternalPortIds, localExternalSupportIds,
    expectedGroupTransform: variant.localExternalPorts ? 'reject-external-support' as const : 'measure-supported-or-budget-rejection' as const }
  const scope = inspectAggregateDomain(checked.document, controls.groupId, controls.domain)
  return { document: checked.document, controls, summary: { ...built.summary,
    fixtureVersion: FORMAL_CAPACITY_FIXTURE_VERSION, variant, detailCount: built.summary.detailCount,
    actualDetailCount: count(scene.props), fullPropCount: count(scene.props), propCount: count(scene.props), decorationCount: 0,
    detailMeaning: 'Every counted object is a fully persisted Prop; there are no lightweight Decorations. Structural entities, full manual containers and visual records are additional.',
    counts: { ...built.summary.counts, props: count(scene.props), decorations: 0, terrainAreas: count(scene.terrainAreas), connections: count(scene.terrainConnections) },
    aggregateMembers: scope.members.length, aggregateReadDependencies: scope.readDependencies,
    worldBoundsMm: clone(scene.floors[Object.keys(scene.floors)[0]].boundsMm), exportBoundsMm: clone(scene.exportBoundsMm),
    displayedGrid: { columns: 50, rows: 50, cellSizeMm: 3600, visible: true,
      boundary: 'The actual 180m by 180m Floor and fixed export bounds contain exactly 50 by 50 displayed cells when fitted. Original authored focus extent and synthetic density are reported separately.' },
    convertedFullPropIds: [...convertedIds], localExternalPortIds, localExternalSupportIds,
    expectedGroupTransform: controls.expectedGroupTransform,
    densityMethod: 'Legal complex aggregate fixture placements are retained, then every lightweight decoration is materialized into a full Prop with explicit fixed definition, appearance, footprint, image bounds, support, rotation, visibility, shadow and render fields. All counted objects undergo ordinary full Prop validation. Existing authored furniture and real image sources remain intact. No overlapping clone density or tiny image substitute is introduced.',
    sourceRepresentationConversion: 'Preparation-only explicit complete-field conversion; matching cluster slots/palette and aggregate ownership become Prop references. The strict model never allowed note anchors to decorations, so existing notes remain unchanged. Existing deleted/detached slots and generated provenance remain, with production detach reconciliation. This is a new independent formal corpus, not the previous mixed-detail performance distribution.',
    localExternalPortBoundary: variant.localExternalPorts ? 'Sixteen real stairs connect the selected extension terrain to one unselected adjacent terrace. Connections are explicitly owned by the group while the other support stays outside. The finite natural transform must reject before moving an endpoint; this is a negative support/port safety case, not a supported connected transform capacity.' : 'No extra local external ports. Existing real authored connections and distant independent connection remain.' } }
}

export function buildFormalCapacityDocument(kind: FormalCapacityKind, propCount: 500 | 2000, source: SceneDocument, variant: FormalCapacityVariant = {}) {
  const checked = formalVariant(variant)
  return convertToFormalDocument(buildAggregateCapacityDocument(kind, propCount, source, { remoteExtraDetails: checked.remoteExtraProps as 0 | 500 }), variant)
}

function context(kind: FormalCapacityKind) {
  let sequence = 0
  return { ids: { nextId: () => `formal-${kind}-identity-${sequence++}` }, clock: { now: () => stamp } }
}

async function transformPreflight(project: EditableProject, controls: ReturnType<typeof buildFormalCapacityDocument>['controls'], kind: FormalCapacityKind) {
  const command = { type: controls.domain === 'building' ? 'transformAggregateBuilding' as const : 'transformAggregateNatural' as const,
    id: controls.groupId, offsetMm: controls.offsetMm, pivotMm: controls.pivotMm, quarterTurns: controls.quarterTurns }
  const members = inspectAggregateDomain(project.document, controls.groupId, controls.domain).members.length
  try {
    const moved = await prepareCompositionCommands(project, [command], { runtime: context(kind), validation, baseline: project,
      budget: selectManualTransactionBudget(project.document, 1, members) })
    if (controls.expectedGroupTransform === 'reject-external-support') throw new Error('外接支撑不完整的负例意外通过自然组变换。')
    return { status: 'prepared' as const, privacy: assertAggregateCapacityPlayerPrivacy(project, moved, controls),
      boundary: 'Normal complete asynchronous preparation; full real pixels/licenses/materialization. It is not measured UI evidence.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (controls.expectedGroupTransform === 'reject-external-support') {
      if (!/未随动|完整支撑/.test(message)) throw error
      return { status: 'rejected-external-support' as const, message,
        boundary: 'Expected negative case: connected unowned terrain must prevent a partial transform. Public ordinary Prop edits remain separate measured operations.' }
    }
    if (!/预算|上限|超限|几何/.test(message)) throw error
    return { status: 'rejected-budget' as const, message,
      boundary: 'Actual unchanged current manual geometry/work protection refused full aggregate preparation. This is not a successful aggregate capacity sample; the normal UI must independently report the refusal.' }
  }
}

/** Run in a separate browser preparation phase, close it before measurements.
 * The returned complete package must be written, reread and SHA-verified before
 * importing through the normal production homepage in each independent run. */
export async function prepareFormalCapacityFixture(kind: FormalCapacityKind, propCount: 500 | 2000, variant: FormalCapacityVariant = {}) {
  const value = formalVariant(variant)
  // Reuse actual resource/appearance preparation, not its previous measurements.
  const source = await prepareAggregateCapacityFixture(kind, propCount, { remoteExtraDetails: value.remoteExtraProps as 0 | 500 })
  const bundle = await importProject(source.bytes, validation), complex = await fromBundle(bundle, validation)
  const built = convertToFormalDocument({ document: complex.document, controls: source.controls, summary: source.summary }, variant)
  const runtime = context(kind)
  const content = bindTerrainVariantV2Presentations(bindTerrainVariantPresentations(syncAppearanceGraph({ document: built.document,
    historyIdentity: createHistoryIdentity(built.document, runtime), appearance: complex.appearance }, complex.document)))
  const project = await fromBundle({ project: { ...bundle.project, ...content }, resources: complex.resources }, validation)
  const aggregatePreparation = await transformPreflight(project, built.controls, kind)
  const bytes = await exportProject(toBundle(project), validation), cold = await importProject(bytes, validation)
  const contentHash = projectContentHash(toBundle(project).project)
  if (projectContentHash(cold.project) !== contentHash) throw new Error('正式完整物件夹具导出/冷读内容不同。')
  const assets = Object.values(project.assets)
  if (!assets.length || assets.some(asset => asset.pixelWidth <= 1 || asset.pixelHeight <= 1)) throw new Error('正式负载必须保留真实多图片及完整许可。')
  return { bytes, controls: built.controls, summary: { ...built.summary, aggregatePreparation,
    packageSha256: sha256Bytes(bytes), packageBytes: bytes.length, contentHash, documentHash: sha256Text(canonicalJson(project.document)),
    uniqueImages: assets.length, imageBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
    imagePixels: assets.reduce((sum, asset) => sum + asset.pixelWidth * asset.pixelHeight, 0),
    authoringSources: count(project.authoringSources), licenseBindings: project.licenseBindings.length,
    sourcePackageSha256: source.summary.packageSha256,
    freezeBoundary: 'Exact newly prepared complete-v1 full-Prop corpus. Resource closure and authored complex base are shared with the legal placement generator, not with any historical performance distribution. Independent preparation processes may allocate different immutable source identities; freeze actual saved bytes.',
    resourceValidation: 'Normal strict full fromBundle, exportProject and cold importProject verify actual PNG/SVG bytes, pixels, complete fixed sources and exact licenses. No measured-page product hooks or database injection.' } }
}
