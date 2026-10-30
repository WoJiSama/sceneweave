import { unzlibSync, zlibSync } from 'fflate'
import type { AuthoringDraft, AuthoringOperation, AuthoringScope, AuthoringStart } from '../../src/shared/ai/authoring-protocol-v1'
import { applyAuthoringStep, authoringProjectHash, replayAuthoring } from '../../src/shared/ai/authoring'
import { verifyNormalizedStaticSvg } from '../../src/shared/ai/svg'
import type { ProjectBundle } from '../../src/shared/model/project'
import type { CompleteValidationOptions, RasterImage } from '../../src/shared/ports/resources'
import { crc32 } from '../../src/shared/project/binary'
import { inspectImageBytes } from '../../src/shared/project/image-bytes'
import { transformRgba } from '../../src/shared/project/pixels'
import { encodeUtf8 } from '../../src/shared/validation/json'

export const ARTWORK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect x="0" y="0" width="1" height="1" fill="#2468ac"/></svg>'
export function encodeFixtureRaster(image: RasterImage): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer)
    view.setUint32(0, data.length); result.set(encodeUtf8(type), 4); result.set(data, 8)
    view.setUint32(data.length + 8, crc32(result.subarray(4, data.length + 8))); return result
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, image.width); view.setUint32(4, image.height); header[8] = 8; header[9] = 6
  const raw = new Uint8Array(image.height * (image.width * 4 + 1))
  for (let y = 0; y < image.height; y++) raw.set(image.rgba.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * (image.width * 4 + 1) + 1)
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())]
  const bytes = new Uint8Array(chunks.reduce((sum, value) => sum + value.length, 0))
  let offset = 0; for (const value of chunks) { bytes.set(value, offset); offset += value.length }; return bytes
}

/** Real PNG data and pixel transformations; the SVG platform capability is an explicit solid-rect fixture double. */
export function artworkValidation(): CompleteValidationOptions {
  return { images: {
    async decode(bytes, record) {
      const header = inspectImageBytes(bytes), idat: Uint8Array[] = []
      for (let offset = 8; offset < bytes.length;) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0)
        if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length))
        offset += length + 12
      }
      if (header.width !== record.pixelWidth || header.height !== record.pixelHeight || header.mimeType !== 'image/png') throw new Error('Fixture PNG dimensions/format mismatch')
      const encoded = new Uint8Array(idat.reduce((sum, value) => sum + value.length, 0))
      let cursor = 0; for (const value of idat) { encoded.set(value, cursor); cursor += value.length }
      const raw = unzlibSync(encoded), rgba = new Uint8ClampedArray(header.width * header.height * 4), stride = header.width * 4 + 1
      if (raw.length !== header.height * stride) throw new Error('Fixture PNG scanline length mismatch')
      for (let y = 0; y < header.height; y++) {
        if (raw[y * stride] !== 0) throw new Error('Fixture decoder requires actual filter-zero PNG')
        rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * header.width * 4)
      }
      return { width: header.width, height: header.height, rgba }
    },
    async transform(image, parameters) { return { ...image, rgba: transformRgba(image.rgba, parameters.tint, parameters.brightness) } },
    async encodePng(image) { return encodeFixtureRaster(image) },
  }, svg: {
    async rasterize(input, dimensions) {
      const source = verifyNormalizedStaticSvg(input)
      const color = /fill="(#[a-f0-9]{6})"/.exec(source.normalizedSource)?.[1]
      if (!color || source.nodeCount !== 2 || !source.normalizedSource.includes('<rect')) throw new Error('Trusted SVG test port only handles its full-view solid rectangle')
      if (dimensions.width > 1024 || dimensions.height > 1024) throw new Error('Fixture SVG pixel budget exceeded')
      const pixel = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16)), rgba = new Uint8ClampedArray(dimensions.width * dimensions.height * 4)
      for (let offset = 0; offset < rgba.length; offset += 4) rgba.set([...pixel, 255], offset)
      return { ...dimensions, rgba }
    },
  } }
}

export function artworkDraft(bundle: ProjectBundle, operationGroups: AuthoringOperation[][], artwork: NonNullable<AuthoringScope['artwork']>): AuthoringDraft {
  const start: AuthoringStart = { schemaVersion: 1, project: bundle.project, baseContentHash: authoringProjectHash(bundle.project),
    scope: { targetIds: [], placement: null, operations: [], artwork }, seed: '123e4567-e89b-42d3-a456-426614174000',
    preparedAt: '2026-10-24T12:00:00.000Z', skill: { id: 'sceneweave-artwork-authoring', version: 1 }, disclosure: 'complete-metadata/public-model' }
  let state = replayAuthoring(start, []).state
  for (let index = 0; index < operationGroups.length; index++) state = applyAuthoringStep(start, state, operationGroups[index], `art-step-${index + 1}`).state
  return { schemaVersion: 1, taskId: 'm24-artwork-fixture', generation: 1, start, state }
}
