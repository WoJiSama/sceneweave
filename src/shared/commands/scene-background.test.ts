import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { applyCompositionCommands } from '../appearance/commands.js'
import { toCurrentSceneDocument } from '../model/current-scene.js'
import { projectEditorScene, projectScene } from '../projection/projection.js'
import { projectionAssetConsumers } from '../projection/presentation-contract.js'
import { exportProject, importProject } from '../project/file.js'
import { validateSceneDocument } from '../validation/scene.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { applyCommands, applySnapshotCommands, type SceneCommand } from './commands.js'
import { fixture, runtime, validation } from '../../application/workspace/test-fixtures.js'
import { fromBundle } from '../../application/workspace/project.js'
import { Workspace } from '../../application/workspace/workspace.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import type { SceneBackgroundCommand } from './scene-background.js'

const transparent: SceneBackgroundCommand = { type: 'setSceneBackground', background: { mode: 'transparent' } }
const solid: SceneBackgroundCommand = { type: 'setSceneBackground', background: { mode: 'solid', color: '#A1b2C3' } }

describe('current complete-v1 output background', () => {
  it('strictly accepts default, solid RGB and transparent while rejecting alpha, arbitrary CSS and unknown fields', () => {
    const scene = fixture().project.document
    expect(validateSceneDocument(scene).ok).toBe(true)
    for (const background of [transparent.background, solid.background]) {
      expect(validateSceneDocument({ ...scene, outputBackground: background }).ok).toBe(true)
      expect(toCurrentSceneDocument({ ...scene, outputBackground: background! }).outputBackground).toEqual(background)
    }
    for (const background of [null, {}, { mode: 'unknown' }, { mode: 'transparent', color: '#FFFFFF' }, { mode: 'solid' },
      { mode: 'solid', color: '#fff' }, { mode: 'solid', color: '#FFFFFF00' }, { mode: 'solid', color: 'transparent' },
      { mode: 'solid', color: 'url(secret)' }, { mode: 'solid', color: '#GG0011' }, { mode: 'solid', color: '#112233', visibility: 'gm' }]) {
      expect(validateSceneDocument({ ...scene, outputBackground: background }).ok, JSON.stringify(background)).toBe(false)
    }
  })

  it('changes only output paint and preserves fixed sources, physical geometry, locks and complete identities', () => {
    const source = fixture({ image: true }).project
    source.document.props.item.editLocked = true
    source.document.userLayers[source.document.entityLayers.item].editLocked = true
    const before = structuredClone(source)
    for (const command of [solid, transparent, { type: 'setSceneBackground' as const, background: null }]) {
      const changed = applyCompositionCommands({ document: source.document, historyIdentity: source.historyIdentity, appearance: source.appearance }, [command], runtime)
      expect(changed.document).toEqual(command.background ? { ...source.document, outputBackground: command.background } : source.document)
      expect(changed.historyIdentity).toEqual(source.historyIdentity)
      expect(changed.appearance).toEqual(source.appearance)
    }
    const painted = applyCommands(source.document, [solid], runtime)
    const reset = applyCommands(painted, [{ type: 'setSceneBackground', background: null }], runtime)
    expect(Object.hasOwn(reset, 'outputBackground')).toBe(false)
    expect(reset).toEqual(source.document)
    expect(source).toEqual(before)
  })

  it('keeps no-op snapshot identity and rejects invalid, over-budget or content-mixed commands atomically', () => {
    const original = fixture().project.document, changed = applyCommands(original, [transparent], runtime)
    const checked = validateSceneSnapshot(changed)
    if (!checked.ok) throw new Error(JSON.stringify(checked.errors))
    expect(applySnapshotCommands(checked.document, [transparent], runtime)).toBe(checked.document)
    for (const command of [
      { type: 'setSceneBackground' }, { ...solid, color: '#FFFFFF' },
      { ...solid, background: { mode: 'solid', color: '#00000080' } },
      { ...transparent, background: { mode: 'transparent', opacity: 0 } },
    ]) expect(() => applyCommands(original, [command as SceneCommand], runtime)).toThrow('编辑指令无效')
    expect(() => applyCommands(original, [solid, { type: 'updateProp', id: 'item', changes: { rotationDeg: 45 } }], runtime)).toThrow('分别独立提交')
    expect(() => applyCommands(original, Array.from({ length: 257 }, () => transparent), runtime)).toThrow('256')
    expect(Object.hasOwn(original, 'outputBackground')).toBe(false)
  })

  it('projects copied background for both audiences and editor without changing masks or the resource closure', () => {
    const original = fixture().project.document
    const floorId = Object.keys(original.floors)[0], layerId = Object.keys(original.userLayers)[0]
    original.regions.mask = { id: 'mask', floorId, editLocked: false, kind: 'manualMask', visibility: 'gm',
      boundaryMm: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }], blocksMovement: false, movementCostMultiplier: 1 }
    original.entityLayers.mask = layerId
    for (const audience of ['gm', 'player'] as const) {
      const baseline = projectScene(original, audience)
      const input = structuredClone(original); input.outputBackground = { mode: 'transparent' }
      const projection = projectScene(input, audience), editor = projectEditorScene(input, {})
      expect(projection).toEqual({ ...baseline, outputBackground: { mode: 'transparent' } })
      expect(editor.outputBackground).toEqual({ mode: 'transparent' })
      expect(projection.outputBackground).not.toBe(input.outputBackground)
      expect(projectionAssetConsumers(projection).complete).toBe(true)
      expect(projection.masks).toEqual(baseline.masks)
      input.outputBackground = { mode: 'solid', color: '#FFFFFF' }
      expect(projection.outputBackground).toEqual({ mode: 'transparent' })
    }
  })

  it('preserves real resources through preview, cancel, stale refusal, adoption, undo/redo, cold read and file round-trip', async () => {
    const name = `output-background-${crypto.randomUUID()}`
    const repo = new ProjectRepository({ name, runtime, validation }), workspace = new Workspace(repo, { runtime, validation })
    try {
      const project = await fromBundle(fixture({ image: true }), validation)
      await workspace.adoptNew(project)
      const original = workspace.getState().project!, checkpoint = workspace.checkpoint()
      const cancelled = await workspace.preview([transparent]); workspace.cancelPreview(cancelled)
      await expect(workspace.adoptPreview(cancelled)).rejects.toThrow('不可重复采用')
      expect(workspace.getState().project).toBe(original); expect(workspace.checkpoint()).toBe(checkpoint)
      const stale = await workspace.preview([transparent])
      await workspace.execute([{ type: 'renameScene', title: '范围外编辑' }])
      await expect(workspace.adoptPreview(stale)).rejects.toThrow('准备期间场景已有修改')
      const preview = await workspace.preview([solid]); await workspace.adoptPreview(preview)
      const changed = workspace.getState().project!
      expect(changed.document.outputBackground).toEqual(solid.background)
      expect(changed.assets).toEqual(original.assets); expect(changed.historyIdentity).toEqual(original.historyIdentity)
      expect(changed.appearance).toEqual(original.appearance); expect(changed.licenses).toEqual(original.licenses)
      const checkpointAfter = workspace.checkpoint(); await workspace.execute([solid])
      expect(workspace.checkpoint()).toBe(checkpointAfter)
      workspace.undo()
      expect(workspace.getDocument()!.outputBackground).toBeUndefined()
      expect(workspace.getDocument()!.title).toBe('范围外编辑')
      workspace.redo(); await workspace.flush()
      const cold = (await repo.load(changed.document.sceneId))!
      expect(cold.project.document.outputBackground).toEqual(solid.background)
      expect(cold.project.document.revision).toBeGreaterThan(changed.document.revision)
      const reopened = await importProject(await exportProject(cold, validation), validation)
      expect(reopened.project).toEqual(cold.project)
      for (const hash of Object.keys(cold.project.assets)) expect(await reopened.resources.read(hash)).toEqual(await cold.resources.read(hash))
      await workspace.execute([transparent]); await workspace.flush()
      expect((await repo.load(changed.document.sceneId))!.project.document.outputBackground).toEqual(transparent.background)
      await workspace.execute([{ type: 'setSceneBackground', background: null }]); await workspace.flush()
      expect((await repo.load(changed.document.sceneId))!.project.document.outputBackground).toBeUndefined()
    } finally { await workspace.close(); repo.close(); await Dexie.delete(name) }
  }, 20000)
})
