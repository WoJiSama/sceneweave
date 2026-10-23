import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import indoor from '../../../assets/sceneweave-handdrawn/manifest.json'
import outdoor from '../../../assets/sceneweave-handdrawn-outdoor/manifest.json'
import outpost from '../../../assets/sceneweave-handdrawn-outpost/manifest.json'
import { applyCommandsV2 } from '../../core/v2/commands'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { openingEndpointsV2, polygonsOverlapV2, propFootprintV2 } from '../../core/v2/geometry'
import { checkTerrainTravelV2 } from '../../core/v2/terrain-travel'
import { applyCommandsV3 } from '../../core/v3/commands'
import { geometryDocumentForValidationV3 } from '../../core/v3/domain'
import { validateSceneV3 } from '../../core/v3/schema'
import { LAYER_ENTITY_COLLECTIONS_V3 } from '../../core/v3/types'
import { createCompositionContentV6 } from '../../core/v6/graph'
import { inspectImageBytes } from '../../io/v2/resources'
import { projectSceneV3 } from '../../render/v3/projection'
import { createBlankDocumentV2 } from '../v2/blank-project'
import { createStudyDocument } from '../v2/study-sample'
import { createOutdoorBlankDocument } from './blank-project'
import { checkOutpostRoutesV3, OUTPOST_PRESET_ID, validateOutpostEditsV3 } from './outpost-constraints'
import { createOutpostDocument, createOutpostPrivacyDocument, OUTPOST_BOUNDS, OUTPOST_IDS } from './outpost-project'

const options = { sceneId: 'outpost-test', now: '2026-10-23T00:00:00.000Z' }
const scene = () => createOutpostDocument(options)

describe('M1-D editable mixed coastal outpost', () => {
  it('constructs the prescribed world, one Floor, equal-priority plateaus and genuinely shared architecture', () => {
    const document = scene()
    expect(validateSceneV3(document).ok).toBe(true)
    expect(document.exportBoundsMm).toEqual(OUTPOST_BOUNDS)
    expect(Object.keys(document.floors)).toEqual([OUTPOST_IDS.floor])
    expect(document.presetSnapshot.presetId).toBe(OUTPOST_PRESET_ID)
    expect(document.constraints.pathChecks).toEqual([])
    expect(document.terrainAreas[OUTPOST_IDS.low].boundaryMm.map(point => [point.positionMm.x, point.positionMm.y])).toEqual([[2000, 4000], [17000, 2000], [23000, 5000], [23000, 20000], [17000, 24000], [3000, 23000]])
    expect(document.terrainAreas[OUTPOST_IDS.high].boundaryMm.map(point => [point.positionMm.x, point.positionMm.y])).toEqual([[23000, 5000], [32000, 7000], [33000, 18000], [23000, 20000]])
    expect(document.terrainAreas[OUTPOST_IDS.low].coveragePriority).toBe(document.terrainAreas[OUTPOST_IDS.high].coveragePriority)
    expect(document.rooms[OUTPOST_IDS.room].groundElevationMm).toBe(1000)
    expect(document.rooms[OUTPOST_IDS.store].groundElevationMm).toBe(1000)
    expect(Object.values(document.walls)).toHaveLength(7)
    const shared = document.walls[OUTPOST_IDS.sharedWall]
    expect(Object.values(document.rooms).every(room => room.boundaryVertexIds.includes(shared.startVertexId) && room.boundaryVertexIds.includes(shared.endVertexId))).toBe(true)
    const native = geometryDocumentForValidationV3(document)
    expect(openingEndpointsV2(native, document.openings[OUTPOST_IDS.entrance])).toEqual([{ x: 8400, y: 13000 }, { x: 9600, y: 13000 }])
    expect(openingEndpointsV2(native, document.openings[OUTPOST_IDS.sharedDoor])).toEqual([{ x: 12000, y: 9500 }, { x: 12000, y: 10500 }])
    expect(document.terrainConnections[OUTPOST_IDS.connection]).toMatchObject({ widthMm: 2000, from: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.low }, positionMm: { x: 21500, y: 13000 } }, to: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.high }, positionMm: { x: 24500, y: 13000 } } })
    expect(document.paths[OUTPOST_IDS.path]).toMatchObject({ centerlineMm: [{ x: 9000, y: 14000 }, { x: 9000, y: 16000 }, { x: 21000, y: 16000 }, { x: 21500, y: 13000 }], widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: OUTPOST_IDS.low }] })
    expect(() => validateOutpostEditsV3(document)).not.toThrow()
    expect(checkOutpostRoutesV3(document).map(result => ({ id: result.id, ok: result.ok, issues: result.issues }))).toEqual(expect.arrayContaining([expect.objectContaining({ id: OUTPOST_IDS.connection, ok: true })]))
    expect(checkOutpostRoutesV3(document).every(result => result.ok)).toBe(true)
  })

  it('retains 34 fixed image roots, 23 prop definitions, 11 materials and the exact prior prefab definitions', () => {
    const document = scene(), study = createStudyDocument(options)
    expect(Object.keys(document.assets)).toHaveLength(34)
    expect(Object.keys(document.propDefinitions)).toHaveLength(23)
    expect(Object.keys(document.materials)).toHaveLength(11)
    expect(Object.keys(document.prefabDefinitions)).toHaveLength(3)
    for (const [id, definition] of Object.entries(study.prefabDefinitions)) expect(document.prefabDefinitions[id]).toEqual(definition)
    expect(document.prefabDefinitions['m1d-pf-01'].members.map(member => ({ key: member.key, position: member.propTemplate.positionMm, rotation: member.propTemplate.rotationDeg }))).toEqual([
      { key: 'crate-left', position: { x: -600, y: 0 }, rotation: 0 }, { key: 'crate-right', position: { x: 600, y: 0 }, rotation: 90 }, { key: 'papers', position: { x: -600, y: 0 }, rotation: 0 },
    ])
    expect(Object.keys(document.prefabInstances)).toHaveLength(2)
    expect(Object.keys(document.prefabInstances[OUTPOST_IDS.deskGroup].members)).toHaveLength(6)
    expect(Object.keys(document.prefabInstances[OUTPOST_IDS.suppliesGroup].members)).toHaveLength(3)
    const dependency = collectDependenciesV2(geometryDocumentForValidationV3(document))
    expect(dependency.assetIds).toHaveLength(34)
    expect(createCompositionContentV6(document).historyIdentity.version).toBe(3)
    expect(scene()).toEqual(document)
  })

  it('persists actual tree movement, locks and shrub deletion/exclusion, preserving all on density changes', () => {
    let document = scene()
    const treeGroup = document.scatterGroups[OUTPOST_IDS.scatterTrees], shrubs = document.scatterGroups[OUTPOST_IDS.scatterShrubs]
    const manual = Object.entries(treeGroup.members).find(([, member]) => member.state === 'manual')!
    expect(manual).toBeDefined()
    expect(manual[1].overrideFields).toContain('positionMm')
    const locked = Object.values(treeGroup.members).find(member => member.propId && member.propId !== manual[1].propId)!
    document = applyCommandsV3(document, [{ type: 'setEditLock', kind: 'prop', id: locked.propId!, locked: true }])
    expect(Object.values(shrubs.members).some(member => member.state === 'deleted' && member.propId === null)).toBe(true)
    expect(shrubs.exclusions.some(exclusion => exclusion.reason === 'delete' && exclusion.sourceCandidateKey)).toBe(true)
    const before = structuredClone(document), current = applyCommandsV3(document, [{ type: 'regenerateScatter', id: treeGroup.id, densityFactor: .8 }])
    expect(current.props[manual[1].propId!]).toEqual(before.props[manual[1].propId!])
    expect(current.props[locked.propId!]).toEqual(before.props[locked.propId!])
    expect(current.scatterGroups[treeGroup.id].exclusions).toEqual(before.scatterGroups[treeGroup.id].exclusions)
    expect(() => validateOutpostEditsV3(current)).not.toThrow()
    const unblocked = applyCommandsV3(document, [{ type: 'setEditLock', kind: 'prop', id: locked.propId!, locked: false }])
    const regeneratedShrubs = applyCommandsV3(unblocked, [{ type: 'regenerateScatter', id: shrubs.id, densityFactor: .8 }])
    expect(regeneratedShrubs.scatterGroups[shrubs.id].exclusions).toEqual(shrubs.exclusions)
    const deleted = Object.entries(shrubs.members).find(([, member]) => member.state === 'deleted')!
    expect(regeneratedShrubs.scatterGroups[shrubs.id].members[deleted[0]]).toEqual(deleted[1])
    for (const group of Object.values(document.scatterGroups)) for (const member of Object.values(group.members)) if (member.propId) for (const exclusion of group.exclusions) expect(polygonsOverlapV2(propFootprintV2(document.props[member.propId]), exclusion.boundaryMm)).toBe(false)
    expect(() => applyCommandsV3(document, [{ type: 'updateProp', id: locked.propId!, changes: { positionMm: { x: 28000, y: 9000 } } }])).toThrow(/锁/)
  })

  it('reports closed doors as blocked while preserving legal structure; appearance and water color grant no passage', () => {
    const document = scene(), native = geometryDocumentForValidationV3(document)
    document.openings[OUTPOST_IDS.entrance].state = 'closed'
    expect(validateSceneV3(document).ok).toBe(true)
    expect(() => validateOutpostEditsV3(document)).not.toThrow()
    expect(checkOutpostRoutesV3(document).find(result => result.id === OUTPOST_IDS.entrance)?.ok).toBe(false)
    const water = structuredClone(native)
    water.terrainAreas[OUTPOST_IDS.water].surfaceStyle!.base.tint = '#ADD8E6'
    expect(checkTerrainTravelV2(water, { floorId: OUTPOST_IDS.floor, from: { x: 1000, y: 1000 }, to: { x: 1800, y: 1000 }, widthMm: 500 }).ok).toBe(false)
    const bypass = checkTerrainTravelV2(native, { floorId: OUTPOST_IDS.floor, from: { x: 21500, y: 8000 }, to: { x: 24500, y: 8000 }, widthMm: 1000 })
    expect(bypass.ok).toBe(false)
    expect(bypass.issues.some(issue => issue.code === 'TERRAIN_HEIGHT_CONNECTION')).toBe(true)
    const before = native.props[OUTPOST_IDS.bookshelf], replacement = applyCommandsV2(native, [{ type: 'replacePropAppearance', id: before.id, definitionRef: { id: 'm1d-p-02', version: 1 } }]).props[before.id]
    expect(replacement.footprintMm).toEqual(before.footprintMm)
    expect(replacement.blocksMovement).toBe(before.blocksMovement)
    expect(replacement.supportRef).toEqual(before.supportRef)
  })

  it('rejects detached stair endpoints and route blockers without changing the source', () => {
    const document = scene(), before = structuredClone(document)
    expect(() => applyCommandsV3(document, [{ type: 'updateTerrainConnection', id: OUTPOST_IDS.connection, changes: { to: { surfaceRef: { kind: 'terrainArea', id: OUTPOST_IDS.high }, positionMm: { x: 21000, y: 13000 } } } }])).toThrow(/连接/)
    expect(document).toEqual(before)
    const moved = applyCommandsV3(document, [{ type: 'transformPrefab', id: OUTPOST_IDS.suppliesGroup, anchorMm: { x: 14500, y: 16000 } }])
    expect(() => validateOutpostEditsV3(moved)).toThrow(/道路/)
    expect(document).toEqual(before)
  })

  it('extends the complete south wall with both stable endpoints and preserves the attached doorway and shared rooms', () => {
    const document = scene(), before = structuredClone(document), wall = document.walls[OUTPOST_IDS.southWall]
    for (const delta of [100, 300, 500]) {
      const next = applyCommandsV3(document, [wall.startVertexId, wall.endVertexId].map(id => ({ type: 'moveVertex' as const, id, positionMm: { x: document.vertices[id].xMm, y: document.vertices[id].yMm + delta } })))
      expect(next.rooms[OUTPOST_IDS.room].boundaryVertexIds).toEqual(document.rooms[OUTPOST_IDS.room].boundaryVertexIds)
      expect(next.rooms[OUTPOST_IDS.store].boundaryVertexIds).toEqual(document.rooms[OUTPOST_IDS.store].boundaryVertexIds)
      expect(next.openings[OUTPOST_IDS.entrance]).toEqual(document.openings[OUTPOST_IDS.entrance])
      expect(openingEndpointsV2(geometryDocumentForValidationV3(next), next.openings[OUTPOST_IDS.entrance])).toEqual([{ x: 8400, y: 13000 + delta }, { x: 9600, y: 13000 + delta }])
      expect(() => validateOutpostEditsV3(next)).not.toThrow()
    }
    expect(document).toEqual(before)
  })

  it('permits wider saved paths while checking their actual band, support and stair attachment', () => {
    const document = scene()
    for (const widthMm of [2200, 2300]) {
      const next = applyCommandsV3(document, [{ type: 'updatePath', id: OUTPOST_IDS.path, changes: { widthMm } }])
      expect(() => validateOutpostEditsV3(next)).not.toThrow()
    }
  })

  it('keeps layer organization distinct from physical elevation and isolates the public landmark text', () => {
    const document = scene()
    expect(Object.keys(document.userLayers)).toHaveLength(6)
    for (const collection of LAYER_ENTITY_COLLECTIONS_V3) for (const entity of Object.values(document[collection])) expect(document.userLayers[document.entityLayers[entity.id]]).toBeDefined()
    for (const group of Object.values(document.prefabInstances)) for (const member of Object.values(group.members)) if (member.propId) expect(document.entityLayers[member.propId]).toBe(document.entityLayers[group.id])
    expect(document.notes[OUTPOST_IDS.secretNote]).toMatchObject({ text: '灯架下藏有返航账目', visibility: 'gm' })
    expect(document.notes[OUTPOST_IDS.publicLabel]).toMatchObject({ text: '瞭望点', visibility: 'public' })
    expect(document.notes[OUTPOST_IDS.publicDescription].visibility).toBe('public')
    const moved = applyCommandsV3(document, [{ type: 'moveEntitiesToLayer', ids: [OUTPOST_IDS.lamp], layerId: OUTPOST_IDS.layers.annotations }])
    expect(moved.props[OUTPOST_IDS.lamp]).toEqual(document.props[OUTPOST_IDS.lamp])
  })

  it('uses independent private crate/text/shadow variants and a secret-free reference with the same mask', () => {
    const a = createOutpostPrivacyDocument('a', options), b = createOutpostPrivacyDocument('b', options), reference = createOutpostPrivacyDocument('reference', options)
    for (const document of [a, b, reference]) {
      expect(validateSceneV3(document).ok).toBe(true)
      expect(document.regions[OUTPOST_IDS.privacyMask].boundaryMm).toEqual([{ x: 12500, y: 7500 }, { x: 15500, y: 7500 }, { x: 15500, y: 11500 }, { x: 12500, y: 11500 }])
      expect(() => projectSceneV3(document, 'player')).not.toThrow()
    }
    expect(reference.props[OUTPOST_IDS.privacyCrate]).toBeUndefined()
    expect(reference.notes[OUTPOST_IDS.privacyNote]).toBeUndefined()
    expect(a.props[OUTPOST_IDS.privacyCrate]).not.toEqual(b.props[OUTPOST_IDS.privacyCrate])
    expect(a.notes[OUTPOST_IDS.privacyNote].text).not.toBe(b.notes[OUTPOST_IDS.privacyNote].text)
    const publicIds = (document: ReturnType<typeof scene>) => Object.values(document.props).filter(prop => prop.visibility === 'public')
    expect(publicIds(a)).toEqual(publicIds(b)); expect(publicIds(a)).toEqual(publicIds(reference))
  })

  it('reports unsupported versions and missing required fixtures without an empty success result', () => {
    const version = scene(); version.presetSnapshot.presetVersion = 2
    expect(checkOutpostRoutesV3(version)).toEqual([expect.objectContaining({ ok: false, from: null, to: null, issues: [expect.objectContaining({ code: 'OUTPOST_UNSUPPORTED_VERSION' })] })])
    const missing = scene()
    for (const id of [OUTPOST_IDS.entrance, OUTPOST_IDS.sharedDoor]) { delete missing.openings[id]; delete missing.entityLayers[id] }
    delete missing.paths[OUTPOST_IDS.path]; delete missing.entityLayers[OUTPOST_IDS.path]
    delete missing.terrainConnections[OUTPOST_IDS.connection]; delete missing.entityLayers[OUTPOST_IDS.connection]
    const results = checkOutpostRoutesV3(missing)
    expect(results).toHaveLength(4)
    expect(results.every(result => !result.ok && result.from === null && result.issues.some(issue => issue.code === 'OUTPOST_MISSING_FIXTURE'))).toBe(true)
  })

  it('extends only new v6 blank catalogs, keeping blank geometry empty and preserving existing prop defaults', () => {
    const input = { title: '空白哨所', widthMm: 36000, heightMm: 28000, preset: 'investigation' as const, ...options }
    const blank = createOutdoorBlankDocument(input), prior = createBlankDocumentV2(input)
    expect(Object.keys(blank.props)).toHaveLength(0); expect(Object.keys(blank.terrainAreas)).toHaveLength(0); expect(Object.keys(blank.rooms)).toHaveLength(0)
    expect(blank.sceneId).toBe(options.sceneId)
    for (const [id, definition] of Object.entries(prior.propDefinitions)) expect(blank.propDefinitions[id]).toEqual(definition)
    for (const pack of [{ prefix: 'b2', manifest: indoor }, { prefix: 'b3', manifest: outdoor }]) {
      let materialIndex = 0
      for (const [assetIndex, entry] of pack.manifest.assets.entries()) if (entry.kind === 'material') {
        const id = `${pack.prefix}-m-${String(++materialIndex).padStart(2, '0')}`
        expect(blank.materials[id]).toEqual({ id, catalogId: entry.catalogId, version: 1, name: entry.name, tags: ['墨绘原野', '原创', 'P2'],
          licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave contributors；项目原创 SVG 绘制，Codex 辅助；源文件及 MIT 记录随仓库保存', canEmbed: true },
          textureAssetId: `${pack.prefix}-a-${String(assetIndex + 1).padStart(2, '0')}`, defaultTileSizeMm: { ...entry.logicalSizeMm }, applicableSurfaces: entry.surfaces })
      }
    }
    expect(Object.keys(blank.assets)).toHaveLength(34); expect(Object.keys(blank.prefabDefinitions)).toHaveLength(3)
    expect(blank.activeStyleThemeRef).toBeNull()
  })

  it('binds every new and old authored PNG to actual source hash and dimensions', async () => {
    for (const pack of [{ folder: 'sceneweave-handdrawn', manifest: indoor }, { folder: 'sceneweave-handdrawn-outdoor', manifest: outdoor }, { folder: 'sceneweave-handdrawn-outpost', manifest: outpost }]) for (const entry of pack.manifest.assets) {
      const bytes = await readFile(new URL(`../../../public/assets/${pack.folder}/${entry.file}`, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256)
      expect(bytes.length).toBe(entry.sizeBytes)
      expect(bytes.readUInt32BE(16)).toBe(entry.pixelWidth); expect(bytes.readUInt32BE(20)).toBe(entry.pixelHeight)
      expect(inspectImageBytes(bytes)).toEqual({ mimeType: 'image/png', width: entry.pixelWidth, height: entry.pixelHeight })
    }
  })

  it('checks source SVG hashes and real alpha padding without trusting manifest claims', async () => {
    for (const entry of outpost.assets) {
      const source = await readFile(new URL(`../../../assets/sceneweave-handdrawn-outpost/${entry.sourceFile}`, import.meta.url))
      expect(createHash('sha256').update(source).digest('hex')).toBe(entry.sourceSha256)
      const bytes = await readFile(new URL(`../../../public/assets/sceneweave-handdrawn-outpost/${entry.file}`, import.meta.url)), data: Uint8Array[] = [], chunks: string[] = []
      for (let cursor = 8; cursor < bytes.length;) {
        const length = bytes.readUInt32BE(cursor), name = bytes.subarray(cursor + 4, cursor + 8).toString()
        chunks.push(name)
        if (name === 'IDAT') data.push(bytes.subarray(cursor + 8, cursor + 8 + length))
        cursor += length + 12
      }
      expect(chunks).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
      const raw = inflateSync(Buffer.concat(data)), width = entry.pixelWidth, height = entry.pixelHeight
      expect(raw.length).toBe((width * 4 + 1) * height)
      let minX = width, minY = height, maxX = -1, maxY = -1, fullyOpaque = true
      for (let y = 0; y < height; y++) {
        expect(raw[y * (width * 4 + 1)]).toBe(0)
        for (let x = 0; x < width; x++) {
          const index = y * (width * 4 + 1) + 1 + x * 4, alpha = raw[index + 3]
          fullyOpaque &&= alpha === 255
          if (alpha) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
          else if (raw[index] || raw[index + 1] || raw[index + 2]) throw new Error(`透明像素残留RGB：${entry.file}@${x},${y}`)
        }
      }
      expect(entry.fullyOpaque).toBe(fullyOpaque)
      expect(entry.alphaContentBoundsPx).toEqual({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      if (entry.kind === 'prop') {
        const padding = Math.min(minX, minY, width - 1 - maxX, height - 1 - maxY)
        expect(padding).toBeGreaterThanOrEqual(8)
        expect(entry.minTransparentPaddingPx).toBe(padding)
      } else expect(fullyOpaque).toBe(true)
    }
  })
})
