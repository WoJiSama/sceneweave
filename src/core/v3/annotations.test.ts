import { describe, expect, it } from 'vitest'
import { applyCommandsV3 } from './commands'
import { projectSceneV3 } from '../../render/v3/projection'
import { groupLayerSceneV3, layerSceneV3, scatterLayerSceneV3 } from './test-fixtures'
import type { SceneDocumentV3 } from './types'

const setup = () => {
  const scene = layerSceneV3(), floorId = Object.keys(scene.floors)[0], layerId = Object.keys(scene.userLayers)[0]
  return { scene, floorId, layerId }
}
describe('C2 注记、遮罩和范围事务', () => {
  it('成员所属容器锁保护附着注记的新增、修改与删除', () => {
    for (const scene of [groupLayerSceneV3(), scatterLayerSceneV3()]) {
      const group = [...Object.values(scene.prefabInstances), ...Object.values(scene.scatterGroups)][0]
      const propId = Object.values(group.members).find(member => member.propId !== null)!.propId!
      const command = { type: 'createNote' as const, id: 'member-clue', floorId: scene.props[propId].floorId, layerId: scene.entityLayers[propId],
        anchor: { type: 'entity' as const, entityKind: 'prop' as const, entityId: propId }, kind: 'clue' as const, text: '保留', visibility: 'gm' as const }
      const withNote = applyCommandsV3(scene, [command])
      const locked = applyCommandsV3(withNote, [{ type: 'setEditLock', kind: Object.hasOwn(scene.prefabInstances, group.id) ? 'prefabInstance' : 'scatterGroup', id: group.id, locked: true }])
      expect(() => applyCommandsV3(locked, [{ ...command, id: 'new-clue' }])).toThrow('锁定')
      expect(() => applyCommandsV3(locked, [{ type: 'updateNote', id: command.id, changes: { text: '修改' } }])).toThrow('锁定')
      expect(() => applyCommandsV3(locked, [{ type: 'deleteNote', id: command.id }])).toThrow('锁定')
      expect(locked.notes[command.id].text).toBe('保留')
    }
  })
  it('锁定建筑锚点保护附着注记删除，独立解除锚点锁后可删除', () => {
    const { scene, floorId, layerId } = setup()
    const withRoom = applyCommandsV3(scene, [{ type: 'createRoom', id: 'room', floorId, layerId, thicknessMm: 100,
      boundaryMm: [{ x: 6000, y: 6000 }, { x: 9000, y: 6000 }, { x: 9000, y: 9000 }, { x: 6000, y: 9000 }] },
      { type: 'createNote', id: 'note', floorId, layerId, anchor: { type: 'entity', entityKind: 'room', entityId: 'room' }, kind: 'note', text: '保留', visibility: 'gm' }])
    const locked = applyCommandsV3(withRoom, [{ type: 'setEditLock', kind: 'room', id: 'room', locked: true }])
    expect(() => applyCommandsV3(locked, [{ type: 'deleteNote', id: 'note' }])).toThrow('锁定')
    const unlocked = applyCommandsV3(locked, [{ type: 'setEditLock', kind: 'room', id: 'room', locked: false }])
    expect(applyCommandsV3(unlocked, [{ type: 'deleteNote', id: 'note' }]).notes).toEqual({})
  })
  it('秘密房间、固定遮罩与锚定注记通过同一批次，玩家先过滤再绘制', () => {
    const { scene, floorId, layerId } = setup()
    const next = applyCommandsV3(scene, [
      { type: 'createRoom', id: 'hidden', floorId, layerId, boundaryMm: [{ x: 6000, y: 6000 }, { x: 9000, y: 6000 }, { x: 9000, y: 9000 }, { x: 6000, y: 9000 }], thicknessMm: 100, visibility: 'gm' },
      { type: 'upsertManualMask', id: 'mask', floorId, layerId, boundsMm: { x: 5500, y: 5500, width: 4000, height: 4000 } },
      { type: 'createNote', id: 'clue', floorId, layerId, anchor: { type: 'entity', entityKind: 'room', entityId: 'hidden' }, kind: 'clue', text: 'secret text', visibility: 'gm' },
    ])
    expect(projectSceneV3(next, 'gm').notes.map(n => n.text)).toContain('secret text')
    const player = projectSceneV3(next, 'player')
    expect(player.rooms).toHaveLength(0); expect(player.notes).toHaveLength(0)
    expect(scene.rooms).toEqual({})
    const unmasked = applyCommandsV3(next, [{ type: 'deleteManualMask', id: 'mask' }])
    expect(() => projectSceneV3(unmasked, 'player')).toThrow('遮罩未覆盖')
  })
  it('单独公开描述保留其他秘密，循环、悬空锚点和引用删除全部拒绝', () => {
    const { scene, floorId, layerId } = setup()
    const next = applyCommandsV3(scene, [{ type: 'createNote', id: 'one', floorId, layerId, anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, kind: 'clue', text: 'warm cup', visibility: 'gm' },
      { type: 'createNote', id: 'two', floorId, layerId, anchor: { type: 'entity', entityKind: 'note', entityId: 'one' }, kind: 'note', text: 'private', visibility: 'gm' }])
    const published = applyCommandsV3(next, [{ type: 'updateNote', id: 'one', changes: { visibility: 'public' } }])
    expect(projectSceneV3(published, 'player').notes.map(note => note.text)).toEqual(['warm cup'])
    expect(published.notes.two).toEqual(next.notes.two)
    expect(() => applyCommandsV3(next, [{ type: 'updateNote', id: 'one', changes: { anchor: { type: 'entity', entityKind: 'note', entityId: 'two' } } }])).toThrow('循环')
    expect(() => applyCommandsV3(next, [{ type: 'deleteNote', id: 'one' }])).toThrow('引用')
    expect(() => applyCommandsV3(next, [{ type: 'updateNote', id: 'one', changes: { anchor: { type: 'entity', entityKind: 'wall', entityId: 'missing' } } }])).toThrow('锚点')
  })
  it('锚定注记锁和图层锁不因命令混合被绕过', () => {
    const { scene, floorId, layerId } = setup()
    const next = applyCommandsV3(scene, [{ type: 'createNote', id: 'one', floorId, layerId, anchor: { type: 'entity', entityKind: 'prop', entityId: 'item' }, kind: 'note', text: 'keep', visibility: 'public' }])
    const locked = applyCommandsV3(next, [{ type: 'setEditLock', kind: 'note', id: 'one', locked: true }])
    expect(() => applyCommandsV3(locked, [{ type: 'updateProp', id: 'item', changes: { positionMm: { x: 4500, y: 4000 } } }])).toThrow('锁定')
    expect(() => applyCommandsV3(locked, [{ type: 'updateNote', id: 'one', changes: { text: 'change' } }])).toThrow('锁定')
    expect(() => applyCommandsV3(locked, [{ type: 'setEditLock', kind: 'note', id: 'one', locked: false }, { type: 'updateNote', id: 'one', changes: { text: 'change' } }])).toThrow('分别独立')
    const layerLocked = applyCommandsV3(next, [{ type: 'setLayerLock', id: layerId, locked: true }])
    expect(() => applyCommandsV3(layerLocked, [{ type: 'setEditLock', kind: 'note', id: 'one', locked: true }])).toThrow('图层已锁定')
  })
  it('不截断世界范围中的实体；非法收缩与未知字段整笔拒绝', () => {
    const { scene, floorId } = setup(), old = structuredClone(scene)
    const next = applyCommandsV3(scene, [{ type: 'setCanvasBounds', floorId, floorBoundsMm: { x: -1500, y: -1500, width: 23000, height: 23000 }, exportBoundsMm: { x: -500, y: -500, width: 21000, height: 21000 } }])
    expect(next.props).toEqual(old.props); expect(next.exportBoundsMm.x).toBe(-500)
    expect(() => applyCommandsV3(scene, [{ type: 'setCanvasBounds', floorId, floorBoundsMm: { x: 0, y: 0, width: 1000, height: 1000 }, exportBoundsMm: scene.exportBoundsMm }])).toThrow('事务未采用')
    expect(scene).toEqual(old)
    expect(() => applyCommandsV3(scene, [{ type: 'upsertManualMask', id: 'mask', floorId, boundsMm: { x: 0, y: 0, width: 2000, height: 2000 }, bypass: true } as unknown as Parameters<typeof applyCommandsV3>[1][number]])).toThrow('指令无效')
  })
  it('固定遮罩不能被锁定后改写或借相同ID覆盖其他类型', () => {
    const { scene, floorId, layerId } = setup()
    let next: SceneDocumentV3 = applyCommandsV3(scene, [{ type: 'upsertManualMask', id: 'mask', floorId, layerId, boundsMm: { x: 1000, y: 1000, width: 2000, height: 2000 } }])
    next = applyCommandsV3(next, [{ type: 'setEditLock', kind: 'region', id: 'mask', locked: true }])
    expect(() => applyCommandsV3(next, [{ type: 'upsertManualMask', id: 'mask', floorId, boundsMm: { x: 1000, y: 1000, width: 3000, height: 2000 } }])).toThrow('锁定')
    expect(() => applyCommandsV3(next, [{ type: 'deleteManualMask', id: 'mask' }])).toThrow('锁定')
  })
})
