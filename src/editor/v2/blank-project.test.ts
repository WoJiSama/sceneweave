import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCommandsV2 } from '../../core/v2/commands'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import { validateSceneV2 } from '../../core/v2/schema'
import { exportProjectV2, importProjectV2 } from '../../io/v2/project-file'
import { inspectImageBytes } from '../../io/v2/resources'
import type { CompleteProjectV2 } from '../../io/v2/types'
import { BLANK_PRESETS_V2, BLANK_SCENE_LIMITS_V2, createBlankDocumentV2, createBlankProjectV2, type BlankDocumentOptionsV2 } from './blank-project'
import { validateIslandEditsV2 } from './island-constraints'
import { createIslandDocument } from './island-sample'
import { validateStudyEditsV2 } from './study-constraints'
import { createStudyDocument } from './study-sample'
import { WorkspaceV2 } from './workspace'

const options: BlankDocumentOptionsV2 = { title: '我的空白场景', widthMm: 14000, heightMm: 10000, preset: 'investigation', sceneId: 'blank-test', now: '2026-10-21T00:00:00.000Z' }
const staticFetch = async (input: string | URL | Request) => {
  const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost').pathname
  if (!/^\/assets\/sceneweave-handdrawn(?:-outdoor)?\/[a-z0-9-]+\.png$/.test(path)) throw new Error(`Unexpected resource URL: ${path}`)
  return new Response(new Uint8Array(await readFile(new URL(`../../../public${path}`, import.meta.url))).buffer, { headers: { 'Content-Type': 'image/png' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(staticFetch))
  // Node has no browser decoder. Real static bytes still pass CRC, hash, dimensions and resource closure checks.
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const header = inspectImageBytes(new Uint8Array(await blob.arrayBuffer()))
    return { width: header.width, height: header.height, close: vi.fn() }
  }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('C1a blank strict-v2 document', () => {
  it.each(BLANK_PRESETS_V2)('starts a genuinely empty single floor with the generic $id preference', preset => {
    const document = createBlankDocumentV2({ ...options, title: '  新场景  ', preset: preset.id })
    expect(validateSceneV2(document).ok).toBe(true)
    expect(document).toMatchObject({ schemaVersion: 2, sceneId: options.sceneId, revision: 0, title: '新场景', createdAt: options.now, updatedAt: options.now,
      presetSnapshot: { presetId: preset.id, presetVersion: 1, distanceMode: preset.distanceMode, gridSizeMm: preset.gridSizeMm },
      units: { world: 'mm', display: preset.display, gridSizeMm: preset.gridSizeMm, snapMm: preset.snapMm, gridVisible: preset.gridVisible } })
    expect(Object.values(document.floors)).toEqual([{ id: 'blank-floor', name: '一层', boundsMm: { x: 0, y: 0, width: 14000, height: 10000 } }])
    expect(document.exportBoundsMm).toEqual(document.floors['blank-floor'].boundsMm)
    for (const kind of ['vertices', 'walls', 'openings', 'rooms', 'props', 'regions', 'notes', 'materials', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabDefinitions', 'prefabInstances', 'scatterGroups', 'styleThemes'] as const) expect(document[kind]).toEqual({})
    expect(document.activeStyleThemeRef).toBeNull(); expect(document).not.toHaveProperty('generationMetadata')
    expect(document.constraints.entranceOpeningIds).toEqual([]); expect(document.constraints.pathChecks).toEqual([])
    expect(() => validateStudyEditsV2(document)).not.toThrow(); expect(() => validateIslandEditsV2(document)).not.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('adopts exactly the unchanged B2/B3 object definitions and their referenced assets, without sample material resources', () => {
    const document = createBlankDocumentV2(options), study = createStudyDocument(), island = createIslandDocument()
    expect(document.propDefinitions).toEqual({ ...study.propDefinitions, ...island.propDefinitions })
    expect(Object.keys(document.propDefinitions)).toHaveLength(18); expect(Object.keys(document.assets)).toHaveLength(18)
    for (const definition of Object.values(document.propDefinitions)) {
      if (definition.defaultAppearance.kind !== 'image') throw new Error('built-in fixture is not an image')
      const id = definition.defaultAppearance.assetId
      expect(document.assets[id]).toEqual(study.assets[id] ?? island.assets[id])
    }
    expect(collectDependenciesV2(document).subjects).toHaveLength(36)
    document.propDefinitions['b2-p-03'].defaultFootprintMm.width = 100
    expect(createBlankDocumentV2(options).propDefinitions['b2-p-03']).toEqual(study.propDefinitions['b2-p-03'])
  })

  it('allows explicit grid visibility and creates independent scene identities', () => {
    const a = createBlankDocumentV2({ title: 'a', widthMm: 14000, heightMm: 10000, preset: 'tactical', gridVisible: false })
    const b = createBlankDocumentV2({ title: 'b', widthMm: 14000, heightMm: 10000, preset: 'narrative', gridVisible: true })
    expect(a.sceneId).not.toBe(b.sceneId)
    expect(a.units.gridVisible).toBe(false); expect(b.units.gridVisible).toBe(true)
    expect(a.exportBoundsMm).toEqual(b.exportBoundsMm)
  })

  it.each([
    { title: '   ' }, { title: 'a'.repeat(BLANK_SCENE_LIMITS_V2.maxTitleLength + 1) },
    { widthMm: 999 }, { heightMm: 200001 }, { widthMm: 1234.5 }, { heightMm: NaN }, { widthMm: Infinity },
    { widthMm: 1000, heightMm: 21000 }, { preset: 'unknown' }, { extra: true }, { sceneId: '__proto__' }, { now: 'today' },
  ])('rejects unsafe or unsupported creation options before loading assets: %j', changes => {
    expect(() => createBlankDocumentV2({ ...options, ...changes } as BlankDocumentOptionsV2)).toThrow(/新建参数无效/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects getters without evaluating them and accepts the stated bounds endpoints', () => {
    expect(() => createBlankDocumentV2({ ...options, get title(): string { throw new Error('must not evaluate') } })).toThrow(/访问器/)
    expect(createBlankDocumentV2({ ...options, widthMm: 1000, heightMm: 20000 }).exportBoundsMm.height).toBe(20000)
    expect(createBlankDocumentV2({ ...options, widthMm: 200000, heightMm: 200000 }).exportBoundsMm.width).toBe(200000)
  })
})

describe('C1a complete blank project and creation transaction', () => {
  it('loads only the 18 placeable images and roundtrips all bytes, licenses and a placed prop while offline', async () => {
    const project = await createBlankProjectV2(options)
    expect(fetch).toHaveBeenCalledTimes(18)
    expect(Object.keys(project.assets)).toHaveLength(18)
    expect(project.licenseBindings).toHaveLength(36); expect(Object.keys(project.licenses)).toHaveLength(1)
    expect(createImageBitmap).toHaveBeenCalledTimes(18)
    project.document = applyCommandsV2(project.document, [{ type: 'addProp', id: 'chair', floorId: 'blank-floor', definitionRef: { id: 'b2-p-03', version: 1 }, positionMm: { x: 7000, y: 5000 }, rotationDeg: 45 }])
    vi.mocked(fetch).mockImplementation(async () => { throw new Error('offline') })
    const restored = await importProjectV2(await exportProjectV2(project))
    expect(restored.document).toEqual(project.document)
    expect(restored.licenseBindings).toEqual(project.licenseBindings); expect(restored.licenses).toEqual(project.licenses)
    for (const [hash, asset] of Object.entries(project.assets)) expect(await restored.assets[hash].blob.arrayBuffer()).toEqual(await asset.blob.arrayBuffer())
    expect(fetch).toHaveBeenCalledTimes(18)
  })

  it('creates revision zero once, then places, moves, deletes and restores through workspace history with monotonic revisions and CAS', async () => {
    const project = await createBlankProjectV2(options)
    let stored: CompleteProjectV2 | null = null
    const save = vi.fn(async (next: CompleteProjectV2, expectedRevision: number | null) => {
      expect(stored?.document.revision ?? null).toBe(expectedRevision)
      stored = structuredClone(next)
    })
    const workspace = new WorkspaceV2({ save })
    await workspace.adoptNew(project)
    expect(workspace.getState()).toMatchObject({ status: 'saved', canUndo: false, canRedo: false })
    workspace.execute([{ type: 'addProp', id: 'chair', floorId: 'blank-floor', definitionRef: { id: 'b2-p-03', version: 1 }, positionMm: { x: 7000, y: 5000 } }])
    workspace.execute([{ type: 'updateProp', id: 'chair', changes: { positionMm: { x: 6500, y: 4500 }, rotationDeg: 90 } }])
    workspace.execute([{ type: 'deleteProp', id: 'chair' }])
    expect(workspace.getState().project!.document.revision).toBe(3)
    expect(workspace.getState().project!.document.props).toEqual({})
    workspace.undo(); expect(workspace.getState().project!.document.revision).toBe(4)
    expect(workspace.getState().project!.document.props.chair).toMatchObject({ positionMm: { x: 6500, y: 4500 }, rotationDeg: 90 })
    workspace.redo(); expect(workspace.getState().project!.document.revision).toBe(5)
    expect(workspace.getState().project!.document.props).toEqual({})
    workspace.undo(); await workspace.flush()
    expect(workspace.getState().project!.document.revision).toBe(6)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls.map(([, revision]) => revision)).toEqual([null, 0])
    expect(Object.keys(workspace.getState().project!.assets)).toEqual(Object.keys(project.assets))
    const restored = await importProjectV2(await exportProjectV2(workspace.getState().project!))
    expect(restored.document).toEqual(workspace.getState().project!.document)
  })

  it('fails closed on missing static resources, tampered bytes and actual decoder failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(createBlankProjectV2(options)).rejects.toThrow(/素材读取失败/)
    vi.mocked(fetch).mockImplementationOnce(async input => {
      const response = await staticFetch(input), bytes = new Uint8Array(await response.arrayBuffer()); bytes[0] ^= 1
      return new Response(bytes.buffer)
    })
    await expect(createBlankProjectV2(options)).rejects.toThrow(/实际格式不符/)
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decoder unavailable'))
    await expect(createBlankProjectV2(options)).rejects.toThrow(/解码/)
  })

  it('honors pre-cancel and cancellation during a resource read without returning a partial project', async () => {
    const before = new AbortController(); before.abort()
    await expect(createBlankProjectV2(options, before.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    const during = new AbortController()
    vi.mocked(fetch).mockImplementationOnce(async input => { const response = await staticFetch(input); during.abort(); return response })
    await expect(createBlankProjectV2(options, during.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1); expect(createImageBitmap).not.toHaveBeenCalled()
  })
})
