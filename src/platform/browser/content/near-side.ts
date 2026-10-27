import type { EditableProject } from '../../../application/workspace/project.js'
import { captureEditableDraft, validateEditableProject } from '../../../application/workspace/project.js'
import { prepareTerrainUpgrade } from '../../../application/workspace/terrain.js'
import { addPropAppearanceSource } from '../../../shared/appearance/graph.js'
import type { PropAppearanceSnapshot } from '../../../shared/model/appearance.js'
import type { SceneDocument } from '../../../shared/model/scene.js'
import { REFINED_ISLAND_ART, REFINED_ISLAND_LICENSE } from '../../../shared/visual/island-art.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { runtime, validation } from '../runtime.js'
import type { BlankOptions } from './factories.js'
import { createRefinedBlankDocument } from './refined-blank.js'
import { createRefinedIslandDocument } from './refined-island.js'
import { materializeVisualArt } from './visual-art-project.js'
import { NEAR_SIDE_ART, NEAR_SIDE_LICENSE, type NearSideArt } from './near-side-art.js'

export const NEAR_SIDE_ISLAND_NAME = '南望苔岛 · 近侧视'
export const nearSideAssetId = (key: string): string => `near-side-art-${key}`
export const nearSideDefinitionId = (key: string): string => `near-side-prop-${key}`
const oldAssetId = (key: string): string => `refined-art-${key}`
const origin = { kind: 'original' as const, attribution: 'Sceneweave T4独立原创近侧视树岩第1版；固定南望/直立/世界轴占地；真实SVG及PNG/确切MIT许可，旧树冠未旋转复用', canEmbed: true }
const ref = (id: string) => ({ id, version: 1 })

function registerNearSideArt(scene: SceneDocument): void {
  for (const art of NEAR_SIDE_ART) {
    const assetId = nearSideAssetId(art.key), id = nearSideDefinitionId(art.key)
    if (scene.assets[assetId] || scene.propDefinitions[id]) throw new Error('近侧视固定定义不可被原地覆盖。')
    scene.assets[assetId] = { id: assetId, sha256: '0'.repeat(64), mimeType: 'image/png', pixelWidth: 512, pixelHeight: 512,
      logicalSizeMm: { width: art.widthMm, height: art.heightMm }, licenseRef: 'Sceneweave-T4-near-side-MIT-v1', origin: cloneJson(origin) }
    scene.propDefinitions[id] = { id, catalogId: `prop.sceneweave.t4.${art.key}`, version: 1, name: art.name, licenseRef: 'Sceneweave-T4-near-side-MIT-v1', origin: cloneJson(origin), tags: [...art.tags!],
      defaultAppearance: { kind: 'image', assetId, tint: null, opacity: 1 },
      defaultVisualBoundsMm: { x: -Math.round(art.widthMm / 2), y: -Math.round(art.heightMm / 2), width: art.widthMm, height: art.heightMm },
      defaultFootprintMm: { ...art.footprintMm! }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: art.blocksMovement!, defaultBlocksSight: art.blocksSight!,
      defaultRenderLayer: art.renderLayer!, defaultShadowClass: art.shadowClass! }
  }
}

/** Metadata source, before real bytes are rasterized. Never directly publish this placeholder document. */
export function createNearSideSourceDocument(options: { sceneId?: string; now?: string } = {}): SceneDocument {
  const scene = createRefinedIslandDocument(options)
  scene.title = NEAR_SIDE_ISLAND_NAME
  registerNearSideArt(scene)
  const checked = validateSceneDocument(scene)
  if (!checked.ok) throw new Error(`近侧视源场景无效：${checked.errors.map(issue => issue.message).join('；')}`)
  return checked.document
}

const replacement: Readonly<Record<string, string>> = Object.freeze({
  'refined-prop-island-tree-north-asym': 'near-oak', 'refined-prop-island-tree-windbent': 'near-windbent', 'refined-prop-island-tree-split-crown': 'near-pine',
  'refined-prop-island-rock-north-ridge': 'near-ridge', 'refined-prop-island-rock-layered-shelf': 'near-shelf', 'refined-prop-island-rock-tidepool': 'near-rounded',
})
function fixedSnapshot(document: SceneDocument, art: NearSideArt): PropAppearanceSnapshot {
  const definition = document.propDefinitions[nearSideDefinitionId(art.key)]
  return { definitionRef: ref(definition.id), appearance: cloneJson(definition.defaultAppearance), visualBoundsMm: cloneJson(definition.defaultVisualBoundsMm),
    shadowClass: definition.defaultShadowClass, shadowOverride: null }
}

async function finish(source: SceneDocument, replaceInstances: boolean, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  // Materialize both independent batches together, then bind each subject to
  // its exact own licence below. This produces real native SVG/PNG records.
  const materialized = await materializeVisualArt(source, [...REFINED_ISLAND_ART, ...NEAR_SIDE_ART], REFINED_ISLAND_LICENSE, key => key.startsWith('near-') ? nearSideAssetId(key) : oldAssetId(key), signal)
  const upgraded = await prepareTerrainUpgrade(materialized, { runtime, validation: { ...validation, signal } })
  const project = captureEditableDraft(upgraded), byKey = new Map(NEAR_SIDE_ART.map(art => [art.key, art]))
  project.document.title = replaceInstances ? NEAR_SIDE_ISLAND_NAME : '近侧视原创素材空白'
  for (const art of NEAR_SIDE_ART) addPropAppearanceSource(project.appearance, fixedSnapshot(project.document, art), null, art.presentation)
  if (replaceInstances) for (const prop of Object.values(project.document.props)) {
    const key = prop.definitionRef && replacement[prop.definitionRef.id], art = key ? byKey.get(key) : undefined
    // The existing shore shelf's 34-degree footprint fits its real support;
    // resetting it to world axes would cross that support. Preserve it exactly.
    if (!art || prop.id === 'q1-rock-layered-shelf-13') continue
    Object.assign(prop, fixedSnapshot(project.document, art), { rotationDeg: 0, footprintOffsetMm: { x: 0, y: 0 } })
    project.appearance.propSources[prop.id] = addPropAppearanceSource(project.appearance, prop, null, art.presentation)
  }
  const { sha256Bytes } = await import('../../../shared/validation/hash.js')
  const { encodeUtf8 } = await import('../../../shared/validation/json.js')
  const licenseHash = sha256Bytes(encodeUtf8(NEAR_SIDE_LICENSE))
  project.licenses[licenseHash] = { sha256: licenseHash, text: NEAR_SIDE_LICENSE }
  for (const binding of project.licenseBindings) if (binding.subjectId.startsWith('near-side-')) binding.licensePath = `licenses/${licenseHash}.txt`
  return validateEditableProject(project, { ...validation, signal })
}

/** Separate complete3 sample; normal workspace creation must save current first, save this, then switch. */
export async function createNearSideIslandProject(signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  return finish(createNearSideSourceDocument({ sceneId: runtime.ids.nextId(), now: runtime.clock.now() }), true, signal)
}

/** Empty scene with normal fixed catalogue placement and complete3 presentation metadata. */
export async function createNearSidePaletteProject(options: BlankOptions, signal?: AbortSignal): Promise<EditableProject> {
  signal?.throwIfAborted()
  const scene = createRefinedBlankDocument('island', options)
  registerNearSideArt(scene)
  return finish(scene, false, signal)
}
