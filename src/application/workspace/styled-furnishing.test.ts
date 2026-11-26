import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { currentFurnishingPalette, furnishingPaletteMatches, furnishingPaletteSchema, furnishingStyle, type StyledRoomFurnishing } from '../../shared/furnishing/palette.js'
import { createCompositionContent } from '../../shared/appearance/graph.js'
import { ProjectRepository } from '../../platform/browser/storage/repository.js'
import { fixture, runtime, validation } from './test-fixtures.js'
import { fromBundle } from './project.js'
import { Workspace } from './workspace.js'

const options = { runtime, validation }
async function setup() {
  const input = fixture({ image: true, building: true }), doc = input.project.document
  doc.props.other.positionMm = { x: 18000, y: 18000 }
  Object.assign(input.project, createCompositionContent(doc, runtime))
  const repository = new ProjectRepository({ name: `styled-furnishing-${crypto.randomUUID()}`, ...options }), workspace = new Workspace(repository, options)
  await workspace.adoptNew(await fromBundle(input, validation))
  const layerId = doc.entityLayers.item
  await workspace.execute([{ type: 'createRoom', id: 'second-room', floorId: 'blank-floor', layerId, purpose: '事务间', thicknessMm: 200,
    boundaryMm: [{ x: 11000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 10000 }, { x: 11000, y: 10000 }] }])
  await workspace.flush()
  const rows: StyledRoomFurnishing[] = ['room', 'second-room'].map(roomId => ({ palette: currentFurnishingPalette(), request: {
    roomId, layerId, purpose: `布置${roomId}`, variation: 'styled-test', functions: [{ role: 'storage', count: 2, definitionRef: { id: 'definition', version: 1 } }], movableIds: [], restoreDeletedKeys: [],
  } }))
  const close = async () => { await workspace.close(); const name = repository.database.name; repository.close(); await Dexie.delete(name) }
  return { workspace, repository, rows, close }
}
describe('styled building furnishing', () => {
  it('uses explicit catalogue identities, exposes unknowns and rejects inconsistent source/style choices', () => {
    const definition = fixture({ image: true }).project.document.propDefinitions.definition
    const style = { source: 'collection' as const, era: 'fantasy' as const, styleId: 'elven', allowMixed: false }
    expect(furnishingStyle({ ...definition, tags: ['elven', '西幻', 'fantasy'] }).styleId).toBeNull()
    expect(furnishingPaletteMatches(definition, style)).toBe(false)
    expect(furnishingPaletteMatches({ ...definition, catalogId: 'prop.sceneweave.furniture-collection.bed-elven' }, style)).toBe(true)
    expect(furnishingPaletteMatches({ ...definition, catalogId: 'prop.sceneweave.furniture-collection.bed-elven', version: 2 }, style)).toBe(false)
    expect(furnishingPaletteSchema.safeParse({ ...style, era: '1920s' }).success).toBe(false)
    expect(furnishingPaletteSchema.safeParse({ ...style, source: 'inn' }).success).toBe(false)
  })
  it('reviews both rooms, retains cumulative work and adopts/undoes/saves the entire configuration once', async () => {
    const { workspace, repository, rows, close } = await setup()
    try {
      const before = workspace.getState().project!
      const singleWork: number[] = []
      for (const row of rows) {
        const single = await workspace.previewBuildingFurnishing(before, [row])
        singleWork.push(single.preview!.budgetUsage!.gridNodes); workspace.cancelPreview(single.preview!)
      }
      const cancelled = await workspace.previewBuildingFurnishing(before, rows)
      expect(cancelled.review.rooms).toHaveLength(2)
      expect(singleWork.reduce((sum, n) => sum + n, 0)).toBeGreaterThan(0)
      expect(cancelled.preview!.budgetUsage!.gridNodes).toBeGreaterThanOrEqual(singleWork.reduce((sum, n) => sum + n, 0))
      workspace.cancelPreview(cancelled.preview!)
      expect(workspace.getState().project).toBe(before)
      const ready = await workspace.previewBuildingFurnishing(before, rows)
      await workspace.adoptPreview(ready.preview!)
      const adopted = workspace.getState().project!
      expect(adopted.document.revision).toBe(before.document.revision + 1)
      expect(adopted.document.rooms.room.furnishingPlan).toBeDefined()
      expect(adopted.document.rooms['second-room'].furnishingPlan).toBeDefined()
      expect(Object.keys(adopted.document.props)).toHaveLength(Object.keys(before.document.props).length + 3)
      workspace.undo(); expect(workspace.getState().project!.document.props).toEqual(before.document.props)
      expect(workspace.getState().project!.document.rooms).toEqual(before.document.rooms)
      workspace.redo(); await workspace.flush()
      const cold = await repository.load(adopted.document.sceneId)
      expect(cold!.project.document.rooms).toEqual(adopted.document.rooms)
      expect(cold!.project.document.props).toEqual(adopted.document.props)
    } finally { await close() }
  })
  it('requires mixed-style confirmation, preserves the baseline on later-room failure/cancel, and refuses stale adoption', async () => {
    const { workspace, rows, close } = await setup()
    try {
      const before = workspace.getState().project!, style = { source: 'current' as const, era: 'fantasy' as const, styleId: 'elven', allowMixed: false }
      await expect(workspace.previewBuildingFurnishing(before, [{ ...rows[0], palette: style }])).rejects.toThrow(/跨风格/)
      const mixed = await workspace.previewBuildingFurnishing(before, [{ ...rows[0], palette: { ...style, allowMixed: true } }])
      expect(mixed.review.notes.join()).toContain('已明确允许'); workspace.cancelPreview(mixed.preview!)
      await expect(workspace.previewBuildingFurnishing(before, [rows[0], rows[0]])).rejects.toThrow()
      await expect(workspace.previewBuildingFurnishing(before, [rows[0], { ...rows[1], request: { ...rows[1].request, movableIds: ['item'] } }])).rejects.toThrow(/本房间/)
      expect(workspace.getState().project).toBe(before)
      const abort = new AbortController()
      await expect(workspace.previewBuildingFurnishing(before, rows, { signal: abort.signal, cooperate: async () => abort.abort() })).rejects.toThrow()
      expect(workspace.getState().project).toBe(before)
      const stale = await workspace.previewBuildingFurnishing(before, rows)
      await workspace.execute([{ type: 'updateProp', id: 'other', changes: { rotationDeg: 15 } }])
      await expect(workspace.adoptPreview(stale.preview!)).rejects.toThrow()
    } finally { await close() }
  })
  it('rechecks shared door approaches against the final combined scene and retains both rooms in one transaction', async () => {
    const { workspace, rows, close } = await setup()
    try {
      const layerId = rows[0].request.layerId
      await workspace.execute([{ type: 'deleteRoom', id: 'second-room' }, { type: 'createRoom', id: 'joined', floorId: 'blank-floor', layerId, purpose: '相邻房', thicknessMm: 200,
        boundaryMm: [{ x: 10000, y: 3000 }, { x: 17000, y: 3000 }, { x: 17000, y: 10000 }, { x: 10000, y: 10000 }] },
        { type: 'addOpening', id: 'shared-door', wallId: 'wall-1', offsetReferenceVertexId: 'vertex-1', offsetMm: 2500, widthMm: 1200, kind: 'door', state: 'open', layerId }])
      const before = workspace.getState().project!
      const combined = await workspace.previewBuildingFurnishing(before, [rows[0], { ...rows[1], request: { ...rows[1].request, roomId: 'joined' } }])
      expect(combined.review.rooms!.every(room => room.routes.total > 0)).toBe(true)
      expect(combined.preview!.budgetUsage!.fieldEvaluations).toBeGreaterThan(0)
      await workspace.adoptPreview(combined.preview!)
      expect(workspace.getState().project!.document.openings['shared-door']).toEqual(before.document.openings['shared-door'])
      workspace.undo(); expect(workspace.getState().project!.document.props).toEqual(before.document.props)
    } finally { await close() }
  }, 20000)
})
