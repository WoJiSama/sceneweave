import { expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { build } from 'vite'

type Bounds = { x: number; y: number; width: number; height: number }
type Environment = { ambientOpacity: number; exposure: number; contactShadowOpacity: number }
type JourneyProp = {
  id: string; floorId: string; visibility: string
  appearance: { kind: string; assetId?: string; opacity: number; tint: string | null }
  positionMm: { x: number; y: number }; rotationDeg: number; visualBoundsMm: Bounds
}
type JourneyVisual = {
  environment: Environment
  lights: Record<string, unknown>; fogs: Record<string, unknown>; filters: Record<string, unknown>
}
type JourneyDocument = {
  artStyle?: { version: number; active: string; materialDrawing?: number }
  exportBoundsMm: Bounds
  floors: Record<string, { id: string; outputBoundsMm?: Bounds; environment?: Environment }>
  props: Record<string, JourneyProp>
  assets: Record<string, { sha256: string; mimeType: string; pixelWidth: number; pixelHeight: number }>
  entityLayers: Record<string, string>
  visual: { version: 3; base: { version: 2; base: JourneyVisual } }
}
type ArchiveAppearance = {
  propSources: Record<string, string>
  sources: Record<string, { kind: string; snapshot: { appearance: JourneyProp['appearance']; visualBoundsMm: Bounds } }>
  presentations?: Record<string, { mode: string }>
  instanceAdjustments: Record<string, { enabled: boolean }[]>
  layerAdjustments: Record<string, { enabled: boolean }[]>
}

const journeyTableAssets = new Set(['refined-art-interior-table-long', 'refined-art-interior-table-round'])
let materialModule: Promise<string> | undefined
function materialModuleSource() {
  return materialModule ??= build({ configFile: false, publicDir: false, logLevel: 'silent', build: {
    lib: { entry: fileURLToPath(new URL('../src/platform/browser/render/material-drawing.ts', import.meta.url)), formats: ['es'] },
    write: false,
  } }).then(result => {
    const output = Array.isArray(result) ? result[0] : result
    if (!output || !('output' in output) || output.output.length !== 1 || output.output[0].type !== 'chunk') throw new Error('The material reference needs one browser module')
    return output.output[0].code
  })
}

/**
 * Paint the archived table bitmap with its wood brush under neutral light, then
 * position and compare it independently of the map renderer and projection.
 */
export async function verifyJourneyPng(page: Page, pngPath: string, archivePath: string, document: JourneyDocument) {
  const [pngBytes, archiveBytes] = await Promise.all([readFile(pngPath), readFile(archivePath)])
  const files = unzipSync(new Uint8Array(archiveBytes))
  const json = (name: string) => {
    expect(files[name], `Downloaded archive contains ${name}`).toBeTruthy()
    return JSON.parse(new TextDecoder().decode(files[name]))
  }
  expect(json('scene.json'), 'The pixel reference uses this exact downloaded scene').toEqual(document)
  const appearance = json('appearance.json') as ArchiveAppearance
  const floors = Object.values(document.floors)
  expect(floors, 'The complete journey exports one unambiguous floor').toHaveLength(1)
  const floor = floors[0], bounds = floor.outputBoundsMm ?? document.exportBoundsMm
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Number.isSafeInteger(bounds[key]), `Output ${key} is integer millimetres`).toBe(true)
  expect(bounds.width).toBeGreaterThan(0)
  expect(bounds.height).toBeGreaterThan(0)

  expect(document.visual.version).toBe(3)
  expect(document.visual.base.version).toBe(2)
  const visual = document.visual.base.base
  expect(Object.keys(visual.lights), 'Texture proof requires no scene lights').toEqual([])
  expect(Object.keys(visual.fogs), 'Texture proof requires no scene fog').toEqual([])
  expect(Object.keys(visual.filters), 'Texture proof requires no scene filters').toEqual([])
  expect(floor.environment ?? visual.environment, 'Texture proof requires neutral output lighting').toMatchObject({ ambientOpacity: 0, exposure: 1, contactShadowOpacity: 0 })

  expect(document.artStyle, 'The new scene retains its original palette and default material brush').toMatchObject({ version: 2, active: 'original', materialDrawing: 1 })
  const prop = Object.values(document.props).find(prop => prop.floorId === floor.id && prop.visibility === 'public'
    && prop.appearance.kind === 'image' && prop.appearance.opacity === 1 && prop.appearance.assetId !== undefined
    && journeyTableAssets.has(prop.appearance.assetId))
  if (!prop) throw new Error('The generated scene needs a public opaque wooden table for its texture proof')
  const sourceId = appearance.propSources[prop.id], source = appearance.sources[sourceId]
  expect(source?.kind, 'Selected bitmap has its archived appearance source').toBe('prop')
  expect(source.snapshot.appearance, 'Archived source appearance is the rendered appearance').toEqual(prop.appearance)
  expect(source.snapshot.visualBoundsMm).toEqual(prop.visualBoundsMm)
  expect(prop.appearance.tint, 'Texture proof requires an untinted source bitmap').toBeNull()
  expect(appearance.presentations?.[sourceId]?.mode === 'nearSide', 'Texture proof uses ordinary top-down furniture').toBe(false)
  expect((appearance.instanceAdjustments[prop.id] ?? []).filter(value => value.enabled), 'Texture proof requires no enabled instance adjustments').toEqual([])
  expect((appearance.layerAdjustments[document.entityLayers[prop.id]] ?? []).filter(value => value.enabled), 'Texture proof requires no enabled layer adjustments').toEqual([])
  const assetId = prop.appearance.assetId!
  const asset = document.assets[assetId]
  expect(asset, 'Selected furniture points to an archived image record').toBeTruthy()
  expect(asset.mimeType, 'Current generated furniture is a real PNG resource').toBe('image/png')
  const assetPath = `assets/${asset.sha256}.png`, sourceBytes = files[assetPath]
  expect(sourceBytes, `Selected furniture bytes exist at ${assetPath}`).toBeTruthy()
  expect(createHash('sha256').update(sourceBytes).digest('hex'), 'Reference image bytes match the scene hash').toBe(asset.sha256)

  const proof = await page.evaluate(async ({ pngBase64, sourceBase64, bounds, prop, materialCode, seed }) => {
    const decode = async (base64: string) => {
      const binary = atob(base64), bytes = Uint8Array.from(binary, value => value.charCodeAt(0))
      return createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    }
    const image = await decode(pngBase64)
    let source: ImageBitmap | undefined
    let painted: HTMLCanvasElement | undefined
    const script = URL.createObjectURL(new Blob([materialCode], { type: 'text/javascript' }))
    const target = globalThis.document.createElement('canvas'), reference = globalThis.document.createElement('canvas')
    try {
      source = await decode(sourceBase64)
      const { drawMaterialImage } = await import(script) as typeof import('../src/platform/browser/render/material-drawing')
      painted = drawMaterialImage(source, 'wood', seed)
      target.width = image.width; target.height = image.height
      const output = target.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
      if (!output) throw new Error('Browser could not allocate the downloaded PNG readback canvas')
      output.drawImage(image, 0, 0)
      const rgba = output.getImageData(0, 0, target.width, target.height).data
      const digest = await crypto.subtle.digest('SHA-256', rgba)
      const rgbaSha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
      let nonTransparentPixels = 0, opaquePixels = 0
      for (let index = 3; index < rgba.length; index += 4) {
        if (rgba[index]) nonTransparentPixels++
        if (rgba[index] === 255) opaquePixels++
      }

      const sx = image.width / bounds.width, sy = image.height / bounds.height
      const angle = prop.rotationDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), v = prop.visualBoundsMm
      const corners = [[v.x, v.y], [v.x + v.width, v.y], [v.x + v.width, v.y + v.height], [v.x, v.y + v.height]]
        .map(([x, y]) => ({ x: (prop.positionMm.x + x * cos - y * sin - bounds.x) * sx, y: (prop.positionMm.y + x * sin + y * cos - bounds.y) * sy }))
      const left = Math.max(0, Math.floor(Math.min(...corners.map(point => point.x))) - 2)
      const top = Math.max(0, Math.floor(Math.min(...corners.map(point => point.y))) - 2)
      const right = Math.min(image.width, Math.ceil(Math.max(...corners.map(point => point.x))) + 2)
      const bottom = Math.min(image.height, Math.ceil(Math.max(...corners.map(point => point.y))) + 2)
      if (right <= left || bottom <= top) throw new Error('Selected furniture is outside the downloaded PNG bounds')
      reference.width = right - left; reference.height = bottom - top
      const expected = reference.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
      if (!expected) throw new Error('Browser could not allocate the independent furniture reference canvas')
      expected.setTransform(sx, 0, 0, sy, -bounds.x * sx - left, -bounds.y * sy - top)
      expected.translate(prop.positionMm.x, prop.positionMm.y)
      expected.rotate(angle)
      expected.drawImage(painted, v.x, v.y, v.width, v.height)
      const pixels = expected.getImageData(0, 0, reference.width, reference.height).data
      let sampleCount = 0, matchedPixels = 0, maxChannelError = 0
      const textureColors = new Set<number>(), matchedTextureColors = new Set<number>()
      for (let y = 1; y < reference.height - 1; y++) for (let x = 1; x < reference.width - 1; x++) {
        let interior = true
        for (let dy = -1; dy <= 1 && interior; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (pixels[((y + dy) * reference.width + x + dx) * 4 + 3] !== 255) { interior = false; break }
        }
        if (!interior) continue
        const refIndex = (y * reference.width + x) * 4, outputIndex = ((top + y) * image.width + left + x) * 4
        const color = (pixels[refIndex] >> 3) * 1024 + (pixels[refIndex + 1] >> 3) * 32 + (pixels[refIndex + 2] >> 3)
        const error = Math.max(...[0, 1, 2].map(channel => Math.abs(pixels[refIndex + channel] - rgba[outputIndex + channel])))
        sampleCount++; textureColors.add(color); maxChannelError = Math.max(maxChannelError, error)
        if (error <= 2 && rgba[outputIndex + 3] === 255) { matchedPixels++; matchedTextureColors.add(color) }
      }
      return { width: image.width, height: image.height,
        rgba: { byteLength: rgba.length, sha256: rgbaSha256, nonTransparentPixels, opaquePixels },
        resource: { sourceWidth: source.width, sourceHeight: source.height, cropPx: { x: left, y: top, width: reference.width, height: reference.height },
          sampleCount, matchedPixels, matchingRatio: sampleCount ? matchedPixels / sampleCount : 0,
          textureColors: textureColors.size, matchedTextureColors: matchedTextureColors.size, maxChannelError, channelTolerance: 2 } }
    } finally {
      URL.revokeObjectURL(script)
      image.close(); source?.close()
      if (painted) painted.width = painted.height = 0
      target.width = target.height = reference.width = reference.height = 0
    }
  }, { pngBase64: pngBytes.toString('base64'), sourceBase64: Buffer.from(sourceBytes).toString('base64'), bounds, prop,
    materialCode: await materialModuleSource(), seed: Number.parseInt(asset.sha256.slice(0, 8), 16) })

  const ratio = 4096 / Math.max(bounds.width, bounds.height)
  expect({ width: proof.width, height: proof.height }, 'Actual browser-decoded PNG uses the fixed 4K output geometry').toEqual({ width: Math.max(1, Math.round(bounds.width * ratio)), height: Math.max(1, Math.round(bounds.height * ratio)) })
  expect(proof.rgba.byteLength).toBe(proof.width * proof.height * 4)
  expect(proof.rgba.nonTransparentPixels).toBeGreaterThan(0)
  expect({ width: proof.resource.sourceWidth, height: proof.resource.sourceHeight }, 'Browser decodes the exact archived source image dimensions').toEqual({ width: asset.pixelWidth, height: asset.pixelHeight })
  expect(proof.resource.sampleCount, 'Resource proof has at least 256 opaque interior pixels').toBeGreaterThanOrEqual(256)
  expect(proof.resource.textureColors, 'Resource proof includes varied texture rather than a flat patch').toBeGreaterThanOrEqual(16)
  expect(proof.resource.matchingRatio, `Painted archive texture appears at the actual furniture position: ${JSON.stringify(proof.resource)}`).toBeGreaterThanOrEqual(.9)
  expect(proof.resource.matchedTextureColors, 'Matching output contains the varied source texture').toBeGreaterThanOrEqual(16)
  return { ...proof, resource: { propId: prop.id, assetId, sha256: asset.sha256, archivePath: assetPath, ...proof.resource } }
}
