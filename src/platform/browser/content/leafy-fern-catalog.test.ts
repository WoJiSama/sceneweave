import { describe, expect, it, vi } from 'vitest'
import { artworkValidation } from '../../../../tests/helpers/m24-artwork-fixtures.js'
import { verifyNormalizedStaticSvg, CANONICAL_SVG_PROCESSOR } from '../../../shared/ai/svg.js'
import { canonicalJson, cloneJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { decodeUtf8 } from '../../../shared/project/binary.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { listCatalogItems, prepareLibraryEntry, adoptLibraryEntries } from '../../../shared/library/content.js'
import { importProject, exportProject } from '../../../shared/project/file.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { toBundle } from '../../../application/workspace/project.js'
import { LEAFY_FERN_ART, LEAFY_FERN_ASSET_ID, LEAFY_FERN_DEFINITION_ID, LEAFY_FERN_LICENSE, LEAFY_FERN_SPEC } from '../../../shared/visual/leafy-fern-art.js'
import { VEGETATION_DETAIL_ART, VEGETATION_DETAIL_LICENSE, vegetationDetailAssetId } from '../../../shared/visual/vegetation-detail-art.js'
import { createVegetationDetailCatalogDocument, VEGETATION_DETAIL_BATCH } from './vegetation-detail-catalog.js'
import { appendLeafyFernDefinition, createLeafyFernCatalogDocument, createLeafyFernCatalogProject, materializeLeafyFernScene } from './leafy-fern-catalog.js'

const pixels=vi.hoisted(()=>({raster(hash:string,width:number,height:number){const rgba=new Uint8ClampedArray(width*height*4),rgb=[0,2,4].map(index=>parseInt(hash.slice(index,index+2),16));for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)rgba.set([...rgb,255],(y*width+x)*4);return {width,height,rgba}}}))
// Signature pixels verify PNG bytes/source/licence closure. They do not claim
// SVG rasterization, silhouette readability or transparency visual acceptance.
vi.mock('../runtime.js',async()=>{
  const {artworkValidation}=await import('../../../../tests/helpers/m24-artwork-fixtures.js'),{verifyNormalizedStaticSvg,CANONICAL_SVG_PROCESSOR}=await import('../../../shared/ai/svg.js');let n=0
  return {runtime:{ids:{nextId:()=>`leafy-fern-test-${++n}`},clock:{now:()=> '2026-11-10T00:00:00.000Z'}},validation:{...artworkValidation(),svg:{processor:CANONICAL_SVG_PROCESSOR,async rasterize(input:Parameters<typeof verifyNormalizedStaticSvg>[0],dimensions:{width:number;height:number}){const source=verifyNormalizedStaticSvg(input);return pixels.raster(source.normalizedSha256,dimensions.width,dimensions.height)}}}}
})
vi.mock('../ai/svg-raster.js',async()=>{
  const {encodeFixtureRaster}=await import('../../../../tests/helpers/m24-artwork-fixtures.js'),{verifyNormalizedStaticSvg,CANONICAL_SVG_PROCESSOR}=await import('../../../shared/ai/svg.js'),{sha256Bytes}=await import('../../../shared/validation/hash.js')
  return {async rasterizeNormalizedSvg(input:Parameters<typeof verifyNormalizedStaticSvg>[0],options:{longEdgePx:number;signal?:AbortSignal}){options.signal?.throwIfAborted();const source=verifyNormalizedStaticSvg(input),pngBytes=encodeFixtureRaster(pixels.raster(source.normalizedSha256,options.longEdgePx,options.longEdgePx));return {mimeType:'image/png',pngBytes,sha256:sha256Bytes(pngBytes),pixelWidth:options.longEdgePx,pixelHeight:options.longEdgePx,normalizedSha256:source.normalizedSha256,...CANONICAL_SVG_PROCESSOR}}}
})
const validation={...artworkValidation(),svg:{processor:CANONICAL_SVG_PROCESSOR,async rasterize(input:Parameters<typeof verifyNormalizedStaticSvg>[0],dimensions:{width:number;height:number}){const source=verifyNormalizedStaticSvg(input);return pixels.raster(source.normalizedSha256,dimensions.width,dimensions.height)}}}

describe('leafy fern standalone fixed catalogue',()=>{
  it('defines one calibrated source in an empty current document and refuses identity occupation without mutation',()=>{
    const source=createLeafyFernCatalogDocument({sceneId:'one-leafy-fern'}),definition=source.propDefinitions[LEAFY_FERN_DEFINITION_ID]
    expect(validateSceneDocument(source).ok).toBe(true);expect(Object.keys(source.propDefinitions)).toEqual([LEAFY_FERN_DEFINITION_ID]);expect(Object.keys(source.assets)).toEqual([LEAFY_FERN_ASSET_ID])
    for(const key of ['props','rooms','terrainAreas','scatterGroups','materials','styleThemes','entityLayers'] as const)expect(source[key]).toEqual({})
    expect(definition.catalogId).toBe(LEAFY_FERN_SPEC.catalogId);expect(definition.defaultVisualBoundsMm).toEqual(LEAFY_FERN_SPEC.visualBoundsMm);expect(definition.defaultFootprintMm).toEqual(LEAFY_FERN_SPEC.footprintMm)
    const old=createVegetationDetailCatalogDocument(),before=canonicalJson(old),appended=appendLeafyFernDefinition(old)
    expect(canonicalJson(old)).toBe(before);for(const [id,value] of Object.entries(old.propDefinitions))expect(appended.propDefinitions[id]).toEqual(value)
    expect(()=>appendLeafyFernDefinition(appended)).toThrow(/不覆盖/)
    const occupied=cloneJson(old),floorId=Object.keys(old.floors)[0];occupied.userLayers[LEAFY_FERN_ASSET_ID]={id:LEAFY_FERN_ASSET_ID,floorId,name:'user layer',order:1,editLocked:false}
    const saved=canonicalJson(occupied);expect(()=>appendLeafyFernDefinition(occupied)).toThrow(/不覆盖/);expect(canonicalJson(occupied)).toBe(saved)
  })

  it('preserves exact original source, actual byte hashes, licence and identity through ordinary adoption and cold file import',async()=>{
    const project=await createLeafyFernCatalogProject(),bundle=toBundle(project),items=listCatalogItems(bundle)
    expect(items).toHaveLength(1);expect(Object.keys(project.assets)).toHaveLength(1);expect(Object.values(project.licenses).map(row=>row.text)).toEqual([LEAFY_FERN_LICENSE])
    const source=project.authoringSources[LEAFY_FERN_ASSET_ID]
    expect(decodeUtf8(await project.resources.read(source.sourceSha256))).toBe(LEAFY_FERN_ART[0].sourceSvg)
    expect(sha256Bytes(await project.resources.read(source.rasterSha256))).toBe(source.rasterSha256)
    const entry=await prepareLibraryEntry(bundle,items[0].selector,validation),target=cloneJson(bundle.project)
    target.document.assets={};target.document.propDefinitions={};target.appearance.sources={};target.appearance.presentations={};target.assets={};target.authoringSources={};target.licenses={};target.licenseBindings=[]
    const adopted=await adoptLibraryEntries({project:target,resources:createMemoryResources(new Map())},[entry],validation),cold=await importProject(await exportProject(adopted.bundle,validation),validation)
    expect(cold.project.document.propDefinitions).toEqual(project.document.propDefinitions);expect(cold.project.authoringSources).toEqual(project.authoringSources)
    expect(listCatalogItems(cold)[0].identity.key).toBe(items[0].identity.key);expect(cold.project.document.props).toEqual({})
  },30_000)

  it('retains all old six definitions and source bytes in their original licence batch and fails atomically on calibration or cancellation',async()=>{
    const old=createVegetationDetailCatalogDocument(),source=appendLeafyFernDefinition(old),before=canonicalJson(source)
    const project=await materializeLeafyFernScene(source,[VEGETATION_DETAIL_BATCH]),oldHash=sha256Bytes(encodeUtf8(VEGETATION_DETAIL_LICENSE)),newHash=sha256Bytes(encodeUtf8(LEAFY_FERN_LICENSE))
    expect(Object.keys(project.licenses).sort()).toEqual([oldHash,newHash].sort())
    for(const art of VEGETATION_DETAIL_ART){const id=vegetationDetailAssetId(art.key),record=project.authoringSources[id];expect(decodeUtf8(await project.resources.read(record.sourceSha256))).toBe(art.sourceSvg);expect(project.licenseBindings.find(row=>row.subjectKind==='asset'&&row.subjectId===id)!.licensePath).toBe(`licenses/${oldHash}.txt`)}
    expect(project.licenseBindings.find(row=>row.subjectKind==='asset'&&row.subjectId===LEAFY_FERN_ASSET_ID)!.licensePath).toBe(`licenses/${newHash}.txt`)
    expect(canonicalJson(source)).toBe(before)
    const broken=cloneJson(source);broken.propDefinitions[LEAFY_FERN_DEFINITION_ID].defaultVisualBoundsMm.y--
    await expect(materializeLeafyFernScene(broken,[VEGETATION_DETAIL_BATCH])).rejects.toThrow(/标定不匹配/)
    const controller=new AbortController();controller.abort();await expect(createLeafyFernCatalogProject(controller.signal)).rejects.toMatchObject({name:'AbortError'})
  },30_000)
})
