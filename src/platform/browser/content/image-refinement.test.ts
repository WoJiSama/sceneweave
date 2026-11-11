import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fixture, runtime } from '../../../application/workspace/test-fixtures.js'
import { fromBundle, toBundle } from '../../../application/workspace/project.js'
import { prepareCompositionCommands } from '../../../application/workspace/prepare.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { CANONICAL_SVG_PROCESSOR, normalizeStaticSvg } from '../../../shared/ai/svg.js'
import { refineImageToVector } from '../../../shared/asset-refinement/vector.js'
import { CURRENT_VECTOR_ALGORITHM, replayVectorRefinement } from '../../../shared/asset-refinement/algorithms.js'
import type { VectorStructurePlan } from '../../../shared/asset-refinement/structure-plan.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { exportProject, importProject } from '../../../shared/project/file.js'
import { decodeCanonicalPng, encodeCanonicalPng } from '../../../shared/project/png-rgba.js'
import { transformRgba } from '../../../shared/project/pixels.js'
import type { CompleteValidationOptions } from '../../../shared/ports/resources.js'
import { canonicalJson, cloneJson } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { loadLibraryCapsule } from '../../../shared/library/content.js'
import { initializeCanonicalSvgRasterizer, rasterizeCanonicalSvgPixels } from '../ai/svg-raster.js'
import { prepareImageImportItemVariant } from './image-import-item.js'
import { readImageEnhancementSource, prepareImageEnhancementCandidate, prepareImageAppearanceCandidate } from './image-enhancement.js'
import { generateVectorRefinementCandidate, generateStructuredVectorCandidate, generateModelRefinementCandidate, prepareImageRefinementCandidate } from './image-refinement.js'
import { getImageEditCapabilities, requestImageEdit, ImageEditClientError, type ImageEditRequestStateEvent } from './image-refinement-model.js'
import { materializeImageImportSvg } from './image-import-vector.js'

vi.mock('./image-refinement-model.js', async importOriginal => ({
  ...await importOriginal<typeof import('./image-refinement-model.js')>(), getImageEditCapabilities: vi.fn(), requestImageEdit: vi.fn(),
}))
const capabilities: CompleteValidationOptions = { images: {
  async decode(bytes) { return decodeCanonicalPng(bytes) },
  async encodePng(image) { return encodeCanonicalPng(image) },
  async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
}, svg: { processor: CANONICAL_SVG_PROCESSOR, rasterize: (source, dimensions, options) => rasterizeCanonicalSvgPixels(source, dimensions, options?.signal) } }
beforeAll(async () => initializeCanonicalSvgRasterizer(new Uint8Array(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'))))
const target = { kind: 'propDefinition' as const, id: 'definition' }
async function originalProject(graded = false) {
  const bundle = fixture({ image: true }), width = 40, height = 32, rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const visible = Math.hypot((x - 20) / 1.3, y - 16) < 13 && !(x > 24 && x < 28 && y > 14 && y < 19)
    rgba.set(visible ? (x < 13 ? [190, 180, 150, 255] : graded ? [42 + x, 51 + x, 57 + x, 255] : [42, 51, 57, 255]) : [0, 0, 0, 0], (y * width + x) * 4)
  }
  const png = encodeCanonicalPng({ width, height, rgba }), hash = sha256Bytes(png)
  Object.assign(bundle.project.document.assets.image, { sha256: hash, pixelWidth: width, pixelHeight: height })
  bundle.project.assets = { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: png.length, pixelWidth: width, pixelHeight: height } }
  bundle.resources = createMemoryResources(new Map([[hash, png]]))
  Object.assign(bundle.project, createCompositionContent(bundle.project.document, runtime))
  return fromBundle(bundle, capabilities)
}

function structurePlan(sha256: string): VectorStructurePlan {
  return { version: 1, source: { sha256, width: 40, height: 32 }, summary: '重画可见主体与重复分隔，允许清理原图模糊边缘。', gradients: [], elements: [
    { kind: 'path', id: 'body', name: '可见主体', evidence: 'observed', reason: '按可见主体重新画直线与大曲线',
      d: 'M4 4L32 4Q36 4 36 8L36 24Q36 28 32 28L4 28Z', fill: '#394653' },
    { kind: 'repeatRects', id: 'divisions', name: '推断的等距分隔', evidence: 'inferred', reason: '原图不清楚的小分隔，以等距节律补画',
      x: 7, y: 8, width: 2, height: 16, stepX: 4, stepY: 0, count: 6, fill: '#d2d0bc' },
  ] }
}

describe('shared asset refinement adoption and immutable source closure', () => {
  it('retains a source-bound structure redraw, changed silhouette and inference records through adoption, personal copy and cold read', async () => {
    const modelCalls = { capabilities: vi.mocked(getImageEditCapabilities).mock.calls.length, requests: vi.mocked(requestImageEdit).mock.calls.length }
    const original = await originalProject(), before = canonicalJson(toBundle(original).project)
    const source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const sourceHash = original.document.assets.image.sha256, plan = structurePlan(sourceHash)
    // Public review fields cannot change the private source identity or the accepted drawing.
    source.sourceSha256 = '0'.repeat(64)
    const candidate = await generateStructuredVectorCandidate(source, plan)
    expect(candidate.structurePlan).toEqual(plan)
    expect(candidate.vectorStats).toMatchObject({ observedElements: 1, inferredElements: 1 })
    expect(candidate.sourceSvg).not.toMatch(/<image\b|\bhref\s*=/)
    const dimensions = { width: candidate.pixels.width, height: candidate.pixels.height }
    expect(dimensions).toEqual({ width: 1024, height: 819 })
    const offset = (Math.floor(5 / 32 * dimensions.height) * dimensions.width + Math.floor(5 / 40 * dimensions.width)) * 4 + 3
    expect(source.pixels.data[(5 * 40 + 5) * 4 + 3]).toBe(0)
    expect(candidate.pixels.data[offset]).toBe(255)
    plan.elements[0].fill = '#ff0000'
    candidate.structurePlan!.elements[0].fill = '#00ff00'; candidate.pixels.data.fill(0)
    const prepared = await prepareImageRefinementCandidate(original, source, candidate, undefined, capabilities)
    const output = Object.values(prepared.catalog.document.assets).find(asset => asset.imageRefinement)!
    expect(output.imageRefinement).toMatchObject({ kind: 'vector', algorithm: 'structure-plan-v1', sourceSha256: sourceHash,
      plan: { source: { sha256: sourceHash, width: 40, height: 32 }, elements: [{ fill: '#394653', evidence: 'observed' }, { evidence: 'inferred' }] } })
    expect(prepared.catalog.authoringSources[output.id]).toBeDefined()
    expect(prepared.catalog.document.assets.image).toEqual(original.document.assets.image)
    expect(output.logicalSizeMm).toEqual(original.document.assets.image.logicalSizeMm)
    expect(output.licenseRef).toBe(original.document.assets.image.licenseRef)
    const entry = await prepareImageImportItemVariant(prepared.catalog, prepared.selector!.definitionId,
      { name: '结构重绘副本', widthMm: 1000, heightMm: 800, footprintWidthMm: 600, footprintHeightMm: 500, blocksMovement: true }, undefined, capabilities)
    const capsule = await loadLibraryCapsule(entry, capabilities), reopened = await importProject(await exportProject(capsule, capabilities), capabilities)
    expect(reopened.project.document.assets[output.id].imageRefinement).toEqual(output.imageRefinement)
    expect(await reopened.resources.read(output.sha256)).toEqual(await prepared.catalog.resources.read(output.sha256))
    expect(decodeCanonicalPng(await reopened.resources.read(output.sha256)).rgba[offset]).toBe(255)
    expect(canonicalJson(toBundle(original).project)).toBe(before)
    expect(vi.mocked(getImageEditCapabilities).mock.calls).toHaveLength(modelCalls.capabilities)
    expect(vi.mocked(requestImageEdit).mock.calls).toHaveLength(modelCalls.requests)
  }, 30000)

  it('cold-reopens the exact saved structure parent after a basic edit, and can regenerate against that parent', async () => {
    const original = await originalProject(), before = canonicalJson(toBundle(original).project)
    await expect(readImageEnhancementSource(original, target, 'savedStructure', undefined, capabilities)).rejects.toThrow('没有已保存的结构稿来源')
    const originalSource = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const basic = await prepareImageEnhancementCandidate(original, originalSource,
      { version: 1, direction: 'clarity', strength: 'balanced', scale: 2 }, undefined, undefined, capabilities)
    const basicTarget = { kind: 'propDefinition' as const, id: basic.selector!.definitionId }
    await expect(readImageEnhancementSource(basic.catalog, basicTarget, 'savedStructure', undefined, capabilities)).rejects.toThrow('没有已保存的结构稿来源')
    const parent = await readImageEnhancementSource(basic.catalog, basicTarget, 'current', undefined, capabilities)
    expect(parent.pixels).toMatchObject({ width: 80, height: 64 })
    expect(parent.sourceSha256).not.toBe(originalSource.sourceSha256)
    const parentAsset = basic.catalog.document.assets[parent.assetId], plan = structurePlan(parent.sourceSha256)
    plan.source.width = parent.pixels.width; plan.source.height = parent.pixels.height
    const candidate = await generateStructuredVectorCandidate(parent, plan)
    const structured = await prepareImageRefinementCandidate(basic.catalog, parent, candidate, undefined, capabilities)
    const structuredTarget = { kind: 'propDefinition' as const, id: structured.selector!.definitionId }
    const output = Object.values(structured.catalog.document.assets).find(asset => asset.imageRefinement)!
    expect(output.imageRefinement).toMatchObject({ kind: 'vector', algorithm: 'structure-plan-v1', sourceAssetId: parent.assetId,
      sourceSha256: parent.sourceSha256, originalAssetId: originalSource.originalAssetId, plan })
    const coldBundle = await importProject(await exportProject(toBundle(structured.catalog), capabilities), capabilities)
    const cold = await fromBundle(coldBundle, capabilities)
    const root = await readImageEnhancementSource(cold, structuredTarget, 'original', undefined, capabilities)
    const current = await readImageEnhancementSource(cold, structuredTarget, 'current', undefined, capabilities)
    expect(root.sourceSha256).toBe(originalSource.sourceSha256)
    expect(current.sourceSha256).toBe(output.sha256)
    expect([root.sourceSha256, current.sourceSha256]).not.toContain(parent.sourceSha256)
    const savedParent = await readImageEnhancementSource(cold, structuredTarget, 'savedStructure', undefined, capabilities)
    expect(savedParent).toMatchObject({ basis: 'savedStructure', assetId: parent.assetId, sourceSha256: parent.sourceSha256,
      originalAssetId: originalSource.originalAssetId, pixels: { width: 80, height: 64 } })
    expect(savedParent.baseline).toBe(current.baseline)
    expect(savedParent.pixels.data).toEqual(parent.pixels.data)
    expect(cold.document.assets[parent.assetId]).toEqual(parentAsset)
    expect(await cold.resources.read(parentAsset.sha256)).toEqual(await basic.catalog.resources.read(parentAsset.sha256))
    const regenerated = await generateStructuredVectorCandidate(savedParent, plan)
    expect(regenerated.sourceSvg).toBe(candidate.sourceSvg)
    expect(regenerated.pixels).toEqual(candidate.pixels)
    const continued = await prepareImageRefinementCandidate(cold, savedParent, regenerated, undefined, capabilities)
    expect(continued.catalog.document.assets[output.id].imageRefinement).toEqual(output.imageRefinement)
    expect(continued.catalog.document.assets[originalSource.originalAssetId]).toEqual(original.document.assets[originalSource.originalAssetId])
    expect(canonicalJson(toBundle(original).project)).toBe(before)
  }, 30000)

  it('rejects a structure plan for another source or frame, and rejects a changed persisted plan instead of replaying pixels', async () => {
    const original = await originalProject(), source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const plan = structurePlan(original.document.assets.image.sha256)
    await expect(generateStructuredVectorCandidate(source, { ...plan, source: { ...plan.source, sha256: '0'.repeat(64) } })).rejects.toThrow('来源hash或尺寸')
    await expect(generateStructuredVectorCandidate(source, { ...plan, source: { ...plan.source, width: 41 } })).rejects.toThrow('来源hash或尺寸')
    await expect(generateStructuredVectorCandidate(source, { ...plan, elements: plan.elements.map(element => ({ ...element, opacity: 0 })) })).rejects.toThrow('没有可见像素')
    const candidate = await generateStructuredVectorCandidate(source, plan)
    await expect(prepareImageRefinementCandidate(original, source, { ...candidate }, undefined, capabilities)).rejects.toThrow('本次原件基线')
    const stale = cloneJson(toBundle(original).project)
    stale.document.propDefinitions.definition.name = '更新后的目标'
    const staleProject = await fromBundle({ project: stale, resources: original.resources }, capabilities)
    await expect(prepareImageRefinementCandidate(staleProject, source, candidate, undefined, capabilities)).rejects.toThrow('已修改')
    const locked = cloneJson(toBundle(original).project)
    locked.document.props.item.editLocked = true
    const lockedProject = await fromBundle({ project: locked, resources: original.resources }, capabilities)
    const lockedSource = await readImageEnhancementSource(lockedProject, { kind: 'prop', id: 'item' }, 'original', undefined, capabilities)
    const lockedCandidate = await generateStructuredVectorCandidate(lockedSource, plan)
    await expect(prepareImageRefinementCandidate(lockedProject, lockedSource, lockedCandidate, undefined, capabilities)).rejects.toThrow('锁定')
    const prepared = await prepareImageRefinementCandidate(original, source, candidate, undefined, capabilities)
    const changed = cloneJson(toBundle(prepared.catalog).project), output = Object.values(changed.document.assets).find(asset => asset.imageRefinement)!
    if (output.imageRefinement?.kind !== 'vector' || output.imageRefinement.algorithm !== 'structure-plan-v1') throw new Error('Missing structure plan')
    output.imageRefinement.plan.elements[0].fill = '#293643'
    await expect(fromBundle({ project: changed, resources: prepared.catalog.resources }, capabilities)).rejects.toThrow('矢量重建源')
    output.imageRefinement.plan.source.sha256 = '0'.repeat(64)
    await expect(fromBundle({ project: changed, resources: prepared.catalog.resources }, capabilities)).rejects.toThrow('结构重绘计划必须绑定')
  }, 30000)

  it('retains editable SVG and original through a personal copy, export and independent cold validation', async () => {
    const original = await originalProject(), before = canonicalJson(toBundle(original).project)
    const source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const candidate = await generateVectorRefinementCandidate(source, { colors: 24, curveTolerancePx: .45 })
    expect(candidate.sourceSvg).toContain('<svg')
    candidate.pixels.data.fill(0); source.pixels.data.fill(0); source.canonicalPixels?.data.fill(0)
    const prepared = await prepareImageRefinementCandidate(original, source, candidate, undefined, capabilities)
    expect(prepared.commands).toEqual([])
    const entry = await prepareImageImportItemVariant(prepared.catalog, prepared.selector!.definitionId,
      { name: '曲线编辑副本', widthMm: 1000, heightMm: 800, footprintWidthMm: 600, footprintHeightMm: 500, blocksMovement: true }, undefined, capabilities)
    const capsule = await loadLibraryCapsule(entry, capabilities), data = capsule.project
    const output = Object.values(data.document.assets).find(asset => asset.imageRefinement)!
    expect(output.imageRefinement).toMatchObject({ kind: 'vector', algorithm: CURRENT_VECTOR_ALGORITHM, sourceAssetId: 'image', originalAssetId: 'image' })
    expect(data.authoringSources[output.id]).toBeDefined()
    expect(data.document.assets.image).toEqual(original.document.assets.image)
    const reopened = await importProject(await exportProject(capsule, capabilities), capabilities)
    expect(reopened.project.document.assets).toEqual(data.document.assets)
    expect(decodeCanonicalPng(await reopened.resources.read(output.sha256)).rgba.some(value => value > 0)).toBe(true)
    expect(canonicalJson(toBundle(original).project)).toBe(before)
  })

  it('cold-replays a preserved legacy vector asset with its recorded algorithm instead of the current one', async () => {
    const original = await originalProject(true), source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const pixels = source.canonicalPixels ?? source.pixels, options = { colors: 16, curveTolerancePx: .45 }
    const legacy = refineImageToVector(pixels, options), current = replayVectorRefinement(CURRENT_VECTOR_ALGORITHM, pixels, options)
    expect(normalizeStaticSvg(current.sourceSvg).sourceSha256).not.toBe(normalizeStaticSvg(legacy.sourceSvg).sourceSha256)
    const vector = await materializeImageImportSvg(legacy.sourceSvg, Math.max(pixels.width, pixels.height) * 2)
    const sourceAsset = original.document.assets[source.assetId]
    const prepared = await prepareImageAppearanceCandidate(original, source, {
      pngBytes: vector.pngBytes, width: vector.pixelWidth, height: vector.pixelHeight, vector, label: '保留旧矢量资产',
      metadata: { imageRefinement: { version: 1, kind: 'vector', algorithm: 'shared-boundary-curves-v1', options,
        sourceAssetId: source.assetId, originalAssetId: source.originalAssetId, sourceSha256: sourceAsset.sha256,
        outputSha256: vector.sha256, sourcePixelMode: source.canonicalPixels ? 'rgba8' : source.pixelMode } },
    }, undefined, capabilities)
    const reopened = await fromBundle(toBundle(prepared.catalog), capabilities)
    const output = Object.values(reopened.document.assets).find(asset => asset.imageRefinement)!
    expect(output.imageRefinement).toMatchObject({ kind: 'vector', algorithm: 'shared-boundary-curves-v1' })
    expect(reopened.document.assets[source.assetId]).toEqual(sourceAsset)
    expect(await reopened.resources.read(output.sha256)).toEqual(vector.pngBytes)
    const relabelled = cloneJson(toBundle(prepared.catalog).project)
    const changed = relabelled.document.assets[output.id].imageRefinement!
    if (changed.kind !== 'vector' || changed.algorithm === 'structure-plan-v1') throw new Error('Missing preserved vector')
    changed.algorithm = CURRENT_VECTOR_ALGORITHM
    await expect(fromBundle({ project: relabelled, resources: prepared.catalog.resources }, capabilities)).rejects.toThrow('矢量重建源')
  })

  it('rejects forged candidates, another source witness, stale targets and locked instances', async () => {
    const original = await originalProject(), source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const candidate = await generateVectorRefinementCandidate(source, { colors: 16, curveTolerancePx: .4 })
    await expect(prepareImageRefinementCandidate(original, source, { ...candidate }, undefined, capabilities)).rejects.toThrow('本次原件基线')
    const other = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    await expect(prepareImageRefinementCandidate(original, other, candidate, undefined, capabilities)).rejects.toThrow('本次原件基线')
    const changed = cloneJson(toBundle(original).project)
    changed.document.propDefinitions.definition.name = '另一份编辑'
    const updated = await fromBundle({ project: changed, resources: original.resources }, capabilities)
    await expect(prepareImageRefinementCandidate(updated, source, candidate, undefined, capabilities)).rejects.toThrow('已修改')
    const locked = cloneJson(toBundle(original).project)
    locked.document.props.item.editLocked = true
    const lockedProject = await fromBundle({ project: locked, resources: original.resources }, capabilities)
    const instanceSource = await readImageEnhancementSource(lockedProject, { kind: 'prop', id: 'item' }, 'original', undefined, capabilities)
    const instanceCandidate = await generateVectorRefinementCandidate(instanceSource, { colors: 16, curveTolerancePx: .4 })
    await expect(prepareImageRefinementCandidate(lockedProject, instanceSource, instanceCandidate, undefined, capabilities)).rejects.toThrow('锁定')
  })

  it('cold-replays a mixed vector/basic chain and rejects a changed vector algorithm record', async () => {
    const original = await originalProject(), source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const vector = await generateVectorRefinementCandidate(source, { colors: 16, curveTolerancePx: .45 })
    const prepared = await prepareImageRefinementCandidate(original, source, vector, undefined, capabilities)
    const next = await readImageEnhancementSource(prepared.catalog, { kind: 'propDefinition', id: prepared.selector!.definitionId }, 'current', undefined, capabilities)
    const basic = await prepareImageEnhancementCandidate(prepared.catalog, next, { version: 1, direction: 'edge', strength: 'gentle', scale: 1 }, undefined, undefined, capabilities)
    await expect(fromBundle(toBundle(basic.catalog), capabilities)).resolves.toBeDefined()
    const changed = cloneJson(toBundle(prepared.catalog).project), output = Object.values(changed.document.assets).find(asset => asset.imageRefinement)!
    if (output.imageRefinement?.kind !== 'vector' || output.imageRefinement.algorithm === 'structure-plan-v1') throw new Error('Missing vector')
    output.imageRefinement.options.colors = 8
    output.imageRefinement.options.curveTolerancePx = 0
    await expect(fromBundle({ project: changed, resources: prepared.catalog.resources }, capabilities)).rejects.toThrow('矢量重建源')
  })

  it('keeps model bytes and inferred provenance while rejecting opaque backgrounds and mismatched inputs', async () => {
    const original = await originalProject(), source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    vi.mocked(getImageEditCapabilities).mockResolvedValue({ available: true } as Awaited<ReturnType<typeof getImageEditCapabilities>>)
    vi.mocked(requestImageEdit).mockImplementation(async (_connection, input) => {
      const raster = decodeCanonicalPng(input.pngBytes); raster.rgba[(16 * raster.width + 20) * 4] += 1
      const pngBytes = encodeCanonicalPng(raster)
      return { pngBytes, sourceSha256: input.sourceSha256, model: 'fixture-image-model', clientRequestId: input.clientRequestId, requestId: 'fixture-request', inputHash: input.sourceSha256, outputHash: sha256Bytes(pngBytes) }
    })
    const candidate = await generateModelRefinementCandidate(source, { baseUrl: 'http://127.0.0.1:8787', token: 'fixture' }, '只整理原有琴键分隔', undefined, capabilities)
    const prepared = await prepareImageRefinementCandidate(original, source, candidate, undefined, capabilities)
    const output = Object.values(prepared.catalog.document.assets).find(asset => asset.imageRefinement)!
    expect(output.imageRefinement).toMatchObject({ kind: 'model', model: 'fixture-image-model', requestId: 'fixture-request' })
    expect(prepared.catalog.authoringSources[output.id]).toBeUndefined()
    await expect(fromBundle(toBundle(prepared.catalog), capabilities)).resolves.toBeDefined()
    vi.mocked(requestImageEdit).mockImplementation(async (_connection, input) => {
      const raster = decodeCanonicalPng(input.pngBytes)
      for (let i = 3; i < raster.rgba.length; i += 4) raster.rgba[i] = 255
      return { pngBytes: encodeCanonicalPng(raster), sourceSha256: input.sourceSha256, model: 'fixture-image-model', clientRequestId: input.clientRequestId, requestId: 'opaque', inputHash: input.sourceSha256, outputHash: '0'.repeat(64) }
    })
    await expect(generateModelRefinementCandidate(source, { baseUrl: 'http://127.0.0.1:8787', token: 'fixture' }, '保留透明背景', undefined, capabilities)).rejects.toThrow('不透明背景')
  })

  it('cold-reads model edits of canonical sources above the optional four-million-pixel copy budget', async () => {
    const vector = await materializeImageImportSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="#394653" opacity="0.5"/></svg>', 2048)
    const bundle = fixture({ image: true }), hash = vector.sha256
    Object.assign(bundle.project.document.assets.image, { sha256: hash, pixelWidth: 2048, pixelHeight: 2048 })
    bundle.project.assets = { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: vector.pngBytes.length, pixelWidth: 2048, pixelHeight: 2048 } }
    bundle.project.authoringSources.image = vector.authoringSource
    bundle.resources = createMemoryResources(vector.resourceBytes)
    Object.assign(bundle.project, createCompositionContent(bundle.project.document, runtime))
    // Simulate native straight/premultiplied rounding; SVG processor 2 must never use this source raster.
    const native: CompleteValidationOptions = { ...capabilities, images: { ...capabilities.images, async decode(bytes) {
      const raster = decodeCanonicalPng(bytes)
      for (let i = 0; i < raster.rgba.length; i += 4) if (raster.rgba[i + 3] > 0 && raster.rgba[i + 3] < 255) raster.rgba[i] += 1
      return raster
    } } }
    const original = await fromBundle(bundle, native)
    const source = await readImageEnhancementSource(original, target, 'current', undefined, native)
    expect(source.canonicalPixels).toBeUndefined()
    expect(source.pixelMode).toBe('rgba8')
    const exact = decodeCanonicalPng(vector.pngBytes)
    expect(sha256Bytes(new Uint8Array(source.pixels.data.buffer))).toBe(sha256Bytes(new Uint8Array(exact.rgba.buffer)))
    vi.mocked(getImageEditCapabilities).mockResolvedValue({ available: true } as Awaited<ReturnType<typeof getImageEditCapabilities>>)
    vi.mocked(requestImageEdit).mockImplementation(async (_connection, input) => {
      expect(input.pngBytes).toEqual(encodeCanonicalPng(exact))
      const raster = decodeCanonicalPng(input.pngBytes); raster.rgba[0] += 3
      const pngBytes = encodeCanonicalPng(raster)
      return { pngBytes, sourceSha256: input.sourceSha256, model: 'fixture-image-model', clientRequestId: input.clientRequestId,
        requestId: 'large-canonical-request', inputHash: input.sourceSha256, outputHash: sha256Bytes(pngBytes) }
    })
    const candidate = await generateModelRefinementCandidate(source, { baseUrl: 'http://127.0.0.1:8787', token: 'fixture' }, '保留半透明边缘', undefined, native)
    const prepared = await prepareImageRefinementCandidate(original, source, candidate, undefined, native)
    const output = Object.values(prepared.catalog.document.assets).find(asset => asset.imageRefinement)!
    expect(output.imageRefinement).toMatchObject({ kind: 'model', sourcePixelMode: 'rgba8', inputSha256: sha256Bytes(encodeCanonicalPng(exact)) })
    await expect(fromBundle(toBundle(prepared.catalog), native)).resolves.toBeDefined()
  }, 30000)

  it.each(['cancel', 'decode', 'ratio', 'transparent'] as const)('retains the finished request ID when returned model pixels are rejected: %s', async failure => {
    const original = await originalProject(), source = await readImageEnhancementSource(original, target, 'original', undefined, capabilities)
    const controller = new AbortController(), events: ImageEditRequestStateEvent[] = []
    let sentId = '', submissions = 0
    vi.mocked(getImageEditCapabilities).mockResolvedValue({ available: true } as Awaited<ReturnType<typeof getImageEditCapabilities>>)
    vi.mocked(requestImageEdit).mockImplementation(async (_connection, input, _signal, onState) => {
      sentId = input.clientRequestId; submissions++
      onState?.({ clientRequestId: sentId, state: 'unknown' })
      const raster = decodeCanonicalPng(input.pngBytes)
      raster.rgba[(16 * raster.width + 20) * 4] += 1
      if (failure === 'transparent') raster.rgba.fill(0)
      if (failure === 'ratio') { raster.height--; raster.rgba = raster.rgba.slice(0, raster.width * raster.height * 4) }
      const pngBytes = encodeCanonicalPng(raster)
      onState?.({ clientRequestId: sentId, state: 'finished' })
      if (failure === 'cancel') controller.abort()
      return { pngBytes, sourceSha256: input.sourceSha256, model: 'fixture-image-model', clientRequestId: sentId,
        requestId: 'rejected-output-request', inputHash: input.sourceSha256, outputHash: sha256Bytes(pngBytes) }
    })
    const decoder = failure === 'decode' ? { ...capabilities, images: { ...capabilities.images, async decode() { throw new Error('实际解码失败') } } } : capabilities
    const error = await generateModelRefinementCandidate(source, { baseUrl: 'http://127.0.0.1:8787', token: 'fixture' }, '保留主体和透明背景', controller.signal, decoder, event => events.push(event)).catch(reason => reason)
    expect(error).toBeInstanceOf(ImageEditClientError)
    expect(error).toMatchObject({ code: 'image_edit_output_rejected', requestState: 'finished', clientRequestId: sentId })
    expect(error.message).toContain(sentId)
    if (failure === 'transparent') expect(error.message).toContain('没有可见像素')
    if (failure === 'decode') expect(error.message).toContain('实际解码失败')
    if (failure === 'ratio') expect(error.message).toContain('原画比例')
    expect(events).toEqual([{ clientRequestId: sentId, state: 'unknown' }, { clientRequestId: sentId, state: 'finished' }])
    expect(submissions).toBe(1)
  })

  it('applies ordinary brightness to a vector candidate once without copying its source record onto the colour output', async () => {
    const original = await originalProject(), instance = { kind: 'prop' as const, id: 'item' }
    const source = await readImageEnhancementSource(original, instance, 'original', undefined, capabilities)
    const vector = await generateVectorRefinementCandidate(source, { colors: 16, curveTolerancePx: .45 })
    const expected = vector.pixels.data.slice(), prepared = await prepareImageRefinementCandidate(original, source, vector, undefined, capabilities)
    const adopted = await prepareCompositionCommands(prepared.catalog, prepared.commands, { runtime, validation: capabilities })
    const tinted = await prepareCompositionCommands(adopted, [{ type: 'setAppearanceAdjustment', scope: { kind: 'targets', ids: ['item'] },
      adjustment: { id: 'dim-refinement', kind: 'brightness', enabled: true, value: .5 } }], { runtime, validation: capabilities })
    const appearance = tinted.document.props.item.appearance
    if (appearance.kind !== 'image') throw new Error('Missing image')
    const output = tinted.document.assets[appearance.assetId]
    expect(output.imageRefinement).toBeUndefined()
    expect(decodeCanonicalPng(await tinted.resources.read(output.sha256)).rgba).toEqual(transformRgba(expected, null, .5))
    const cold = await fromBundle(toBundle(tinted), capabilities)
    expect(await readImageEnhancementSource(cold, instance, 'original', undefined, capabilities)).toMatchObject({ assetId: 'image' })
  })
})
