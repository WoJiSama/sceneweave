/** One-time local import boundary. Normal project readers never call this parser. */
import { z } from 'zod'
import { canopyRuleSchema } from '../decorations/contracts.js'
import { validateDecorations } from '../decorations/validation.js'
import type { SceneDocument } from '../model/scene.js'
import type { ProjectData } from '../model/project.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { nativeLegacySceneSchema } from '../validation/legacy-scene.js'
import { historyIdentitySchema, historyIdentity2Schema, historyIdentity3Schema, historyIdentity4Schema, historyIdentity5Schema, createHistoryIdentity, decorationIdentityDescriptors, surfaceRuleIdentityDescriptors } from '../history/identity.js'
import { appearanceGraphSchema, appearanceGraph2Schema } from '../validation/content.js'
import { assetRecordSchema, nativeLicenseBindingSchema, validateProjectData } from '../project/validate.js'
import { captureJson, canonicalJson, cloneJson } from '../validation/json.js'
import { sha256Text } from '../geometry/scatter.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { createEmptyIdentity2Fields } from '../terrain-generation/contracts.js'
import { topDownPresentation } from '../appearance/presentation.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const positive = z.number().int().positive().safe()
const legacyProjectSchema = z.object({
  format: z.literal('sceneweave-complete-project'), schemaVersion: z.number().int().min(1).max(8),
  document: nativeLegacySceneSchema,
  historyIdentity: z.union([historyIdentitySchema, historyIdentity2Schema, historyIdentity3Schema, historyIdentity4Schema, historyIdentity5Schema]),
  appearance: z.union([appearanceGraphSchema, appearanceGraph2Schema]), assets: z.record(hash, assetRecordSchema),
  licenses: z.record(hash, z.object({ sha256: hash, text: z.string().min(1) }).strict()),
  licenseBindings: z.array(nativeLicenseBindingSchema).max(10_000),
  authoringSources: z.record(z.string().min(1).max(256), z.object({ kind: z.literal('svg'), sourceSha256: hash, normalizedSha256: hash,
    sourceSizeBytes: positive.max(1024 * 1024), normalizedSizeBytes: positive.max(1024 * 1024), rasterSha256: hash,
    processorId: z.literal('sceneweave-static-svg'), processorVersion: z.literal(1) }).strict()),
}).strict().superRefine((project, ctx) => {
  const version = project.schemaVersion
  if (version !== project.document.schemaVersion || project.historyIdentity.version !== (version >= 8 ? 5 : version >= 6 ? 4 : version >= 4 ? 3 : version === 3 ? 2 : 1)
    || project.appearance.version !== (version >= 3 ? 2 : 1)) ctx.addIssue({ code: 'custom', message: '旧工程各字段版本不一致。' })
  if (version < 3 && project.licenseBindings.some(row => row.subjectKind === 'regionalSymbolDefinition')) ctx.addIssue({ code: 'custom', message: '旧工程不允许区域许可主体。' })
})
export type LegacyDevelopmentProject = z.infer<typeof legacyProjectSchema>
export function readLegacyDevelopmentProject(input: unknown): LegacyDevelopmentProject {
  return legacyProjectSchema.parse(captureJson(input))
}
export const legacyDevelopmentProjectHash = (input: unknown): string => sha256Text(canonicalJson(readLegacyDevelopmentProject(input)))

/** No generator runs here. Adopted geometry, members, fixed source IDs and manual records survive. */
export function convertDevelopmentProject(input: unknown): ProjectData {
  const original = readLegacyDevelopmentProject(input), old = cloneJson(original)
  const legacyClusters = 'decorationClusters' in old.document ? old.document.decorationClusters : {}
  if (Object.values(legacyClusters).some(cluster => 'canopyRule' in cluster && cluster.canopyRule)) {
    // The historical shape parser does not establish domain validity. Check
    // the original rules/members before removing fields or normalizing erase.
    const issues = validateDecorations(original.document as unknown as SceneDocument)
    if (issues.length) throw new Error(`旧树冠源领域校验失败：${issues.map(issue => `${issue.entityId ?? ''}:${issue.message}`).join('；')}`)
  }
  const convertedRules: ProjectData['document']['surfaceRules'] = {}
  const changedClusterIds = new Set<string>()
  for (const cluster of Object.values(legacyClusters)) {
    const canopy = 'canopyRule' in cluster && cluster.canopyRule ? canopyRuleSchema.parse(cluster.canopyRule) : undefined
    if (!canopy) continue
    if (cluster.supportRef.kind !== 'terrainArea') throw new Error('旧树冠规则缺少明确地形支撑。')
    const birth = 'decorationTokens' in old.historyIdentity ? old.historyIdentity.decorationTokens[cluster.id]?.token : undefined
    if (!birth) throw new Error('旧树冠簇缺少真实出生证明。')
    const oldDescriptor = decorationIdentityDescriptors(original.document as unknown as SceneDocument)[cluster.id]
    const oldToken = 'decorationTokens' in original.historyIdentity ? original.historyIdentity.decorationTokens[cluster.id] : undefined
    if (!oldToken || oldToken.kind !== oldDescriptor?.kind || oldToken.topologyHash !== oldDescriptor.topologyHash) throw new Error('旧树冠簇拓扑证明损坏。')
    const id = `import-rule-${sha256Text(canonicalJson([old.historyIdentity.lineageId, cluster.id, birth]))}`
    if (Object.hasOwn(old.document.entityLayers, id)) throw new Error('迁入规则身份与旧实体冲突。')
    convertedRules[id] = { id, floorId: cluster.floorId, editLocked: cluster.editLocked, visibility: cluster.visibility,
      supportRef: { kind: 'terrainArea', id: cluster.supportRef.id }, field: 'trees', paintOrder: canopy.paintOrder,
      regionsMm: polygonBoolean({ operation: 'union', subject: canopy.regionsMm, clip: [] }).polygons.map(row => ({ outerMm: row.outer, holesMm: row.holes })),
      clusterId: cluster.id, coveragePpm: canopy.mode === 'erase' ? 0 : canopy.canopyCoveragePpm }
    // v7 allowed painted geometry beyond its sampling envelope. Current rules
    // require the whole paint inside that envelope: retain both complete
    // regions and the old bounds, without clipping or regenerating members.
    const b = cluster.boundsMm, points = canopy.regionsMm.flat()
    const x = Math.min(b.x, ...points.map(point => point.x)), y = Math.min(b.y, ...points.map(point => point.y))
    cluster.boundsMm = { x, y, width: Math.max(b.x + b.width, ...points.map(point => point.x)) - x,
      height: Math.max(b.y + b.height, ...points.map(point => point.y)) - y }
    old.document.entityLayers[id] = old.document.entityLayers[cluster.id]
    delete (cluster as { canopyRule?: unknown }).canopyRule
    changedClusterIds.add(cluster.id)
  }
  // The old parser has captured the input; this constructor is not a permissive public reader.
  const document = toCurrentSceneDocument(old.document)
  Object.assign(document.surfaceRules, convertedRules)
  let sequence = 0
  // A missing historical structure pool is not a witness. Preserve an exact
  // existing pool below, or leave it absent until explicit initialization of
  // the current revision; matching IDs/topology must not create continuity.
  const { structureTokens: _unprovenStructures, ...fresh } = createHistoryIdentity(document, { ids: { nextId: () => `import-${sha256Text(canonicalJson([old.historyIdentity.lineageId, old.document.sceneId, ++sequence]))}` }, clock: { now: () => old.document.updatedAt } })
  const historyIdentity = { ...fresh, ...createEmptyIdentity2Fields(), ...old.historyIdentity, version: 5 as const,
    generationTokens: 'generationTokens' in old.historyIdentity ? old.historyIdentity.generationTokens : fresh.generationTokens,
    regionalTokens: 'regionalTokens' in old.historyIdentity ? old.historyIdentity.regionalTokens : fresh.regionalTokens,
    presentationTokens: 'presentationTokens' in old.historyIdentity ? old.historyIdentity.presentationTokens : fresh.presentationTokens,
    terrainTokens: 'terrainTokens' in old.historyIdentity ? old.historyIdentity.terrainTokens : fresh.terrainTokens,
    decorationTokens: 'decorationTokens' in old.historyIdentity ? old.historyIdentity.decorationTokens : fresh.decorationTokens,
    surfaceRuleTokens: 'surfaceRuleTokens' in old.historyIdentity ? old.historyIdentity.surfaceRuleTokens : fresh.surfaceRuleTokens }
  for (const id of changedClusterIds) {
    const descriptor = decorationIdentityDescriptors(document)[id], previous = historyIdentity.decorationTokens![id]
    if (!previous || !descriptor) throw new Error('旧树冠簇出生或拓扑证明缺失。')
    historyIdentity.decorationTokens![id] = { ...previous, topologyHash: descriptor.topologyHash,
      topologyToken: `import-topology-${sha256Text(canonicalJson([previous.topologyToken, descriptor.topologyHash]))}` }
  }
  for (const [id, descriptor] of Object.entries(surfaceRuleIdentityDescriptors(document))) if (!historyIdentity.surfaceRuleTokens![id]) {
    historyIdentity.surfaceRuleTokens![id] = { ...descriptor,
      token: `import-birth-${sha256Text(canonicalJson([old.historyIdentity.lineageId, id]))}`,
      topologyToken: `import-topology-${sha256Text(canonicalJson([old.historyIdentity.lineageId, id, descriptor.topologyHash]))}` }
  }
  const appearance = { ...old.appearance, version: 2 as const, presentations: old.appearance.version === 2 ? old.appearance.presentations
    : Object.fromEntries(Object.values(old.appearance.sources).filter(row => row.kind === 'prop').map(row => [row.id, topDownPresentation()])) }
  return validateProjectData({ ...old, schemaVersion: 1, document, historyIdentity, appearance })
}
