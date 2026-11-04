import 'fake-indexeddb/auto'
import { createShoreBlankDocument } from '../../platform/browser/content/shore-blank.js'
import { emptyCompositionDocument } from '../../shared/terrain-generation/composition-materialize.js'
import { prepareCompositionCommands } from './prepare.js'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createRefinedBlankDocument } from '../../platform/browser/content/refined-blank.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { TASK_BUDGET_PROFILES } from '../../shared/budget/task-budget.js'
import { inspectDependencies } from '../../shared/geometry/dependencies.js'
import { sha256Bytes } from '../../shared/project/binary.js'
import { createMemoryResources } from '../../shared/project/resources.js'
import { compositionOutputHash } from '../../shared/terrain-generation/composition-integrity.js'
import { captureJson, encodeUtf8 } from '../../shared/validation/json.js'
import { fromBundle, toBundle, type EditableProject } from './project.js'
import { prepareTerrainProject } from './terrain.js'
import { prepareTerrainComposition } from './terrain-composition.js'
import { Workspace } from './workspace.js'
import { NOW, pixelPng, runtime, validation } from './test-fixtures.js'

const profile = TASK_BUDGET_PROFILES.small
const repositories: ProjectRepository[] = [], sessions: Workspace[] = []
async function blank(version:4|5=4): Promise<EditableProject> {
  const document = captureJson((version===5?createShoreBlankDocument:createRefinedBlankDocument)('island', { title: 'new4 editable fixture', sceneId: runtime.ids.nextId(), now: NOW, widthMm: 24000, heightMm: 18000, preset: 'narrative' }))
  const bytes = pixelPng([74,108,61,255]), hash = sha256Bytes(bytes)
  for (const asset of Object.values(document.assets)) Object.assign(asset, { sha256: hash, mimeType: 'image/png', pixelWidth: 1, pixelHeight: 1 })
  const text = 'Original profiled local real PNG fixture', licenseHash = sha256Bytes(encodeUtf8(text)), content = createCompositionContent(document, runtime)
  return fromBundle({ project: { format: 'sceneweave-complete-project', schemaVersion: 2, ...content,
    assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: bytes.length, pixelWidth: 1, pixelHeight: 1 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text } }, licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' as const })), authoringSources: {} },
    resources: createMemoryResources(new Map([[hash, bytes]])) }, validation)
}
async function session(project: EditableProject) {
  const repo = new ProjectRepository({ name: `profiled-local-${crypto.randomUUID()}`, runtime, validation }); repositories.push(repo)
  const initial = new Workspace(repo, { runtime, validation }); sessions.push(initial)
  await initial.adoptNew(project)
  const sceneId = initial.getDocument()!.sceneId
  await initial.close()
  const cold = (await repo.load(sceneId))!
  const workspace = new Workspace(repo, { runtime, validation }); sessions.push(workspace)
  await workspace.openPersisted(await fromBundle(cold, validation))
  return { workspace, repo }
}
afterEach(async () => {
  for (const workspace of sessions.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name = repo.database.name; repo.close(); await Dexie.delete(name) }
})

describe('persisted new4/new5 maps remain manually editable under a frozen local task budget', () => {
  it.each([4,5] as const)('cold reads algorithm%s, binds one profile, adopts a real edit and undoes once', async version => {
    const profile=version===5?TASK_BUDGET_PROFILES.standard:TASK_BUDGET_PROFILES.small
    const base = await blank(version), generated = await prepareTerrainProject(base, { sceneId: base.document.sceneId, kind: 'island', seed: 'terrain-v1-0', algorithmVersion: version, budgetProfileId: profile.profileId, quality: 'standard' }, { runtime, validation, budget: profile })
    const { workspace, repo } = await session(generated.project), before = toBundle(workspace.getState().project!).project
    const prop = Object.values(before.document.props)[0], request = { kind: 'brush' as const, sceneId: before.document.sceneId, operationId: 'manual-new4-clear', floorId: 'visual-floor', scopeMm: before.document.exportBoundsMm,
      linkMode: 'scenery' as const, mode: 'clearArea' as const, targetAreaId: prop.supportRef.kind === 'terrainArea' ? prop.supportRef.id : 'terrain-low', materialRef: null, elevationMm: null, strokes: [{ pointsMm: [prop.positionMm], radiusMm: 300 }] }
    const preview = await workspace.previewTerrainEdit(request)
    expect(preview.profileHash).toBe(profile.profileHash); expect(preview.cost.limit).toBe(profile.semanticTargets)
    expect(preview.usage!.assetBytes).toBe(Object.values(before.assets).reduce((sum, row) => sum + row.sizeBytes, 0))
    expect(preview.document.props[prop.id]).toBeUndefined()
    await expect(workspace.previewTerrainEdit(request, { result: preview.result, budget: version===5?TASK_BUDGET_PROFILES.expanded:TASK_BUDGET_PROFILES.standard })).rejects.toThrow(/重放不符/)
    const adopted = await workspace.adoptTerrainEdit(preview); await adopted.save
    expect((await repo.load(before.document.sceneId))!.project.document.props[prop.id]).toBeUndefined()
    workspace.undo(); expect(workspace.getDocument()!.props).toEqual(before.document.props)
    expect(workspace.getDocument()!.revision).toBe(before.document.revision + 2)
    workspace.redo(); expect(workspace.getDocument()!.props[prop.id]).toBeUndefined()
  }, 120000)
  it.each([4,5] as const)('cold reads recipe%s, refreshes actual scenery with full resource admission and preserves one undo unit', async version => {
    const profile=version===5?TASK_BUDGET_PROFILES.standard:TASK_BUDGET_PROFILES.small
    const base = await blank(version), generated = await prepareTerrainComposition(base, { sceneId: base.document.sceneId, preset: 'archipelago', seed: 'terrain-v1-0', widthMm: 24000, heightMm: 18000,
      recipeVersion: version, budgetProfileId: profile.profileId, quality: 'standard' }, { runtime, validation, budget: profile })
    const document = captureJson(generated.project.document), area = Object.values(document.terrainAreas).find(row => !row.blocksMovement)!
    const definition = Object.values(document.propDefinitions).sort((a,b) => a.defaultFootprintMm.width - b.defaultFootprintMm.width)[0]
    document.scatterGroups['profiled-trees'] = { id: 'profiled-trees', floorId: area.floorId, editLocked: false, visibility: 'public', domain: { kind: 'area', areaId: area.id },
      palette: [{ key: 'tree', propDefinitionRef: { id: definition.id, version: definition.version }, weight: 1 }], seed: 'new4-local-scenery', algorithmVersion: 'scatter-cell-v1',
      gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 2500, densityFactor: 1, minDistanceMm: 200, rotationRangeDeg: { min: 0, max: 10 }, members: {}, exclusions: [] }
    document.entityLayers['profiled-trees'] = 'visual-layer-ground'
    const content = createCompositionContent(document, runtime)
    if (content.document.generation?.version !== 5) throw new Error('Expected real composition')
    for (const row of Object.values(content.document.generation.compositions)) row.outputHash = compositionOutputHash(content.document, row, content.historyIdentity)
    const bundle = toBundle(generated.project), project = await fromBundle({ ...bundle, project: { ...bundle.project, ...content } }, validation)
    const { workspace, repo } = await session(project), before = toBundle(workspace.getState().project!).project
    const request = { sceneId: before.document.sceneId, scopeMm: before.document.exportBoundsMm, sceneryGroupIds: ['profiled-trees'], transitionIds: [] }
    const preview = await workspace.previewTerrainLocalRefresh(request)
    expect(preview.profileHash).toBe(profile.profileHash); expect(preview.cost.limit).toBe(profile.semanticTargets)
    expect(Object.keys(preview.document.props).length).toBeGreaterThan(Object.keys(before.document.props).length)
    expect(preview.usage!.assetBytes).toBe(Object.values(before.assets).reduce((sum, row) => sum + row.sizeBytes, 0))
    await expect(workspace.previewTerrainLocalRefresh(request, { result: preview.result, budget: version===5?TASK_BUDGET_PROFILES.expanded:TASK_BUDGET_PROFILES.standard })).rejects.toThrow(/重放不符/)
    const adopted = await workspace.adoptTerrainLocalRefresh(preview); await adopted.save
    expect((await repo.load(before.document.sceneId))!.project.document.scatterGroups['profiled-trees'].members).toEqual(preview.document.scatterGroups['profiled-trees'].members)
    workspace.undo(); expect(workspace.getDocument()!.props).toEqual(before.document.props); expect(workspace.getDocument()!.scatterGroups).toEqual(before.document.scatterGroups)
    expect(workspace.getDocument()!.revision).toBe(before.document.revision + 2)
  }, 120000)
  it('passes an explicit 200-target profile through full appearance materialization while legacy256 stays closed', async () => {
    const source = await blank(), document = emptyCompositionDocument(source.document), definition = Object.values(document.propDefinitions)[0], floorId = Object.keys(document.floors)[0]
    for (let i=0;i<200;i++) {
      const id=`profiled-prop-${i}`
      document.props[id]={id,floorId,editLocked:false,visibility:'public',definitionRef:{id:definition.id,version:definition.version},appearance:captureJson(definition.defaultAppearance),
        positionMm:{x:12000,y:9000},rotationDeg:0,visualBoundsMm:captureJson(definition.defaultVisualBoundsMm),footprintMm:captureJson(definition.defaultFootprintMm),
        footprintOffsetMm:captureJson(definition.defaultFootprintOffsetMm),blocksMovement:definition.defaultBlocksMovement,blocksSight:definition.defaultBlocksSight,
        supportRef:{kind:'floor',id:floorId},renderLayer:definition.defaultRenderLayer,renderOrder:i,shadowClass:definition.defaultShadowClass,shadowOverride:null}
      document.entityLayers[id]='visual-layer-ground'
    }
    const bundle=toBundle(source),content=createCompositionContent(document,runtime),project=await fromBundle({...bundle,project:{...bundle.project,...content,schemaVersion:4}},validation)
    const command={type:'setAppearanceAdjustment' as const,scope:{kind:'targets' as const,ids:Object.keys(document.props)},adjustment:{id:'bulk-opacity',kind:'opacity' as const,value:.5,enabled:true}}
    await expect(prepareCompositionCommands(project,[command],{runtime,validation})).rejects.toThrow(/256/)
    const prepared=await prepareCompositionCommands(project,[command],{runtime,validation,budget:profile})
    expect(Object.values(prepared.document.props)).toHaveLength(200)
    expect(Object.values(prepared.document.props).every(prop=>prop.appearance.opacity===.5)).toBe(true)
  },120000)

})
