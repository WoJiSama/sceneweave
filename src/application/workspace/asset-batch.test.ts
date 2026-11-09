import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artworkValidation, ARTWORK_SVG } from '../../../tests/helpers/m24-artwork-fixtures.js'
import { fixture, pixelPng, runtime } from './test-fixtures.js'
import { fromBundle, toBundle, validateEditableProject } from './project.js'
import { AssetBatchImportError, prepareAssetBatchImport, type AssetImportRequest } from './asset-batch.js'
import { prepareAssetImport } from './prepare.js'
import { canonicalJson, encodeUtf8 } from '../../shared/validation/json.js'
import { decodeUtf8, sha256Bytes } from '../../shared/project/binary.js'
import { inspectImageBytes, normalizePngChunks } from '../../shared/project/image-bytes.js'
import { normalizeStaticSvg } from '../../shared/ai/svg.js'
import { exportProject, importProject } from '../../shared/project/file.js'
import { projectContentHash } from '../../shared/project/validate.js'
import { Workspace } from './workspace.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { topDownPresentation } from '../../shared/appearance/presentation.js'

// A fixture import capability is injected at the application port. Complete
// byte/CRC/decode/SVG-pixel checks remain real; browser tests own Canvas/EXIF.
const normalizeImport = vi.fn(async (bytes: Uint8Array, mime?: string) => {
  const before = inspectImageBytes(bytes, false)
  if (mime && mime !== 'application/octet-stream' && mime !== before.mimeType) throw new Error('MIME mismatch')
  const normalized = normalizePngChunks(bytes), header = inspectImageBytes(normalized)
  return { bytes: normalized, record: { sha256: sha256Bytes(normalized), mimeType: header.mimeType, sizeBytes: normalized.length,
    pixelWidth: header.width, pixelHeight: header.height } }
})
const repositories: ProjectRepository[] = [], workspaces: Workspace[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const workspace of workspaces.splice(0)) await workspace.close().catch(() => {})
  for (const repo of repositories.splice(0)) { const name=repo.database.name; repo.close(); await Dexie.delete(name) }
})
const validation = artworkValidation()
validation.images.normalizeImport = normalizeImport
const png = pixelPng([12,34,56,255])
const request = (overrides: Partial<AssetImportRequest> = {}): AssetImportRequest => ({ file: new Blob([new Uint8Array(png)], {type:'image/png'}), name:'Coastal tree', kind:'prop',
  widthMm:1200,heightMm:1800,footprintWidthMm:300,footprintHeightMm:200,rootAnchorMm:{x:600,y:1700}, blocksMovement:false,blocksSight:true,
  tags:['tree','coast'],licenseText:'MIT fixture licence body A',attribution:'Original fixture author',canEmbed:true,...overrides })
const blank = () => fromBundle(fixture({image:true}), validation)

describe('selected batch import is one complete resource candidate', () => {
  it('reuses actual bytes without merging different calibration and reports exact duplicate definitions', async () => {
    const base = await blank(), before = canonicalJson(toBundle(base).project)
    const result = await prepareAssetBatchImport(base,[request(),request({name:'Narrow tree',widthMm:1000,rootAnchorMm:{x:400,y:1700}}),request()],{runtime,validation})
    expect(result.addedDefinitionIds).toHaveLength(2);expect(result.addedAssetIds).toHaveLength(2)
    expect(result.items.map(item=>item.duplicateOf)).toEqual([null,null,0])
    expect(result.items[1].definitionId).not.toBe(result.items[0].definitionId)
    expect(result.items[2].definitionId).toBe(result.items[0].definitionId)
    expect(result.items[1].sha256).toBe(result.items[0].sha256)
    expect(result.reusedResourceCount).toBe(2);expect(result.uniqueImageBytes).toBe(result.items[0].sizeBytes)
    const definition=result.project.document.propDefinitions[result.items[0].definitionId]
    expect(definition.defaultVisualBoundsMm).toEqual({x:-600,y:-1700,width:1200,height:1800})
    expect(definition.defaultFootprintMm).toEqual({width:300,height:200});expect(definition.defaultBlocksSight).toBe(true)
    const fixed = Object.values(result.project.appearance.sources).find(source => source.kind === 'prop' && source.snapshot.definitionRef?.id === definition.id)!
    expect(result.project.appearance.presentations?.[fixed.id]).toEqual(topDownPresentation())
    expect(Object.isFrozen(result.items)).toBe(true)
    expect(canonicalJson(toBundle(base).project)).toBe(before)
    expect(result.project.document.props).toEqual(base.document.props);expect(result.project.document.revision).toBe(base.document.revision)
    expect(await result.project.resources.read(result.items[0].sha256)).toEqual(normalizePngChunks(png))
  })

  it('keeps exact names and explicit physical semantics through capsules and a complete library backup', async () => {
    const base=await blank(), exactName='  老木桌_02.final 🌲  '
    const result=await prepareAssetBatchImport(base,[
      request({name:exactName,footprintOffsetMm:{x:-100,y:250},renderLayer:'ground',shadowClass:'none',tags:[' 标记,原文 ']}),
      request({name:exactName,file:new Blob([new Uint8Array(pixelPng([80,10,35,255]))],{type:'image/png'})}),
      {file:request().file,name:'  木地板_01 ',kind:'material',widthMm:1000,heightMm:2000,applicableSurfaces:['room','terrain'],licenseText:'Full actual fixture grant',attribution:'Actual original fixture source',canEmbed:true},
    ],{runtime,validation})
    expect(result.addedDefinitionIds).toHaveLength(3)
    const props=result.items.slice(0,2).map(item=>result.project.document.propDefinitions[item.definitionId])
    expect(props.map(item=>item.name)).toEqual([exactName,exactName]);expect(props[0].id).not.toBe(props[1].id)
    expect(props[0]).toMatchObject({defaultFootprintOffsetMm:{x:-100,y:250},defaultRenderLayer:'ground',defaultShadowClass:'none',tags:[' 标记,原文 ']})
    const material=result.project.document.materials[result.items[2].definitionId]
    expect(material.name).toBe('  木地板_01 ');expect(material.applicableSurfaces).toEqual(['room','terrain'])
    const {prepareLibraryEntry,loadLibraryCapsule}=await import('../../shared/library/content.js')
    const {exportLibraryBackup,importLibraryBackup}=await import('../../shared/library/backup.js')
    const entries=[]
    for(const item of result.items)entries.push(await prepareLibraryEntry(toBundle(result.project),{kind:item.kind,definitionId:item.definitionId},validation))
    const restored=await importLibraryBackup(await exportLibraryBackup({entries,organizations:{}},validation),validation)
    expect(restored.entries.map(entry=>entry.item.name)).toEqual(entries.map(entry=>entry.item.name))
    for(const entry of restored.entries){const capsule=await loadLibraryCapsule(entry,validation);expect(entry.item.name).toBe(entry.item.selector.kind==='material'?capsule.project.document.materials[entry.item.selector.definitionId].name:capsule.project.document.propDefinitions[entry.item.selector.definitionId].name)}
    const cold=await importProject(await exportProject(toBundle(result.project),validation),validation)
    expect(cold.project.document.propDefinitions[props[0].id]).toEqual(props[0]);expect(cold.project.document.materials[material.id]).toEqual(material)
  },60000)

  it('rejects invalid names and wrong-kind semantics before any normalization without changing the input', async () => {
    const base=await blank(),before=projectContentHash(toBundle(base).project)
    for(const override of [{name:'x'.repeat(121)},{name:'bad\u202ename'},{footprintOffsetMm:null},{footprintOffsetMm:{x:0,y:0,other:1}},{renderLayer:'foreground'},{applicableSurfaces:['room']}]) {
      await expect(prepareAssetBatchImport(base,[request(override as never)],{runtime,validation})).rejects.toMatchObject({itemIndex:0})
    }
    await expect(prepareAssetBatchImport(base,[{file:request().file,name:'tile',kind:'material',widthMm:1000,heightMm:1000,applicableSurfaces:[],licenseText:'Full grant',attribution:'Author',canEmbed:true}],{runtime,validation})).rejects.toThrow(/适用表面/)
    expect(normalizeImport).not.toHaveBeenCalled();expect(projectContentHash(toBundle(base).project)).toBe(before)
  })

  it('owns all metadata, arrays and native Blob handles before its first await', async () => {
    const base=await blank(), first=request(), second=request({name:'Other'}), inputs=[first,second]
    let reads=0
    Object.defineProperty(first.file,'arrayBuffer',{get(){reads++;throw new Error('untrusted Blob method')}})
    const resultPromise=prepareAssetBatchImport(base,inputs,{runtime,validation})
    first.name='changed';first.rootAnchorMm!.x=1;inputs[1]=request({file:new Blob(['bad'])})
    const result=await resultPromise
    expect(reads).toBe(0);expect(result.project.document.propDefinitions[result.items[0].definitionId].name).toBe('Coastal tree')
    expect(result.project.document.propDefinitions[result.items[0].definitionId].defaultVisualBoundsMm.x).toBe(-600)
    expect(result.project.document.propDefinitions[result.items[1].definitionId].name).toBe('Other')
  })

  it('rejects accessors, hidden/symbol fields and invalid anchors before decoding', async () => {
    const base=await blank();let reads=0
    const rows=[request()]
    Object.defineProperty(rows,'0',{enumerable:true,get(){reads++;return request()}})
    await expect(prepareAssetBatchImport(base,rows,{runtime,validation})).rejects.toThrow(/访问器/)
    const accessor=request();Object.defineProperty(accessor,'licenseText',{enumerable:true,get(){reads++;return 'bad'}})
    await expect(prepareAssetBatchImport(base,[accessor],{runtime,validation})).rejects.toMatchObject({itemIndex:0})
    const hidden=request();Object.defineProperty(hidden,'extra',{value:true})
    await expect(prepareAssetBatchImport(base,[hidden],{runtime,validation})).rejects.toThrow(/隐藏|未知/)
    const symbol=request();Object.defineProperty(symbol,Symbol('extra'),{value:true})
    await expect(prepareAssetBatchImport(base,[symbol],{runtime,validation})).rejects.toThrow(/未知/)
    await expect(prepareAssetBatchImport(base,[request({rootAnchorMm:{x:1201,y:0}})],{runtime,validation})).rejects.toThrow(/根锚/)
    await expect(prepareAssetBatchImport(base,[request({rootAnchorMm:null as never})],{runtime,validation})).rejects.toThrow(/根锚/)
    const nested=request();Object.defineProperty(nested.rootAnchorMm!, 'x', {enumerable:true,get(){reads++;return 0}})
    await expect(prepareAssetBatchImport(base,[nested],{runtime,validation})).rejects.toThrow(/访问器/)
    expect(reads).toBe(0);expect(normalizeImport).not.toHaveBeenCalled()
  })

  it('gives the failed selection index and leaves the original usable after a later corrupt item', async () => {
    const base=await blank(), before=projectContentHash(toBundle(base).project)
    try { await prepareAssetBatchImport(base,[request(),request({name:'Broken',file:new Blob([new Uint8Array([1,2,3])],{type:'image/png'})})],{runtime,validation}); throw new Error('expected rejection') }
    catch(error){expect(error).toBeInstanceOf(AssetBatchImportError);expect(error).toMatchObject({itemIndex:1,assetName:'Broken'});expect(String(error)).toContain('整批未采用');expect(error).not.toHaveProperty('project')}
    expect(projectContentHash(toBundle(await validateEditableProject(base,validation)).project)).toBe(before)
  })

  it('retains actual original normalized SVG and PNG with separate exact licences and offline roundtrip', async () => {
    const base=await blank(), source='\n'+ARTWORK_SVG+'\n', vector=request({name:'Vector',file:new Blob([new Uint8Array(encodeUtf8(source))],{type:'image/svg+xml'}),licenseText:'MIT fixture licence body B'})
    const result=await prepareAssetBatchImport(base,[request(),vector],{runtime,validation}), item=result.items[1], proof=result.project.authoringSources[item.assetId]
    expect(item.sourceKind).toBe('svg');expect(item.pixelWidth).toBe(512);expect(item.pixelHeight).toBe(512)
    expect(decodeUtf8(await result.project.resources.read(proof.sourceSha256))).toBe(source)
    expect(decodeUtf8(await result.project.resources.read(proof.normalizedSha256))).toBe(normalizeStaticSvg(source).normalizedSource)
    expect(sha256Bytes(await result.project.resources.read(proof.rasterSha256))).toBe(item.sha256)
    expect(result.project.document.assets[result.items[0].assetId].licenseRef).not.toBe(result.project.document.assets[item.assetId].licenseRef)
    const packaged=await exportProject(toBundle(result.project),validation), cold=await importProject(packaged,validation)
    expect(projectContentHash(cold.project)).toBe(projectContentHash(toBundle(result.project).project))
    expect(await cold.resources.read(proof.sourceSha256)).toEqual(encodeUtf8(source))
  },60000)

  it('never gives unsafe SVG to a raster decoder and rejects unavailable SVG capability', async () => {
    const base=await blank(), rasterize=vi.spyOn(validation.svg!,'rasterize')
    for(const source of [ARTWORK_SVG.replace('</svg>','<script>alert(1)</script></svg>'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="https://example.test/a.png"/></svg>']) {
      await expect(prepareAssetBatchImport(base,[request({file:new Blob([source],{type:'image/png'})})],{runtime,validation})).rejects.toMatchObject({itemIndex:0})
    }
    expect(rasterize).not.toHaveBeenCalled();expect(normalizeImport).not.toHaveBeenCalled()
    await expect(prepareAssetBatchImport(base,[request({file:new Blob([ARTWORK_SVG],{type:'image/svg+xml'})})],{runtime,validation:{images:validation.images}})).rejects.toThrow(/SVG/)
    await expect(prepareAssetBatchImport(base,[request({file:new Blob([new Uint8Array([0xc0,0xaf])],{type:'image/svg+xml'})})],{runtime,validation})).rejects.toThrow(/UTF-8/)
    rasterize.mockRestore()
  })

  it('bounds the selected count and raw cumulative input before any image decode', async () => {
    const base=await blank()
    await expect(prepareAssetBatchImport(base,Array.from({length:65},()=>request()),{runtime,validation})).rejects.toThrow(/64/)
    const large=new Blob([new Uint8Array(17*1024*1024)],{type:'image/png'})
    await expect(prepareAssetBatchImport(base,Array.from({length:4},()=>request({file:large})),{runtime,validation})).rejects.toMatchObject({itemIndex:3})
    expect(normalizeImport).not.toHaveBeenCalled()
  })

  it('cancels SVG materialization without returning any staged candidate', async () => {
    const base=await blank(), signal={aborted:false}, svg=validation.svg!
    const cancelled={...validation,svg:{processor:svg.processor,async rasterize(...args:Parameters<typeof svg.rasterize>){const image=await svg.rasterize(...args);signal.aborted=true;return image}}}
    await expect(prepareAssetBatchImport(base,[request({file:new Blob([ARTWORK_SVG],{type:'image/svg+xml'})})],{runtime,validation:cancelled,signal})).rejects.toMatchObject({name:'AbortError'})
    expect(base.authoringSources).toEqual({})
  })

  it('rejects a selected batch that exceeds the unchanged complete catalog adoption budget', async () => {
    const base=await blank(),before=canonicalJson(toBundle(base).project)
    await expect(prepareAssetBatchImport(base,Array.from({length:64},(_,i)=>request({name:`Fixed source ${i}`})),{runtime,validation})).rejects.toThrow(/超过256.*整批未采用/)
    expect(canonicalJson(toBundle(base).project)).toBe(before)
  })

  it('preserves centred legacy single import defaults through the same boundary', async () => {
    const base=await blank(), input=request();delete input.rootAnchorMm
    const result=await prepareAssetImport(base,input,{runtime,validation})
    const added=Object.values(result.document.propDefinitions).find(row=>row.name===input.name)!
    expect(added.defaultVisualBoundsMm).toEqual({x:-600,y:-900,width:1200,height:1800})
  })

  it('publishes all selected fixed entries once and cold reopens and undoes the whole batch', async () => {
    const repo=new ProjectRepository({name:`batch-atomic-${crypto.randomUUID()}`,runtime,validation});repositories.push(repo)
    const workspace=new Workspace(repo,{runtime,validation});workspaces.push(workspace)
    await workspace.adoptNew(await blank());const before=workspace.getState().project!, beforeHash=projectContentHash(toBundle(before).project)
    const result=await prepareAssetBatchImport(before,[request(),request({name:'Vector',file:new Blob([ARTWORK_SVG],{type:'image/svg+xml'})})],{runtime,validation})
    const preview=await workspace.previewPrepared(result.project,'Two fixed sources')
    expect(projectContentHash(toBundle(workspace.getState().project!).project)).toBe(beforeHash)
    await workspace.adoptPreview(preview);await workspace.flush()
    const adopted=workspace.getState().project!,cold=(await repo.load(adopted.document.sceneId))!
    expect(cold.project.document.revision).toBe(before.document.revision+1)
    expect(result.addedDefinitionIds.every(id=>!!cold.project.document.propDefinitions[id])).toBe(true)
    for (const source of Object.values(cold.project.appearance.sources)) if (source.kind === 'prop') expect(cold.project.appearance.presentations?.[source.id]).toBeDefined()
    expect(cold.project.authoringSources[result.items[1].assetId]).toBeDefined()
    workspace.undo();await workspace.flush();expect(workspace.getState().project!.document.propDefinitions).toEqual(before.document.propDefinitions)
    workspace.redo();await workspace.flush();expect(result.addedDefinitionIds.every(id=>!!workspace.getState().project!.document.propDefinitions[id])).toBe(true)
  },60000)
})
