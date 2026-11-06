import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures.js'
import * as geometry from '../geometry/geometry.js'
import type { SceneDocument } from '../model/scene.js'
import { cloneJson, freezeJson } from './json.js'
import { validateSceneDocument, type ValidationResult } from './scene.js'
import { getSceneDerivationEvidence, isCertifiedSceneSnapshot, validateSceneDerivationSnapshot, validateSceneSnapshot } from './snapshots.js'

afterEach(() => vi.restoreAllMocks())

function document(options: { roomSupport?: boolean; image?: boolean } = {}): SceneDocument {
  const scene = fixture({ building: true, image: options.image }).project.document
  scene.aggregateCoordinates = { encoding: 'world', groups: {
    'geometry-group': { id: 'geometry-group', floorId: 'blank-floor', parentId: null, editLocked: false,
      frame: { translationMm: { x: 0, y: 0 }, quarterTurns: 0 }, members: [{ kind: 'prop', id: 'item' }, { kind: 'prop', id: 'other' }] },
  } }
  if (options.roomSupport) scene.props.item.supportRef = { kind: 'room', id: 'room' }
  scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0',
    offsetReferenceVertexId: 'vertex-0', offsetMm: 1000, widthMm: 1200, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false }
  scene.entityLayers.door = scene.entityLayers.room
  return scene
}
function valid(result: ValidationResult): Extract<ValidationResult, { ok: true }> {
  if (!result.ok) throw new Error(result.errors.map(issue => `${issue.code}: ${issue.message}`).join('；'))
  return result
}
function certified(scene = document()): SceneDocument { return valid(validateSceneSnapshot(scene)).document }
function moved(scene: SceneDocument): SceneDocument {
  const candidate = cloneJson(scene)
  candidate.props.item.positionMm = { x: 5000, y: 5000 }; candidate.props.item.rotationDeg = 35
  return candidate
}
function breakUnrelatedGeometry(scene: SceneDocument): void {
  scene.vertices['vertex-0'].xMm = scene.vertices['vertex-2'].xMm
  scene.vertices['vertex-0'].yMm = scene.vertices['vertex-2'].yMm
}

describe('private certified scene derivation', () => {
  it('certifies an independently parsed valid baseline and never certifies malformed geometry', () => {
    const input = document(), result = valid(validateSceneSnapshot(input))
    expect(result.document).not.toBe(input)
    expect(isCertifiedSceneSnapshot(input)).toBe(false)
    expect(isCertifiedSceneSnapshot(result.document)).toBe(true)
    expect(Object.isFrozen(result.document.props.item.positionMm)).toBe(true)
    const invalid = document(); breakUnrelatedGeometry(invalid)
    expect(validateSceneSnapshot(invalid).ok).toBe(false)
    expect(isCertifiedSceneSnapshot(invalid)).toBe(false)
  })

  it('reuses real grouped prop moves without calling the full solver and matches public full validation', () => {
    const source = certified(), candidate = moved(source)
    candidate.props.other.positionMm = { x: 8000, y: 8000 }
    const full = vi.spyOn(geometry, 'validateGeometry')
    const result = valid(validateSceneDerivationSnapshot(candidate, source))
    expect(full).not.toHaveBeenCalled()
    expect(getSceneDerivationEvidence(result.document)).toEqual({ algorithmContract: 'aggregate-prop-move-geometry@1',
      baseline: { sceneId: source.sceneId, revision: source.revision }, changedPropIds: ['item', 'other'], groupIds: ['geometry-group'],
      reused: ['non-prop-geometry', 'unchanged-prop-geometry'] })
    expect(valid(validateSceneDocument(candidate))).toEqual(result)
    expect(full).toHaveBeenCalledTimes(1)
    full.mockClear()
    expect(valid(validateSceneDocument(result.document))).toEqual(result)
    expect(full).toHaveBeenCalledTimes(1)
    expect(getSceneDerivationEvidence(cloneJson(result.document))).toBeUndefined()
  })

  it('keeps evidence bound to the exact owned result when the caller mutates its candidate', () => {
    const source = certified(), candidate = moved(source), result = valid(validateSceneDerivationSnapshot(candidate, source))
    const evidence = getSceneDerivationEvidence(result.document)!
    candidate.props.item.positionMm.x = -1000
    candidate.aggregateCoordinates!.groups['geometry-group'].members = []
    expect(result.document.props.item.positionMm).toEqual({ x: 5000, y: 5000 })
    expect(getSceneDerivationEvidence(result.document)).toBe(evidence)
    expect(Object.isFrozen(evidence)).toBe(true)
    expect(Object.isFrozen(evidence.baseline)).toBe(true)
    expect(Object.isFrozen(evidence.changedPropIds)).toBe(true)
    expect(getSceneDerivationEvidence(candidate)).toBeUndefined()
  })

  it('cannot inherit baseline trust through a clone, caller freeze or public validation', () => {
    const source = certified(), publicScene = valid(validateSceneDocument(source)).document
    const full = vi.spyOn(geometry, 'validateGeometry')
    for (const untrusted of [cloneJson(source), freezeJson(cloneJson(source)), publicScene]) {
      full.mockClear()
      const result = valid(validateSceneDerivationSnapshot(moved(source), untrusted))
      expect(full).toHaveBeenCalledTimes(1)
      expect(getSceneDerivationEvidence(result.document)).toBeUndefined()
    }
  })

  it('rejects extra and accessor fields before solving and never reads a caller getter', () => {
    const source = certified(), full = vi.spyOn(geometry, 'validateGeometry'), extra = moved(source)
    Object.assign(extra.props.item, { validationProof: true })
    expect(validateSceneDerivationSnapshot(extra, source).ok).toBe(false)
    let reads = 0
    const accessor = moved(source)
    Object.defineProperty(accessor.props.item, 'positionMm', { enumerable: true, get() { reads++; return { x: 5000, y: 5000 } } })
    expect(validateSceneDerivationSnapshot(accessor, source).ok).toBe(false)
    expect(reads).toBe(0)
    expect(full).not.toHaveBeenCalled()
  })

  it('rejects bad moved support and unrelated geometry with the same full validation errors', () => {
    const source = certified(document({ roomSupport: true })), full = vi.spyOn(geometry, 'validateGeometry')
    const unsupported = moved(source); unsupported.props.item.positionMm = { x: 12000, y: 12000 }
    const supportResult = validateSceneDerivationSnapshot(unsupported, source)
    expect(supportResult.ok).toBe(false)
    expect(full).not.toHaveBeenCalled()
    expect(validateSceneDocument(unsupported)).toEqual(supportResult)
    full.mockClear()
    const broken = moved(source); breakUnrelatedGeometry(broken)
    const brokenResult = validateSceneDerivationSnapshot(broken, source)
    expect(full).toHaveBeenCalledTimes(1)
    expect(brokenResult.ok).toBe(false)
    expect(validateSceneDocument(broken)).toEqual(brokenResult)
  })

  it('falls back for every other field class and still rejects a bad candidate', () => {
    const source = certified(document({ image: true })), full = vi.spyOn(geometry, 'validateGeometry')
    const changes: [string, (scene: SceneDocument) => void][] = [
      ['entity lock', scene => { scene.props.item.editLocked = true }],
      ['visibility', scene => { scene.props.item.visibility = 'gm' }],
      ['footprint', scene => { scene.props.item.footprintMm.width = 300 }],
      ['aggregate membership', scene => { scene.aggregateCoordinates!.groups['geometry-group'].members = [{ kind: 'prop', id: 'other' }] }],
      ['support reference', scene => { scene.props.item.supportRef = { kind: 'room', id: 'room' } }],
      ['opening secrecy', scene => { scene.openings.door.secret = true }],
      ['resource metadata', scene => { scene.assets.image.origin.attribution = 'Changed metadata' }],
      ['revision', scene => { scene.revision++ }],
      ['constraints', scene => { scene.constraints.wallEndClearanceMm++ }],
      ['terrain', scene => {
        scene.terrainAreas['new-ground'] = { id: 'new-ground', floorId: 'blank-floor', editLocked: false, visibility: 'public',
          boundaryMm: [{ x: 14000, y: 14000 }, { x: 18000, y: 14000 }, { x: 18000, y: 18000 }, { x: 14000, y: 18000 }]
            .map((positionMm, index) => ({ id: `derivation-ground-point-${index}`, segmentId: `derivation-ground-edge-${index}`, positionMm })),
          groundElevationMm: 0, coveragePriority: 1, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1 }
        scene.entityLayers['new-ground'] = scene.entityLayers.item
      }],
    ]
    for (const [label, change] of changes) {
      const candidate = moved(source); change(candidate); full.mockClear()
      const result = valid(validateSceneDerivationSnapshot(candidate, source))
      expect(full, label).toHaveBeenCalledTimes(1)
      expect(getSceneDerivationEvidence(result.document), label).toBeUndefined()
      breakUnrelatedGeometry(candidate); full.mockClear()
      expect(validateSceneDerivationSnapshot(candidate, source).ok, label).toBe(false)
      expect(full, label).toHaveBeenCalledTimes(1)
    }
  })

  it('does not reuse when the record enumeration order changes', () => {
    const source = certified(), candidate = moved(source)
    candidate.props = Object.fromEntries(Object.entries(candidate.props).reverse())
    const full = vi.spyOn(geometry, 'validateGeometry'), result = valid(validateSceneDerivationSnapshot(candidate, source))
    expect(full).toHaveBeenCalledTimes(1)
    expect(getSceneDerivationEvidence(result.document)).toBeUndefined()
  })

  it('excludes props with prefab, scatter or decoration cluster member records', () => {
    for (const kind of ['prefab', 'scatter', 'decorationCluster'] as const) {
      const scene = document({ image: true }), prop = scene.props.item, layer = scene.entityLayers.item
      if (kind === 'prefab') {
        const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, supportRef: _support, ...template } = cloneJson(prop)
        scene.prefabDefinitions['move-prefab-definition'] = { id: 'move-prefab-definition', catalogId: 'test.derivation', version: 1,
          licenseRef: 'fixture-license', origin: { kind: 'original', attribution: 'Derivation test', canEmbed: true }, name: 'Move prefab', tags: [],
          members: [{ key: 'item', propTemplate: template }] }
        scene.prefabInstances['move-container'] = { id: 'move-container', floorId: prop.floorId, editLocked: false, visibility: 'public',
          definitionRef: { id: 'move-prefab-definition', version: 1 }, anchorMm: cloneJson(prop.positionMm), rotationDeg: 0,
          members: { item: { propId: prop.id, overrideFields: ['positionMm', 'rotationDeg'] } } }
      } else if (kind === 'scatter') {
        scene.paths['scatter-route'] = { id: 'scatter-route', floorId: prop.floorId, editLocked: false, visibility: 'public',
          centerlineMm: [{ x: 12000, y: 14000 }, { x: 18000, y: 14000 }], widthMm: 500,
          supportRefs: [{ kind: 'floor', id: prop.floorId }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
        scene.entityLayers['scatter-route'] = layer
        scene.scatterGroups['move-container'] = { id: 'move-container', floorId: prop.floorId, editLocked: false, visibility: 'public',
          domain: { kind: 'path', pathId: 'scatter-route' }, palette: [{ key: 'image', propDefinitionRef: { id: 'definition', version: 1 }, weight: 1 }],
          seed: 'derivation', algorithmVersion: 'scatter-cell-v1', gridOriginMm: { x: 0, y: 0 }, cellSizeMm: 1000, densityFactor: 0.5,
          minDistanceMm: 100, rotationRangeDeg: { min: 0, max: 359 }, members: { ['a'.repeat(64)]: { propId: prop.id, state: 'manual', overrideFields: ['positionMm'] } }, exclusions: [] }
      } else {
        scene.decorationClusters['move-container'] = { id: 'move-container', floorId: prop.floorId, editLocked: false, visibility: 'public',
          supportRef: { kind: 'floor', id: prop.floorId }, boundsMm: { x: 1000, y: 1000, width: 18000, height: 18000 }, seed: 'derivation', algorithmVersion: 'cluster-v1',
          palette: [{ key: 'image', definitionRef: { id: 'definition', version: 1 }, kind: 'prop', weight: 1 }],
          maxInstances: 1, spacingMm: 100, clusterRadiusMm: 1000, clearanceMm: 100,
          members: { ['a'.repeat(64)]: { kind: 'prop', entityId: prop.id, state: 'detached' } } }
      }
      scene.entityLayers['move-container'] = layer
      const source = certified(scene), full = vi.spyOn(geometry, 'validateGeometry')
      const result = valid(validateSceneDerivationSnapshot(moved(source), source))
      expect(full, kind).toHaveBeenCalledTimes(1)
      expect(getSceneDerivationEvidence(result.document), kind).toBeUndefined()
      full.mockRestore()
    }
  })
})
