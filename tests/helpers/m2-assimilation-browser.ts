import type { Workspace } from '../../src/application/workspace/workspace'
import type { EditableProject } from '../../src/application/workspace/project'
import type { CompositionCommand } from '../../src/shared/model/appearance'
import { toBundle } from '../../src/application/workspace/project'
import { effectiveAdjustments } from '../../src/shared/appearance/graph'
import { canonicalJson } from '../../src/shared/validation/json'
import { sha256Bytes, decodeUtf8 } from '../../src/shared/project/binary'
import { projectResourceHashes } from '../../src/shared/project/source-resources'
import type { AuthoringDraft, AuthoringOperation, AuthoringScope } from '../../src/shared/ai/authoring-protocol-v1'
import { authoringProjectHash } from '../../src/shared/ai/authoring'
import { replayRetainedArtwork } from '../../src/shared/ai/authoring-v1'
import { materializeAuthoringArtwork } from '../../src/application/workspace/artwork'
import { fromBundle } from '../../src/application/workspace/project'
import { reviseSceneSnapshot } from '../../src/shared/validation/snapshots'
import { projectContentHash } from '../../src/shared/project/validate'
import { projectRepository, runtime, validation } from '../../src/platform/browser/runtime'

export const ASSIMILATION_IDS = ['assim-a', 'assim-b', 'assim-delete', 'assim-detach', 'range-a', 'range-b', 'outside-same']

/** Fixture placement uses ordinary guarded native commands, never direct document mutation. */
export async function seedAssimilation(workspace: Workspace) {
  const project = workspace.getState().project!, scene = project.document
  const floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  const definition = Object.values(scene.propDefinitions).find(item => item.name === '铜色桌灯')!
  if (!definition) throw new Error('Required built-in lamp missing')
  const points = [[2500, 2500], [4500, 2500], [2500, 4500], [4500, 4500], [6500, 3000], [10500, 3000], [15500, 9000]]
  await workspace.execute(ASSIMILATION_IDS.map((id, index) => ({ type: 'addProp', id, floorId, layerId,
    definitionRef: { id: definition.id, version: definition.version }, positionMm: { x: points[index][0], y: points[index][1] }, supportRef: { kind: 'floor', id: floorId } })))
  await workspace.execute([{ type: 'createTerrainArea', id: 'later-terrace', floorId, layerId,
    boundaryMm: [{ x: 10000, y: 7500 }, { x: 14500, y: 7500 }, { x: 14500, y: 11000 }, { x: 10000, y: 11000 }] }])
  await workspace.flush()
  return { floorId, layerId, definitionId: definition.id }
}

export function assimilationState(project: EditableProject) {
  return { document: structuredClone(project.document), identity: structuredClone(project.historyIdentity),
    appearance: structuredClone(project.appearance), sources: structuredClone(project.authoringSources), licenses: structuredClone(project.licenses),
    licenseBindings: structuredClone(project.licenseBindings), adjustments: Object.fromEntries(Object.keys(project.document.props).map(id => [id, effectiveAdjustments(project, id)])) }
}

export async function executeAndSave(workspace: Workspace, commands: CompositionCommand[]) {
  await workspace.execute(commands); await workspace.flush()
}

export async function verifyResourceClosure(project: EditableProject) {
  const bundle = toBundle(project), hashes = projectResourceHashes(bundle.project), verified: string[] = []
  for (const hash of hashes) {
    if (sha256Bytes(await bundle.resources.read(hash)) !== hash) throw new Error(`Resource mismatch: ${hash}`)
    verified.push(hash)
  }
  const sourceTexts = []
  for (const source of Object.values(project.authoringSources)) {
    sourceTexts.push({ original: decodeUtf8(await bundle.resources.read(source.sourceSha256)),
      normalized: decodeUtf8(await bundle.resources.read(source.normalizedSha256)), rasterSha256: source.rasterSha256 })
  }
  return { hashes: verified.sort(), sourceTexts, licenseJson: canonicalJson(project.licenses), bindingsJson: canonicalJson(project.licenseBindings) }
}

type ArtworkScope = NonNullable<AuthoringScope['artwork']>
const scopes = new WeakMap<Workspace, ArtworkScope>()
const previews = new WeakMap<Workspace, { baseline: EditableProject; draft: AuthoringDraft; materialized: EditableProject }>()

/** Test-only retained artifact replay. This grants no current public AI rights,
 * creates no HTTP task and always uses the actual browser SVG/image adapters. */
export function freezeRetainedArtwork(workspace: Workspace, scope: ArtworkScope) {
  scopes.set(workspace, structuredClone(scope))
  previews.delete(workspace)
}

export async function prepareRetainedArtwork(workspace: Workspace, operations: AuthoringOperation[]) {
  previews.delete(workspace)
  const baseline = workspace.getState().project!, artwork = scopes.get(workspace)
  if (!baseline || !artwork) throw new Error('Retained artwork needs an explicit local baseline and frozen scope')
  const start = { schemaVersion: 1 as const, project: toBundle(baseline).project, baseContentHash: authoringProjectHash(toBundle(baseline).project),
    scope: { targetIds: [], placement: null, operations: [], artwork: structuredClone(artwork) }, seed: crypto.randomUUID(),
    preparedAt: runtime.clock.now(), skill: { id: 'sceneweave-artwork-authoring' as const, version: 1 as const }, disclosure: 'complete-metadata/public-model' as const }
  const steps = [{ index: 1, stepId: 'retained-artifact-step', operations: structuredClone(operations) }]
  const draft: AuthoringDraft = { schemaVersion: 1, taskId: crypto.randomUUID(), generation: 1, start, state: replayRetainedArtwork(start, steps).state }
  const assessments: { key: string; sha256: string; status: string }[] = []
  const materialized = await materializeAuthoringArtwork(await fromBundle(toBundle(baseline), validation), draft, validation,
    { onQualityAssessment: assessment => assessments.push({ key: assessment.key, sha256: assessment.sha256, status: assessment.report.status }) })
  if (workspace.getState().project !== baseline) throw new Error('Retained artwork baseline changed during preparation')
  previews.set(workspace, { baseline, draft, materialized })
  return { seed: start.seed, revision: baseline.document.revision, artwork: start.scope.artwork, operationCost: draft.state.operationCost,
    processor: validation.svg!.processor, assessments }
}

export async function retainedPublicationState(workspace: Workspace) {
  const project = workspace.getState().project!, owner = project.document.sceneId
  const usage = await projectRepository.usage(owner), snapshots = await projectRepository.listSnapshots(owner), cold = await projectRepository.load(owner)
  return { hash: projectContentHash(toBundle(project).project), coldHash: cold ? projectContentHash(cold.project) : null,
    revision: project.document.revision, metadataVersion: usage.metadataVersion,
    snapshots: snapshots.map(snapshot => ({ id: snapshot.id, kind: snapshot.kind, contentHash: snapshot.contentHash })).sort((a, b) => a.id.localeCompare(b.id)) }
}

export async function rejectRetainedArtwork(workspace: Workspace, operations: AuthoringOperation[]) {
  const writes: { database: string; mode: IDBTransactionMode }[] = [], transaction = IDBDatabase.prototype.transaction
  let failure: string | null = null
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    if (args[1] && args[1] !== 'readonly') writes.push({ database: this.name, mode: args[1] })
    return transaction.apply(this, args)
  } as IDBDatabase['transaction']
  try { await prepareRetainedArtwork(workspace, operations) }
  catch (error) { failure = error instanceof Error ? error.message : String(error) }
  finally { IDBDatabase.prototype.transaction = transaction }
  return { failure, writes }
}

/** Retained results are published through explicit protection and repository
 * CAS, never by manufacturing an authoring4 authorization or server lease. */
export async function publishRetainedArtwork(workspace: Workspace) {
  const preview = previews.get(workspace)
  if (!preview || workspace.getState().project !== preview.baseline) throw new Error('Retained artwork preview is absent or stale')
  await workspace.flush()
  if (workspace.getState().project !== preview.baseline) throw new Error('Retained artwork baseline changed before publication')
  const { baseline, materialized } = preview, owner = baseline.document.sceneId
  const next = await fromBundle({ project: { ...toBundle(materialized).project,
    document: reviseSceneSnapshot(materialized.document, baseline.document.revision + 1, runtime.clock.now()) }, resources: materialized.resources }, validation)
  const usage = await projectRepository.usage(owner)
  const protection = await projectRepository.createSnapshot(toBundle(baseline), 'Retained artwork source baseline', { kind: 'protection',
    expectedRevision: baseline.document.revision, expectedMetadataVersion: usage.metadataVersion })
  await projectRepository.save(toBundle(next), baseline.document.revision, { guard: { expectedMetadataVersion: usage.metadataVersion + 1,
    protection: { id: protection.id, contentHash: protection.contentHash } } })
  const cold = await projectRepository.load(owner)
  if (!cold || projectContentHash(cold.project) !== projectContentHash(toBundle(next).project)) throw new Error('Retained publication cold-read mismatch')
  await workspace.openPersisted(await fromBundle(cold, validation))
  previews.delete(workspace)
  return { protectionId: protection.id, revision: next.document.revision }
}

/** Cancel an independent materialization only after decoding actual bytes.
 * Observe native write transactions as well as persisted metadata/protections. */
export async function cancelRetainedArtwork(workspace: Workspace) {
  const preview = previews.get(workspace)
  if (!preview || workspace.getState().project !== preview.baseline) throw new Error('Retained cancellation needs an active preview')
  await workspace.flush()
  const before = await retainedPublicationState(workspace), abort = new AbortController(), writes: { database: string; mode: IDBTransactionMode }[] = []
  let realDecodes = 0, failure: string | null = null
  const transaction = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
    if (args[1] && args[1] !== 'readonly') writes.push({ database: this.name, mode: args[1] })
    return transaction.apply(this, args)
  } as IDBDatabase['transaction']
  try {
    await materializeAuthoringArtwork(preview.baseline, preview.draft, { ...validation, signal: abort.signal, images: { ...validation.images,
      async decode(...args) { const pixels = await validation.images.decode(...args); realDecodes++; abort.abort(); return pixels } } })
  } catch (error) { failure = error instanceof Error ? error.name : String(error) }
  finally { IDBDatabase.prototype.transaction = transaction; previews.delete(workspace) }
  return { failure, realDecodes, writes, before, after: await retainedPublicationState(workspace) }
}
