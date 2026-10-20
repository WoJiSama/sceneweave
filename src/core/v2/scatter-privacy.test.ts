import { describe, expect, it } from 'vitest'
import { rectangleV2, scatterFixtureV2, testPropV2, testTerrainV2 } from './b3.test-helpers'
import { applyCommandsV2 } from './commands'
import { buildScatterRegenerationV2 } from './scatter'
import { validateSceneV2 } from './schema'
import type { SceneDocumentV2 } from './types'
import { createPublicVisibilityV2, publicTerrainViewV2 } from './visibility'

const regenerate = (scene: SceneDocumentV2, densityFactor?: number) => applyCommandsV2(scene, [{ type: 'regenerateScatter', id: 'trees', ...(densityFactor === undefined ? {} : { densityFactor }) }])
const publicProps = (scene: SceneDocumentV2) => { const visibility = createPublicVisibilityV2(scene); return Object.values(scene.props).filter(visibility.prop).sort((a, b) => a.id.localeCompare(b.id)) }
function addSecretGroup(scene: SceneDocumentV2, propId: string, kind: 'group' | 'path' | 'edge') {
  const group = structuredClone(scene.scatterGroups.trees)
  Object.assign(group, { id: 'secret-scatter', seed: 'secret-seed', members: { ['b'.repeat(64)]: { propId, state: 'manual', overrideFields: [] } }, exclusions: [] })
  if (kind === 'group') group.visibility = 'gm'
  if (kind === 'path') {
    scene.paths.secretPath = { id: 'secretPath', floorId: 'f-a1', editLocked: false, visibility: 'gm', centerlineMm: [{ x: 3000, y: 3000 }, { x: 3000, y: 16000 }], widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: 'island-low' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    group.domain = { kind: 'path', pathId: 'secretPath' }
  }
  if (kind === 'edge') { scene.terrainEdges.cliff.visibility = 'gm'; group.domain = { kind: 'edgeBand', edgeId: 'cliff', widthMm: 3000 } }
  scene.scatterGroups[group.id] = group
}

describe('public scatter ignores private derivation inputs', () => {
  it.each(['own', 'group', 'path', 'edge'] as const)('keeps identical adopted public props when a private %s obstacle moves', kind => {
    const base = regenerate(scatterFixtureV2()), candidate = Object.values(base.props)[0]
    const a = structuredClone(base), secret = testPropV2('secret', candidate.positionMm.x, candidate.positionMm.y)
    secret.blocksMovement = false
    if (kind === 'own') secret.visibility = 'gm'
    a.props.secret = secret
    if (kind !== 'own') addSecretGroup(a, secret.id, kind)
    const b = structuredClone(a); b.props.secret.positionMm = { x: 2000, y: 18000 }
    expect(validateSceneV2(a).ok).toBe(true); expect(validateSceneV2(b).ok).toBe(true)
    expect(createPublicVisibilityV2(a).prop(a.props.secret)).toBe(false)
    const regeneratedA = regenerate(a), regeneratedB = regenerate(b)
    expect(publicProps(regeneratedA)).toEqual(publicProps(regeneratedB)); expect(publicProps(regeneratedA)).toEqual(publicProps(base))
    expect(regeneratedA.props.secret).toEqual(a.props.secret); expect(regeneratedB.props.secret).toEqual(b.props.secret)
  })
  it('excludes a public-looking member owned by a GM prefab from public spacing obstacles', () => {
    const base = regenerate(scatterFixtureV2()), candidate = Object.values(base.props)[0], a = structuredClone(base)
    a.props.secret = testPropV2('secret', candidate.positionMm.x, candidate.positionMm.y)
    const { id: _id, floorId: _floor, editLocked: _lock, visibility: _visibility, supportRef: _support, ...template } = a.props.secret
    a.prefabDefinitions.secretPrefab = { id: 'secretPrefab', catalogId: 'sceneweave.test.secret-prefab', version: 1, licenseRef: 'MIT', origin: { kind: 'original', attribution: 'Sceneweave privacy test', canEmbed: true }, name: 'secret', tags: [], members: [{ key: 'item', propTemplate: template }] }
    a.prefabInstances.secretGroup = { id: 'secretGroup', floorId: 'f-a1', editLocked: false, visibility: 'gm', definitionRef: { id: 'secretPrefab', version: 1 }, anchorMm: { ...candidate.positionMm }, rotationDeg: 0, members: { item: { propId: 'secret', overrideFields: [] } } }
    const b = structuredClone(a); b.props.secret.positionMm = { x: 2000, y: 18000 }
    expect(validateSceneV2(a).ok).toBe(true); expect(validateSceneV2(b).ok).toBe(true)
    expect(publicProps(regenerate(a))).toEqual(publicProps(regenerate(b)))
  })
  it('resolves public support before private high-priority coverage and atomically refuses a real physical support conflict', () => {
    const scene = scatterFixtureV2(), before = structuredClone(scene), candidate = buildScatterRegenerationV2(scene, 'trees').props[0]
    const a = structuredClone(scene), b = structuredClone(scene)
    a.terrainAreas.secretPlateau = { ...testTerrainV2('secretPlateau', rectangleV2(candidate.positionMm.x - 350, candidate.positionMm.y - 350, 700, 700), 5000, 2), visibility: 'gm' }
    b.terrainAreas.secretPlateau = { ...testTerrainV2('secretPlateau', rectangleV2(200, 200, 200, 200), 5000, 2), visibility: 'gm' }
    expect(validateSceneV2(a).ok).toBe(true); expect(validateSceneV2(b).ok).toBe(true)
    const proposalA = buildScatterRegenerationV2(a, 'trees'), proposalB = buildScatterRegenerationV2(b, 'trees')
    expect(proposalA).toEqual(proposalB)
    const original = structuredClone(a)
    expect(() => regenerate(a)).toThrow(/有效支撑面/)
    expect(a).toEqual(original); expect(a.revision).toBe(before.revision)
    expect(publicProps(regenerate(b))).toEqual(buildScatterRegenerationV2(before, 'trees').props.sort((x, y) => x.id.localeCompare(y.id)))
  })
  it('preserves private managed member state at zero density without silently publishing it later', () => {
    let scene = regenerate(scatterFixtureV2()), prop = Object.values(scene.props)[0]
    prop.visibility = 'gm'
    const key = Object.entries(scene.scatterGroups.trees.members).find(([, member]) => member.propId === prop.id)![0]
    scene = regenerate(scene, 0)
    expect(scene.props[prop.id].visibility).toBe('gm'); expect(scene.scatterGroups.trees.members[key].state).toBe('managed')
    scene = regenerate(scene, 0.7)
    expect(scene.props[prop.id].visibility).toBe('gm'); expect(publicProps(scene).some(value => value.id === prop.id)).toBe(false)
  })
})

describe('effective private upstream ownership remains private', () => {
  it('covers private support, path support and edge neighbors before constructing the public terrain view', () => {
    const scene = scatterFixtureV2()
    scene.terrainAreas['island-low'].visibility = 'gm'
    scene.paths.path = { id: 'path', floorId: 'f-a1', editLocked: false, visibility: 'public', centerlineMm: [{ x: 3000, y: 3000 }, { x: 3000, y: 16000 }], widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: 'island-low' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
    scene.scatterGroups.trees.domain = { kind: 'path', pathId: 'path' }
    const prop = testPropV2('secret', 3000, 4000); scene.props.secret = prop
    const visibility = createPublicVisibilityV2(scene), view = publicTerrainViewV2(scene, visibility)
    expect(visibility.prop(prop)).toBe(false); expect(visibility.path('path')).toBe(false); expect(visibility.terrainEdge('cliff')).toBe(false); expect(visibility.scatterGroup('trees')).toBe(false)
    expect(view.terrainAreas['island-low']).toBeUndefined(); expect(view.paths.path).toBeUndefined(); expect(view.terrainEdges.cliff).toBeUndefined()
  })
  it.each(['path', 'edge'] as const)('persists effective GM visibility when a member exits a private %s domain', kind => {
    const scene = scatterFixtureV2()
    if (kind === 'path') {
      scene.paths.path = { id: 'path', floorId: 'f-a1', editLocked: false, visibility: 'gm', centerlineMm: [{ x: 3000, y: 3000 }, { x: 3000, y: 16000 }], widthMm: 2000, supportRefs: [{ kind: 'terrainArea', id: 'island-low' }], surfaceStyle: null, movementCostMultiplier: 1, renderOrder: 0 }
      scene.scatterGroups.trees.domain = { kind: 'path', pathId: 'path' }
    } else { scene.terrainEdges.cliff.visibility = 'gm'; scene.scatterGroups.trees.domain = { kind: 'edgeBand', edgeId: 'cliff', widthMm: 3000 } }
    const adopted = regenerate(scene), prop = Object.values(adopted.props)[0]
    expect(prop).toBeDefined(); expect(createPublicVisibilityV2(adopted).prop(prop)).toBe(false)
    const detached = applyCommandsV2(adopted, [{ type: 'detachScatterMember', groupId: 'trees', propId: prop.id }])
    expect(detached.props[prop.id].visibility).toBe('gm'); expect(createPublicVisibilityV2(detached).prop(detached.props[prop.id])).toBe(false)
  })
})
