import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import manifest from '../../../assets/sceneweave-handdrawn/manifest.json'
import { openingEndpointsV2, propFootprintV2 } from '../../core/v2/geometry'
import { validateSceneV2 } from '../../core/v2/schema'
import { inspectImageBytes } from '../../io/v2/resources'
import { applyCommandsV2 } from '../../core/v2/commands'
import { validateStudyEditsV2 } from './study-constraints'
import { checkStudyDoorwayClearances, createStudyDocument, createStudyPrivacyDocument, STUDY_IDS } from './study-sample'

const stamp = '2026-10-20T00:00:00.000Z'
const scene = () => createStudyDocument({ sceneId: 'study-fixture', now: stamp })
const file = (name: string) => readFile(new URL(`../../../public/assets/sceneweave-handdrawn/${name}`, import.meta.url))
function pngPixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts: Uint8Array[] = []
  let cursor = 8
  while (cursor < bytes.length) {
    const length = view.getUint32(cursor), kind = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8))
    if (kind === 'IDAT') parts.push(bytes.subarray(cursor + 8, cursor + 8 + length))
    cursor += length + 12
  }
  const raw = inflateSync(Buffer.concat(parts)), width = view.getUint32(16), height = view.getUint32(20)
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0) // The retained source encoder deliberately uses filter 0.
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { pixels, width, height }
}

describe('VIS-01 complete editable fixture', () => {
  it('opts into persistent doorway checks without treating arbitrary projects as VIS-01', () => {
    const document = scene()
    expect(() => validateStudyEditsV2(document)).not.toThrow()
    const blocked = applyCommandsV2(document, [{ type: 'updateProp', id: 'terrace-chair-south', changes: { positionMm: { x: 9900, y: 4700 }, rotationDeg: 45 } }])
    expect(() => validateStudyEditsV2(blocked)).toThrow(/terrace-door.*terrace-chair-south/)
    const reloaded = JSON.parse(JSON.stringify(blocked))
    expect(() => validateStudyEditsV2(reloaded)).toThrow(/被阻挡/)
    reloaded.presetSnapshot.presetId = 'custom-metric'
    expect(() => validateStudyEditsV2(reloaded)).not.toThrow()
    const movedWall = applyCommandsV2(document, [{ type: 'moveVertex', id: 'study-v1', positionMm: { x: 7800, y: 1000 } }])
    expect(() => validateStudyEditsV2(movedWall)).not.toThrow()
  })
  it('uses the prescribed slanted room, adjacent open terrace and one east wall', () => {
    const document = scene()
    expect(validateSceneV2(document).ok).toBe(true)
    expect(document.exportBoundsMm).toEqual({ x: 0, y: 0, width: 14000, height: 10000 })
    expect(Object.values(document.vertices).map(p => [p.xMm, p.yMm])).toEqual([[1000, 1000], [8000, 1000], [9000, 2000], [9000, 7000], [1000, 7000]])
    expect(Object.values(document.walls)).toHaveLength(5)
    expect(Object.values(document.walls).filter(w => w.startVertexId === 'study-v2' && w.endVertexId === 'study-v3')).toHaveLength(1)
    expect(document.terrainAreas[STUDY_IDS.terrace].boundaryMm.map(v => v.positionMm)).toEqual([{ x: 9000, y: 2500 }, { x: 13000, y: 2500 }, { x: 13000, y: 7000 }, { x: 9000, y: 7000 }])
    expect(document.openings['diagonal-window'].offsetMm).toBe(400)
    const [near, far] = openingEndpointsV2(document, document.openings['diagonal-window'])
    expect(Math.hypot(near.x - 8000, near.y - 1000)).toBeCloseTo(400, 6)
    expect(Math.hypot(far.x - near.x, far.y - near.y)).toBeCloseTo(600, 6)
    expect(document.rooms[STUDY_IDS.room].accessExpectation).toBe('required')
    expect(document.constraints).not.toHaveProperty('minPathWidthMm')
    expect(document.constraints.pathChecks).toEqual([])
  })

  it('keeps two exact expanded prefabs and independent props, without a default privacy mask', () => {
    const document = scene()
    expect(Object.values(document.props)).toHaveLength(13)
    expect(Object.keys(document.prefabInstances[STUDY_IDS.deskGroup].members)).toHaveLength(6)
    expect(Object.keys(document.prefabInstances[STUDY_IDS.terraceGroup].members)).toHaveLength(3)
    expect(document.props['study-desk'].positionMm).toEqual({ x: 3000, y: 2500 })
    expect(document.props['study-chair'].positionMm).toEqual({ x: 3000, y: 3400 })
    expect(document.props['terrace-table'].positionMm).toEqual({ x: 11100, y: 4400 })
    expect(document.props['terrace-chair-north'].rotationDeg).toBe(180)
    expect(document.props['study-books-left'].renderOrder).toBe(10)
    expect(document.props['study-papers'].renderOrder).toBe(20)
    expect(document.props['study-lamp'].renderOrder).toBe(30)
    expect(document.props['study-envelope']).toBeUndefined()
    expect(document.notes).toEqual({})
    expect(document.regions).toEqual({})
    const definition = Object.values(document.prefabDefinitions).find(p => p.catalogId === 'prefab.sw.study-desk')!
    document.props['study-desk'].positionMm.x += 500
    expect(definition.members.find(m => m.key === 'desk')!.propTemplate.positionMm).toEqual({ x: 0, y: 0 })
  })

  it('checks actual rotated blocking footprints in the 1200 mm terrace door approach', () => {
    const document = scene(), baseline = checkStudyDoorwayClearances(document)
    expect(baseline.every(check => check.ok)).toBe(true)
    expect(baseline.find(check => check.openingId === 'terrace-door')!.widthMm).toBe(1200)
    // The chair's center is outside the rectangle; its rotated corner still blocks it.
    const chair = document.props['terrace-chair-south']
    chair.positionMm = { x: 10650, y: 5200 }; chair.rotationDeg = 45
    expect(propFootprintV2(chair).some(p => p.x < 10500)).toBe(true)
    expect(propFootprintV2(chair).some(p => p.y < 5100)).toBe(true)
    const blocked = checkStudyDoorwayClearances(document).find(check => check.openingId === 'terrace-door')!
    expect(blocked.blockingPropIds).toEqual(['terrace-chair-south']); expect(blocked.ok).toBe(false)
    chair.blocksMovement = false
    expect(checkStudyDoorwayClearances(document).every(check => check.ok)).toBe(true)
    document.openings['terrace-door'].offsetMm += 100
    expect(checkStudyDoorwayClearances(document).find(check => check.openingId === 'terrace-door')!.aligned).toBe(false)
  })

  it('preserves physical defaults independently of PNG padding and visual variants', () => {
    const document = scene(), definitions = Object.values(document.propDefinitions)
    const oak = definitions.find(p => p.catalogId === 'prop.sw.chair-oak')!, worn = definitions.find(p => p.catalogId === 'prop.sw.chair-worn')!
    expect(worn.defaultAppearance).not.toEqual(oak.defaultAppearance)
    expect(worn.defaultFootprintMm).toEqual(oak.defaultFootprintMm)
    expect(worn.defaultBlocksMovement).toBe(oak.defaultBlocksMovement)
    expect(worn.defaultVisualBoundsMm).toEqual(oak.defaultVisualBoundsMm)
    expect(document.props['study-desk'].footprintMm).toEqual({ width: 1800, height: 800 })
    expect(document.props['study-desk'].visualBoundsMm).toEqual({ x: -1000, y: -500, width: 2000, height: 1000 })
    expect(document.props['study-rug'].renderLayer).toBe('ground')
    expect(document.props['study-rug'].blocksMovement).toBe(false)
    expect(document.props['study-lamp'].supportRef).toEqual({ kind: 'room', id: STUDY_IDS.room })
    expect(document.styleThemes[STUDY_IDS.theme].shadowPresets.furniture).toEqual({ directionDeg: 45, offsetMm: 120, blurMm: 80, opacity: .22, color: '#24313A' })
  })

  it('keeps world texture origin/scale and the unused variants in the portable definitions', () => {
    const document = scene(), floor = document.rooms[STUDY_IDS.room].floorStyle!.base
    expect(floor.tileSizeMm).toEqual({ width: 2000, height: 2000 })
    expect(floor.originMm).toEqual({ x: 0, y: 0 }); expect(floor.rotationDeg).toBe(0)
    expect(Object.values(document.materials).map(m => m.catalogId)).toContain('material.sw.wood-worn')
    expect(Object.values(document.propDefinitions).map(p => p.catalogId)).toContain('prop.sw.chair-worn')
    expect(Object.values(document.assets)).toHaveLength(15)
    const reloaded = JSON.parse(JSON.stringify(document))
    expect(validateSceneV2(reloaded).ok).toBe(true)
    expect(reloaded).toEqual(document)
  })

  it('keeps both privacy mutations entirely separate from the ordinary baseline and public fixture', () => {
    const first = createStudyPrivacyDocument('a'), second = createStudyPrivacyDocument('b')
    expect(validateSceneV2(first).ok).toBe(true); expect(validateSceneV2(second).ok).toBe(true)
    expect(first.regions['study-privacy-mask']).toEqual(second.regions['study-privacy-mask'])
    expect(first.regions['study-privacy-mask'].boundaryMm).toEqual([{ x: 1800, y: 1400 }, { x: 4200, y: 1400 }, { x: 4200, y: 4000 }, { x: 1800, y: 4000 }])
    expect(first.props['study-envelope'].appearance).not.toEqual(second.props['study-envelope'].appearance)
    expect(first.props['study-envelope'].shadowOverride).not.toEqual(second.props['study-envelope'].shadowOverride)
    expect(first.notes['study-clue'].text).not.toEqual(second.notes['study-clue'].text)
    expect(first.generationMetadata).not.toEqual(second.generationMetadata)
    expect(first.props['study-envelope'].visibility).toBe('gm'); expect(second.props['study-envelope'].visibility).toBe('gm')
    delete first.props['study-envelope']; delete second.props['study-envelope']
    delete first.notes['study-clue']; delete second.notes['study-clue']
    delete first.generationMetadata; delete second.generationMetadata
    expect(second).toEqual(first)
    expect(Object.keys(scene().props)).toHaveLength(13)
    expect(scene().regions).toEqual({})
  })
})

describe('original retained B2 art files', () => {
  it('matches every static PNG to its true manifest hash/header/size and retained SVG source', async () => {
    expect(manifest.status).toBe('P2')
    expect(manifest.assets).toHaveLength(15)
    for (const asset of manifest.assets) {
      const bytes = await file(asset.file)
      expect(bytes.length, asset.key).toBe(asset.sizeBytes)
      expect(createHash('sha256').update(bytes).digest('hex'), asset.key).toBe(asset.sha256)
      expect(inspectImageBytes(bytes), asset.key).toEqual({ mimeType: 'image/png', width: asset.pixelWidth, height: asset.pixelHeight })
      const source = await readFile(new URL(`../../../assets/sceneweave-handdrawn/${asset.sourceFile}`, import.meta.url), 'utf8')
      expect(createHash('sha256').update(source).digest('hex'), asset.key).toBe(asset.sourceSha256)
      expect(source).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
      expect(source).not.toMatch(/<image|<text|https?:\/\/(?!www\.w3\.org)|filter=|<script/)
    }
    expect(await file('manifest.json')).toEqual(await readFile(new URL('../../../assets/sceneweave-handdrawn/manifest.json', import.meta.url)))
    expect(await file('LICENSE.txt')).toEqual(await readFile(new URL('../../../LICENSE', import.meta.url)))
  })

  it('has opaque materials and at least 8 clear source pixels around every prop, with zero transparent RGB', async () => {
    for (const asset of manifest.assets) {
      const { pixels, width, height } = pngPixels(await file(asset.file))
      let minX = width, minY = height, maxX = -1, maxY = -1, dirtyClearPixels = 0, translucent = 0
      for (let p = 0; p < pixels.length; p += 4) {
        const a = pixels[p + 3], x = (p / 4) % width, y = Math.floor(p / 4 / width)
        if (!a) { if (pixels[p] || pixels[p + 1] || pixels[p + 2]) dirtyClearPixels++ }
        else { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
        if (a < 255) translucent++
      }
      expect(dirtyClearPixels, asset.key).toBe(0)
      expect({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, asset.key).toEqual(asset.alphaContentBoundsPx)
      if (asset.kind === 'material') expect(translucent, asset.key).toBe(0)
      else expect(Math.min(minX, minY, width - maxX - 1, height - maxY - 1), asset.key).toBeGreaterThanOrEqual(8)
    }
  })

  it('retains aligned 250 mm wood plank joints and a 12 mm paver seam at the declared physical density', async () => {
    const dark = pngPixels(await file('wood-dark.png')), worn = pngPixels(await file('wood-worn.png')), paver = pngPixels(await file('stone-paver.png'))
    const luminance = (data: ReturnType<typeof pngPixels>, x: number, y: number) => {
      const i = (y * data.width + x) * 4; return data.pixels[i] + data.pixels[i + 1] + data.pixels[i + 2]
    }
    for (const wood of [dark, worn]) {
      // 8 planks / 512 px: width 64 px = 250 mm. Every second joint shifts 128 px = 500 mm.
      for (let x = 64; x <= 448; x += 64) expect(luminance(wood, x, 80)).toBeLessThan(luminance(wood, x + 20, 80))
      expect(luminance(wood, 32, 256)).toBeLessThan(luminance(wood, 32, 240))
      expect(luminance(wood, 96, 128)).toBeLessThan(luminance(wood, 96, 112))
      expect(luminance(wood, 96, 384)).toBeLessThan(luminance(wood, 96, 368))
    }
    // A 3.072 px nominal gap (12 mm at 256 px/m) separates 128 px nominal pavers.
    expect(luminance(paver, 128, 80)).toBeLessThan(luminance(paver, 133, 80))
    expect(luminance(paver, 127, 80)).toBeLessThan(luminance(paver, 133, 80))
    expect(luminance(paver, 126, 80)).toBeGreaterThan(luminance(paver, 128, 80))
    expect(manifest.densityPxPerMetre).toBe(256)
  })
})
