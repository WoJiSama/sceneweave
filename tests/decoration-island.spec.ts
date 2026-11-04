import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { EditableProject } from '../src/application/workspace/project'
import type { TerrainArea } from '../src/shared/model/scene'

test('actual surface5 island retains terrain and receives two explicit supported clusters with complete resource and private pixel proof', async ({ page }, info) => {
  test.setTimeout(300000)
  await page.goto('/')
  const proof = await page.evaluate(async () => {
    const paths = { blank:'/src/platform/browser/content/shore-blank.ts', protocol:'/src/shared/terrain-generation/base-map-v3.ts', prepare:'/src/application/workspace/base-map.ts', budget:'/src/shared/budget/task-budget.ts', terrain:'/src/application/workspace/terrain-composition.ts', connection:'/src/application/workspace/connection-upgrade.ts', decoration:'/src/application/workspace/decoration-upgrade.ts', catalog:'/src/editor/main/catalog.ts', variants:'/src/platform/browser/content/terrain-variant-catalog.ts', workspace:'/src/application/workspace/workspace.ts', repository:'/src/platform/browser/storage/repository.ts', runtime:'/src/platform/browser/runtime.ts', project:'/src/application/workspace/project.ts', hash:'/src/shared/project/validate.ts', file:'/src/shared/project/file.ts', renderer:'/src/platform/browser/render/renderer.ts', pixel:'/src/shared/validation/hash.ts', geometry:'/src/shared/decorations/geometry.ts', generate:'/src/shared/decorations/generate.ts', polygon:'/src/shared/geometry/geometry.ts', lifecycle:'/src/shared/terrain-generation/integrity.ts', compositionLifecycle:'/src/shared/terrain-generation/composition-lifecycle.ts' }
    const { detachChangedOutputs } = await import(paths.lifecycle), { pauseChangedCompositions } = await import(paths.compositionLifecycle)
    const { createShoreBlankProject } = await import(paths.blank), { prepareBaseMapRequestV3, executeBaseMapRequestV3 } = await import(paths.protocol), { prepareBaseMapProject } = await import(paths.prepare), { taskBudgetProfile } = await import(paths.budget), { prepareCompositionUpgrade } = await import(paths.terrain), { prepareConnectionUpgrade } = await import(paths.connection), { prepareDecorationUpgrade } = await import(paths.decoration)
    const { describeCatalogItems, prepareCatalogEntry, prepareCatalogAdoption } = await import(paths.catalog), { createTerrainVariantCatalogProject, TERRAIN_VARIANT_SPECS } = await import(paths.variants), { Workspace } = await import(paths.workspace), { ProjectRepository } = await import(paths.repository), { runtime, validation } = await import(paths.runtime), { toBundle, captureEditableDraft, validateEditableProject } = await import(paths.project), { projectContentHash } = await import(paths.hash), { exportProject, importProject } = await import(paths.file), { renderProject } = await import(paths.renderer), { sha256Bytes } = await import(paths.pixel), { decorationAsProp, conservativePropPaintEnvelope } = await import(paths.geometry), { decorationProtectedGeometry } = await import(paths.generate), { polygonDistance } = await import(paths.polygon)
    const options = { runtime, validation }, base = await createShoreBlankProject('island', { sceneId:runtime.ids.nextId(), title:'簇状岩岛实际样例', now:'2026-10-31T00:00:00.000Z', widthMm:24000, heightMm:18000, preset:'narrative', gridVisible:false }), profile = taskBudgetProfile('standard')
    const request = prepareBaseMapRequestV3({ requestId:runtime.ids.nextId(), flowId:runtime.ids.nextId(), workspaceSceneId:base.document.sceneId, checkpoint:0, operationEpoch:1, profile, base:base.document, generation:{ kind:'terrain', input:{ sceneId:base.document.sceneId, kind:'island', seed:'terrain-v1-0', widthMm:24000, heightMm:18000, algorithmVersion:5, budgetProfileId:profile.profileId, quality:'standard' } } })
    const generated = (await prepareBaseMapProject(base, request, executeBaseMapRequestV3(request), options)).project as EditableProject
    const v6 = await prepareDecorationUpgrade(await prepareConnectionUpgrade(await prepareCompositionUpgrade(generated, options), options), options)
    const repo = new ProjectRepository({ name:`clusters-island-${crypto.randomUUID()}`, runtime, validation }), session = new Workspace(repo, options)
    const b64 = (bytes:Uint8Array) => { let s=''; for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(s) }
    try {
      await session.adoptNew(v6)
      const provider = await createTerrainVariantCatalogProject(), entries = []
      for (const item of describeCatalogItems(provider)) if (item.selector.kind === 'prop') entries.push(await prepareCatalogEntry(provider, item.selector))
      const catalog = (await prepareCatalogAdoption(session.getState().project, entries)).project
      await session.adoptPreview(await session.previewPrepared(catalog, 'explicit reusable original sprite catalog')); await session.flush()
      const areas = (Object.values(v6.document.terrainAreas) as TerrainArea[]).filter(area => !area.blocksMovement && area.groundElevationMm > 0).sort((a,b) => b.groundElevationMm-a.groundElevationMm)
      if (areas.length < 2) throw new Error('Fixed island must contain real crown and rock supports.')
      const beforeTerrain = JSON.stringify({ areas:v6.document.terrainAreas, paths:v6.document.paths, connections:v6.document.terrainConnections }), rows = []
      for (const [index, area] of areas.slice(0,2).entries()) {
        const points = area.boundaryMm.map(row => row.positionMm), x = Math.min(...points.map(p=>p.x)), y = Math.min(...points.map(p=>p.y)), width = Math.max(...points.map(p=>p.x))-x, height = Math.max(...points.map(p=>p.y))-y
        const specs = index ? TERRAIN_VARIANT_SPECS.filter((row:{blocksMovement:boolean;blocksSight:boolean})=>!row.blocksMovement&&!row.blocksSight) : TERRAIN_VARIANT_SPECS
        const input = { type:'createDecorationCluster', id:runtime.ids.nextId(), floorId:area.floorId, layerId:v6.document.entityLayers[area.id], visibility:'public', supportRef:{kind:'terrainArea',id:area.id}, boundsMm:{x,y,width,height}, seed:`island-cluster-${index}`, maxInstances:index?24:16, spacingMm:350, clusterRadiusMm:3600, clearanceMm:400, palette:specs.map((row:{key:string;definitionId:string;blocksMovement:boolean;blocksSight:boolean})=>({key:row.key,definitionRef:{id:row.definitionId,version:1},kind:row.blocksMovement||row.blocksSight?'prop':'decoration',weight:row.blocksMovement||row.blocksSight?1:3})) }
        const checkpoint = session.checkpoint(), preview = await session.previewDecorationCommands(session.getState().project, [input], {checkpoint})
        await session.adoptPreview(preview); await session.flush()
        const current = session.getState().project as EditableProject, group = current.document.decorationClusters![input.id]
        const protection = decorationProtectedGeometry(current.document, group)
        for (const member of Object.values(group.members)) if (member.entityId) { const row = member.kind === 'prop' ? current.document.props[member.entityId] : decorationAsProp(current.document,current.document.decorations![member.entityId]); const paint=conservativePropPaintEnvelope(row); if(protection.some((p:{polygon:{x:number;y:number}[];marginMm:number})=>polygonDistance(paint,p.polygon)<p.marginMm)) throw new Error('Actual island paint violates reserved activity/route clearance.') }
        rows.push({id:group.id,supportId:area.id,members:Object.values(group.members).filter(row=>row.entityId).length,compact:Object.values(group.members).filter(row=>row.entityId&&row.kind==='decoration').length})
      }
      const current = session.getState().project as EditableProject
      if(JSON.stringify({areas:current.document.terrainAreas,paths:current.document.paths,connections:current.document.terrainConnections})!==beforeTerrain) throw new Error('Clustered dressing changed the physical terrain or stairs.')
      const bundle = toBundle(current), bytes = await exportProject(bundle,validation), round = await importProject(bytes,validation), cold = await repo.load(current.document.sceneId)
      if(projectContentHash(round.project)!==projectContentHash(bundle.project)||projectContentHash(cold!.project)!==projectContentHash(bundle.project)) throw new Error('Actual island complete/cold IO mismatch.')
      const outputs=[]
      for(const audience of ['gm','player']) { const canvas=await renderProject(bundle,{audience,longEdgePx:4096});outputs.push({audience,width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png').split(',')[1]}) }
      const privateRows=[]
      for(const scaleReductionPpm of [0,10000]) {
        const draft=captureEditableDraft(current) as EditableProject, group=Object.values(draft.document.decorationClusters!)[0]
        group.visibility='gm'
        for(const member of Object.values(group.members)) if(member.entityId&&member.state!=='detached')member.state='manual'
        const member=Object.values(group.members).find(row=>row.entityId&&row.kind==='decoration')!
        draft.document.decorations![member.entityId!].scalePpm-=scaleReductionPpm
        const b=draft.document.exportBoundsMm, id='private-cluster-fixed-mask'
        draft.document.regions[id]={id,floorId:group.floorId,editLocked:false,visibility:'gm',kind:'manualMask',boundaryMm:[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}],blocksMovement:false,movementCostMultiplier:1};draft.document.entityLayers[id]=draft.document.entityLayers[group.id]
        detachChangedOutputs(current.document,draft.document); pauseChangedCompositions(current.document,draft.document)
        const checked=await validateEditableProject(draft,validation), canvas=await renderProject(toBundle(checked),{audience:'player',longEdgePx:1000}), pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data
        privateRows.push({pixelHash:sha256Bytes(new Uint8Array(pixels.buffer)),png:canvas.toDataURL('image/png').split(',')[1]})
      }
      return {rows,hash:projectContentHash(bundle.project),assets:Object.keys(current.assets).length,outputs,privateRows,package:b64(bytes)}
    } finally { await session.close(); repo.close() }
  })
  expect(proof.rows).toHaveLength(2)
  expect(proof.rows.every(row=>row.members>0&&row.compact>0)).toBe(true)
  expect(proof.privateRows[0].pixelHash).toBe(proof.privateRows[1].pixelHash)
  for(const row of proof.outputs) await writeFile(`work/clustered-dressing-20261031/island-clusters-${row.audience}-4k.png`,Buffer.from(row.png,'base64'))
  for(const [index,row] of proof.privateRows.entries()) await writeFile(info.outputPath(`private-player-${index}.png`),Buffer.from(row.png,'base64'))
  await writeFile(info.outputPath('island-clusters.sceneweave'),Buffer.from(proof.package,'base64'))
  await writeFile(info.outputPath('proof.json'),JSON.stringify({...proof,package:undefined,outputs:proof.outputs.map(({png:_png,...row})=>row),privateRows:proof.privateRows.map(({png:_png,...row})=>row)},null,2))
})
