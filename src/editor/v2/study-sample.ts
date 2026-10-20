import licenseText from '../../../assets/sceneweave-handdrawn/LICENSE.txt?raw'
import artManifest from '../../../assets/sceneweave-handdrawn/manifest.json'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { openingEndpointsV2, polygonsOverlapV2, propFootprintV2 } from '../../core/v2/geometry'
import { validateSceneV2 } from '../../core/v2/schema'
import type { AssetRef, MaterialRef, PointMm, PrefabDefinition, PropDefinition, PropTemplate, PropV2, SceneDocumentV2, StyleTheme, SurfaceStyle } from '../../core/v2/types'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import { sha256Bytes, validateImageAssetRecord } from '../../io/v2/resources'
import type { AssetBlobRecord, CompleteProjectV2 } from '../../io/v2/types'
import { STUDY_PRESET_ID, validateStudyEditsV2 } from './study-constraints'

/** Snapshot identities are separate from the permanent catalog identities in the manifest. */
export const STUDY_IDS = {
  floor: 'study-floor', room: 'study-room', terrace: 'terrace-area',
  deskGroup: 'study-group', terraceGroup: 'terrace-group', theme: 'b2-theme-01',
  materials: { woodDark: 'b2-m-01', woodWorn: 'b2-m-02', paver: 'b2-m-03', wallStone: 'b2-m-04' },
} as const
const origin: AssetRef['origin'] = { kind: 'original', attribution: 'Sceneweave contributors；项目原创 SVG 绘制，Codex 辅助；源文件及 MIT 记录随仓库保存', canEmbed: true }
const bounds = { x: 0, y: 0, width: 14000, height: 10000 }
const entryId = (index: number) => `b2-a-${String(index + 1).padStart(2, '0')}`
const materialId = (index: number) => `b2-m-${String(index + 1).padStart(2, '0')}`
const definitionId = (index: number) => `b2-p-${String(index + 1).padStart(2, '0')}`
const versionRef = (id: string) => ({ id, version: 1 })
const style = (id: string): SurfaceStyle => ({ base: { materialRef: versionRef(id), tileSizeMm: { width: 2000, height: 2000 }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] })

function template(definition: PropDefinition, x = 0, y = 0, rotationDeg = 0, renderOrder = 0): PropTemplate {
  return { definitionRef: versionRef(definition.id), appearance: structuredClone(definition.defaultAppearance),
    positionMm: { x, y }, rotationDeg, visualBoundsMm: { ...definition.defaultVisualBoundsMm },
    footprintMm: { ...definition.defaultFootprintMm }, footprintOffsetMm: { ...definition.defaultFootprintOffsetMm },
    blocksMovement: definition.defaultBlocksMovement, blocksSight: definition.defaultBlocksSight,
    renderLayer: definition.defaultRenderLayer, renderOrder, shadowClass: definition.defaultShadowClass, shadowOverride: null }
}

/** Pure fixture construction. Image bytes are loaded and really decoded by createStudyProject. */
export function createStudyDocument(options: { sceneId?: string; now?: string } = {}): SceneDocumentV2 {
  const stamp = options.now ?? new Date().toISOString(), floorId = STUDY_IDS.floor
  const scene: SceneDocumentV2 = {
    format: 'sceneweave', schemaVersion: 2, sceneId: options.sceneId ?? crypto.randomUUID(), revision: 0,
    title: '书房与露台 · 墨绘原野', createdAt: stamp, updatedAt: stamp,
    units: { world: 'mm', display: 'm', gridSizeMm: 1000, snapMm: 100, gridVisible: false },
    exportBoundsMm: { ...bounds }, floors: { [floorId]: { id: floorId, name: '一层 · 室内与露台', boundsMm: { ...bounds } } },
    vertices: {}, walls: {}, openings: {}, rooms: {}, props: {}, regions: {}, notes: {}, assets: {},
    propDefinitions: {}, materials: {}, terrainAreas: {}, terrainEdges: {}, terrainConnections: {}, paths: {},
    prefabDefinitions: {}, prefabInstances: {}, scatterGroups: {}, styleThemes: {}, activeStyleThemeRef: versionRef(STUDY_IDS.theme),
    presetSnapshot: { presetId: STUDY_PRESET_ID, presetVersion: 1, distanceMode: 'metric', source: 'Sceneweave 原创 VIS-01 米制样板与两处门口预留区；不含任何官方规则文本', gridSizeMm: 1000 },
    constraints: { entranceOpeningIds: ['entrance-door'], wallEndClearanceMm: 100, minDoorWidthMm: 900, pathChecks: [] },
  }
  const materialEntries = artManifest.assets.filter(entry => entry.kind === 'material')
  const propEntries = artManifest.assets.filter(entry => entry.kind === 'prop')
  for (const [index, entry] of artManifest.assets.entries()) {
    const id = entryId(index)
    scene.assets[id] = { id, sha256: entry.sha256, mimeType: 'image/png', pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight,
      logicalSizeMm: { ...entry.logicalSizeMm }, licenseRef: 'MIT', origin: { ...origin } }
  }
  for (const [index, entry] of materialEntries.entries()) {
    const id = materialId(index), assetIndex = artManifest.assets.findIndex(item => item.catalogId === entry.catalogId)
    scene.materials[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', 'VIS-01', '原创'],
      licenseRef: 'MIT', origin: { ...origin }, textureAssetId: entryId(assetIndex), defaultTileSizeMm: { ...entry.logicalSizeMm },
      applicableSurfaces: entry.surfaces as MaterialRef['applicableSurfaces'] }
  }
  for (const [index, entry] of propEntries.entries()) {
    const id = definitionId(index), assetIndex = artManifest.assets.findIndex(item => item.catalogId === entry.catalogId)
    scene.propDefinitions[id] = { id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', 'VIS-01', '原创'],
      licenseRef: 'MIT', origin: { ...origin }, defaultAppearance: { kind: 'image', assetId: entryId(assetIndex), tint: null, opacity: 1 },
      defaultVisualBoundsMm: { ...entry.visualBoundsMm! }, defaultFootprintMm: { ...entry.footprintMm! }, defaultFootprintOffsetMm: { ...entry.footprintOffsetMm! },
      defaultBlocksMovement: entry.blocksMovement!, defaultBlocksSight: entry.blocksSight!, defaultRenderLayer: entry.renderLayer as PropDefinition['defaultRenderLayer'], defaultShadowClass: entry.shadowClass as PropDefinition['defaultShadowClass'] }
  }
  const studyPoints = [[1000, 1000], [8000, 1000], [9000, 2000], [9000, 7000], [1000, 7000]]
  for (const [index, [xMm, yMm]] of studyPoints.entries()) {
    const id = `study-v${index}`, wallId = `study-w${index}`
    scene.vertices[id] = { id, floorId, editLocked: false, xMm, yMm }
    scene.walls[wallId] = { id: wallId, floorId, editLocked: false, startVertexId: id, endVertexId: `study-v${(index + 1) % studyPoints.length}`,
      thicknessMm: 200, blocksMovement: true, blocksSight: true, topStyle: style(STUDY_IDS.materials.wallStone) }
  }
  scene.rooms[STUDY_IDS.room] = { id: STUDY_IDS.room, floorId, editLocked: false, boundaryVertexIds: studyPoints.map((_, index) => `study-v${index}`), purpose: '旧宅书房',
    visibility: 'public', accessExpectation: 'required', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0, floorStyle: style(STUDY_IDS.materials.woodDark) }
  // One east wall belongs to the room. The neighboring terrace is an open terrain surface.
  scene.terrainAreas[STUDY_IDS.terrace] = { id: STUDY_IDS.terrace, floorId, editLocked: false, visibility: 'public',
    boundaryMm: [[9000, 2500], [13000, 2500], [13000, 7000], [9000, 7000]].map(([x, y], index) => ({ id: `terrace-v${index}`, segmentId: `terrace-s${index}`, positionMm: { x, y } })),
    groundElevationMm: 0, coveragePriority: 1, surfaceStyle: style(STUDY_IDS.materials.paver), blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
  const opening = (id: string, wallId: string, ref: string, offsetMm: number, widthMm: number, kind: 'door' | 'window') => {
    scene.openings[id] = { id, floorId, editLocked: false, wallId, offsetReferenceVertexId: ref, offsetMm, widthMm, kind,
      state: kind === 'window' ? 'closed' : 'open', locked: false, secret: false, revealed: false }
  }
  // Stable near-end offsets, measured along the wall rather than at the opening center.
  opening('entrance-door', 'study-w3', 'study-v4', 2500, 1000, 'door')
  opening('terrace-door', 'study-w2', 'study-v2', 1900, 1200, 'door')
  opening('diagonal-window', 'study-w1', 'study-v1', 400, 600, 'window')
  const definition = (key: string): PropDefinition => {
    const found = Object.values(scene.propDefinitions).find(item => item.catalogId === `prop.sw.${key}`)
    if (!found) throw new Error(`样板缺少组件定义：${key}`)
    return found
  }
  const study: PrefabDefinition = { id: 'b2-pf-01', catalogId: 'prefab.sw.study-desk', version: 1, name: '书桌六件组', tags: ['墨绘原野', '书房'], licenseRef: 'MIT', origin: { ...origin },
    members: [
      { key: 'desk', propTemplate: template(definition('desk-oak')) },
      { key: 'chair', propTemplate: template(definition('chair-oak'), 0, 900) },
      { key: 'books-left', propTemplate: template(definition('book-stack'), -450, -100, 0, 10) },
      { key: 'books-middle', propTemplate: template(definition('book-stack'), 0, -100, 0, 10) },
      { key: 'books-right', propTemplate: template(definition('book-stack'), 450, -100, 0, 10) },
      { key: 'papers', propTemplate: template(definition('papers'), 550, 175, 0, 20) },
    ] }
  const terrace: PrefabDefinition = { id: 'b2-pf-02', catalogId: 'prefab.sw.terrace-table', version: 1, name: '露台一桌两椅', tags: ['墨绘原野', '露台'], licenseRef: 'MIT', origin: { ...origin },
    members: [{ key: 'table', propTemplate: template(definition('table-round')) }, { key: 'chair-north', propTemplate: template(definition('chair-oak'), 0, -1000, 180) }, { key: 'chair-south', propTemplate: template(definition('chair-oak'), 0, 1000) }] }
  for (const item of [study, terrace]) scene.prefabDefinitions[item.id] = item
  const placeGroup = (id: string, prefab: PrefabDefinition, anchorMm: PointMm, outside: boolean) => {
    scene.prefabInstances[id] = { id, floorId, editLocked: false, visibility: 'public', definitionRef: versionRef(prefab.id), anchorMm, rotationDeg: 0, members: {} }
    for (const member of prefab.members) {
      const propId = `${id === STUDY_IDS.deskGroup ? 'study' : 'terrace'}-${member.key}`, adopted = structuredClone(member.propTemplate)
      const prop: PropV2 = { id: propId, floorId, editLocked: false, ...adopted,
        positionMm: { x: anchorMm.x + adopted.positionMm.x, y: anchorMm.y + adopted.positionMm.y }, visibility: 'public',
        supportRef: outside ? { kind: 'terrainArea', id: STUDY_IDS.terrace } : { kind: 'room', id: STUDY_IDS.room },
        ...(outside ? {} : { roomId: STUDY_IDS.room }) }
      scene.props[propId] = prop
      scene.prefabInstances[id].members[member.key] = { propId, overrideFields: [] }
    }
  }
  placeGroup(STUDY_IDS.deskGroup, study, { x: 3000, y: 2500 }, false)
  placeGroup(STUDY_IDS.terraceGroup, terrace, { x: 11100, y: 4400 }, true)
  const place = (id: string, key: string, positionMm: PointMm, outside = false, renderOrder = 0, visibility: 'public' | 'gm' = 'public') => {
    scene.props[id] = { id, floorId, editLocked: false, ...template(definition(key), positionMm.x, positionMm.y, 0, renderOrder), visibility,
      supportRef: outside ? { kind: 'terrainArea', id: STUDY_IDS.terrace } : { kind: 'room', id: STUDY_IDS.room }, ...(outside ? {} : { roomId: STUDY_IDS.room }) }
  }
  place('study-bookshelf', 'bookshelf', { x: 1800, y: 4500 })
  place('study-rug', 'rug-study', { x: 5600, y: 4400 })
  place('terrace-flowerpot', 'flowerpot', { x: 12300, y: 3000 }, true)
  place('study-lamp', 'lamp-table', { x: 2300, y: 2300 }, false, 30)
  const shadow = (offsetMm: number, blurMm: number, opacity: number) => ({ directionDeg: 45, offsetMm, blurMm, opacity, color: '#24313A' })
  const theme: StyleTheme = { id: STUDY_IDS.theme, catalogId: 'sceneweave-handdrawn', version: 1, name: '墨绘原野',
    licenseRef: 'MIT', origin: { ...origin }, materialSuggestions: Object.keys(scene.materials).map(versionRef), propSuggestions: Object.keys(scene.propDefinitions).map(versionRef), prefabSuggestions: Object.keys(scene.prefabDefinitions).map(versionRef),
    outline: { widthMm: 24, color: '#30382F' }, openingStyle: { doorStrokeWidthMm: 16, windowStrokeWidthMm: 12, frameWidthMm: 60, doorFill: '#99734F', windowFill: '#A9C4BE' },
    edgeStyles: { shore: { strokeWidthMm: 12, color: '#D9D4B4', bandWidthMm: 180 }, cliff: { strokeWidthMm: 24, color: '#39443E', bandWidthMm: 450 }, materialTransition: { strokeWidthMm: 0, color: '#71865A', bandWidthMm: 250 }, path: { strokeWidthMm: 0, color: '#9B8B68', bandWidthMm: 150 } },
    shadowPresets: { none: shadow(0, 0, 0), furniture: shadow(120, 80, .22), vegetation: shadow(350, 180, .20), wall: shadow(160, 100, .24) },
    terrainCliff: { directionDeg: 45, offsetFactor: .18, maxOffsetMm: 600, blurMm: 120, opacity: .24, color: '#24313A' } }
  scene.styleThemes[theme.id] = theme
  const checked = validateSceneV2(scene)
  if (!checked.ok) throw new Error(`书房样板校验失败：${checked.errors.map(item => `${item.code}: ${item.message}`).join('；')}`)
  validateStudyEditsV2(checked.document)
  return checked.document
}

/** Separate fixed-mask QA copy; the ordinary study has no GM props and no mask. */
export function createStudyPrivacyDocument(variant: 'a' | 'b', options: { sceneId?: string; now?: string } = {}): SceneDocumentV2 {
  if (variant !== 'a' && variant !== 'b') throw new Error('隐私样板只接受 a 或 b 变体。')
  const document = createStudyDocument({ sceneId: 'study-privacy-fixture', now: '2026-10-20T00:00:00.000Z', ...options })
  const envelope = Object.values(document.propDefinitions).find(item => item.catalogId === 'prop.sw.envelope')!
  const papers = Object.values(document.propDefinitions).find(item => item.catalogId === 'prop.sw.papers')!
  const base = template(envelope, variant === 'a' ? 3080 : 3300, variant === 'a' ? 2700 : 2800, variant === 'a' ? 0 : 32, 20)
  document.title = '书房与露台 · 固定遮罩隐私验收副本'
  document.regions['study-privacy-mask'] = { id: 'study-privacy-mask', floorId: STUDY_IDS.floor, editLocked: false,
    boundaryMm: [{ x: 1800, y: 1400 }, { x: 4200, y: 1400 }, { x: 4200, y: 4000 }, { x: 1800, y: 4000 }],
    kind: 'manualMask', visibility: 'gm', blocksMovement: false, movementCostMultiplier: 1 }
  document.props['study-envelope'] = { id: 'study-envelope', floorId: STUDY_IDS.floor, editLocked: false, ...base,
    appearance: structuredClone(variant === 'a' ? envelope.defaultAppearance : papers.defaultAppearance),
    shadowOverride: variant === 'a' ? null : { directionDeg: 45, offsetMm: 140, blurMm: 40, opacity: .27, color: '#4B4650' },
    visibility: 'gm', roomId: STUDY_IDS.room, supportRef: { kind: 'room', id: STUDY_IDS.room } }
  document.notes['study-clue'] = { id: 'study-clue', floorId: STUDY_IDS.floor, editLocked: false,
    anchor: { type: 'entity', entityKind: 'prop', entityId: 'study-envelope' }, kind: 'clue',
    title: variant === 'a' ? '未寄出的信 A' : '纸上的密语 B',
    text: variant === 'a' ? 'SECRET-STUDY-A：封蜡完整，落款处留白。' : 'SECRET-STUDY-B：另一个线索与不同纸张；此文字仅属主持人。',
    visibility: 'gm', discovered: false }
  document.generationMetadata = { generatorVersion: 'privacy-fixture-v1', seed: `private-${variant}`, summary: `SECRET-STUDY-${variant.toUpperCase()}`, adoptedAt: document.createdAt }
  const checked = validateSceneV2(document)
  if (!checked.ok) throw new Error(`书房隐私副本校验失败：${checked.errors.map(item => `${item.code}: ${item.message}`).join('；')}`)
  return checked.document
}

/**
 * Fixed VIS-01 fixture approaches only. This is a full rotated-footprint intersection
 * check against two explicit rectangles, not an all-map pathfinding/clearance solver.
 */
export function checkStudyDoorwayClearances(scene: SceneDocumentV2) {
  const fixtures = [
    { openingId: 'entrance-door', widthMm: 1000, expected: [{ x: 3500, y: 7000 }, { x: 4500, y: 7000 }], boundaryMm: [{ x: 3500, y: 6000 }, { x: 4500, y: 6000 }, { x: 4500, y: 8000 }, { x: 3500, y: 8000 }] },
    { openingId: 'terrace-door', widthMm: 1200, expected: [{ x: 9000, y: 3900 }, { x: 9000, y: 5100 }], boundaryMm: [{ x: 8000, y: 3900 }, { x: 10500, y: 3900 }, { x: 10500, y: 5100 }, { x: 8000, y: 5100 }] },
  ]
  return fixtures.map(fixture => {
    const opening = scene.openings[fixture.openingId]
    const endpoints = opening ? openingEndpointsV2(scene, opening) : []
    const aligned = endpoints.length === 2 && fixture.expected.every(p => endpoints.some(value => Math.abs(value.x - p.x) < 1e-6 && Math.abs(value.y - p.y) < 1e-6))
    const blockingPropIds = Object.values(scene.props).filter(prop => prop.blocksMovement && polygonsOverlapV2(propFootprintV2(prop), fixture.boundaryMm)).map(prop => prop.id).sort()
    return { openingId: fixture.openingId, widthMm: fixture.widthMm, boundaryMm: fixture.boundaryMm, aligned,
      blockingPropIds, ok: aligned && opening.widthMm >= fixture.widthMm && blockingPropIds.length === 0 }
  })
}

/** Create a complete offline-portable project. No URL survives as a resource dependency. */
export async function createStudyProject(signal?: AbortSignal): Promise<CompleteProjectV2> {
  signal?.throwIfAborted()
  const document = createStudyDocument(), assets: Record<string, AssetBlobRecord> = {}
  for (const entry of artManifest.assets) {
    signal?.throwIfAborted()
    const response = await fetch(`${import.meta.env.BASE_URL}assets/sceneweave-handdrawn/${entry.file}`, { signal })
    if (!response.ok) throw new Error(`样板素材读取失败：${entry.file} (${response.status})`)
    const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
    const record: AssetBlobRecord = { sha256: entry.sha256, blob, mimeType: 'image/png', sizeBytes: entry.sizeBytes, pixelWidth: entry.pixelWidth, pixelHeight: entry.pixelHeight }
    // Authored static PNG already has metadata-free sRGB bytes; retain the manifest hash.
    await validateImageAssetRecord(record, { signal })
    assets[record.sha256] = record
  }
  const licenseHash = await sha256Bytes(new TextEncoder().encode(licenseText))
  const project: CompleteProjectV2 = { document, assets, licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } },
    licenseBindings: collectDependenciesV2(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })) }
  await validateCompleteProjectV2(project, { signal })
  signal?.throwIfAborted()
  return project
}
