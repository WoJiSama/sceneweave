import { expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures'
import { historyPreviewError } from './history-preview-error'

it('names the real object and layer lock sources and preserves the scene', () => {
  const scene = fixture().project.document, layerId = scene.entityLayers.item
  scene.props.item.editLocked = true; scene.userLayers[layerId].editLocked = true
  scene.userLayers[layerId].name = '家具层'
  const before = structuredClone(scene), error = new Error('当前恢复对象、父组合或图层已锁定：item。')
  const mapped = historyPreviewError(error, scene) as Error
  expect(mapped.message).toContain('对象「')
  expect(mapped.message).toContain('图层「家具层」')
  expect(mapped.message).toContain('解除相应编辑锁，再重新预览')
  expect(mapped.message).not.toContain('item')
  expect(mapped.cause).toBe(error)
  expect(scene).toEqual(before)
})

it('reports a support lock in its actual layer and a direct layer lock', () => {
  const scene = fixture({ building: true }).project.document
  const layerId = scene.entityLayers.room
  scene.userLayers[layerId].editLocked = true; scene.userLayers[layerId].name = '建筑层'
  expect((historyPreviewError(new Error('恢复物件的支撑依赖或图层已锁定：room。'), scene) as Error).message).toContain('图层「建筑层」')
  expect((historyPreviewError(new Error(`恢复目标图层已锁定：${layerId}。`), scene) as Error).message).toContain('图层「建筑层」')
})

it('keeps aborts and unrelated storage, continuity and dependency errors unchanged', () => {
  const scene = fixture().project.document
  for (const error of [new DOMException('取消', 'AbortError'), new Error('源快照已变化，请重新检查。'), new Error('恢复对象 item 有路径检查依赖。'), 'unknown']) {
    expect(historyPreviewError(error, scene)).toBe(error)
  }
})
