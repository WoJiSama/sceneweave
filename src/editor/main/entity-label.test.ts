import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Room, SceneDocument } from '../../shared/model/scene'
import type { EditableProject } from '../../application/workspace/project'
import builtin from '../../platform/browser/content/builtin-data.json'
import { createEntityLabeler, entityLabel } from './entity-label'
import CompositionChangesPanel from './CompositionChangesPanel'

function fixture(): SceneDocument {
  const scene = structuredClone(builtin.project.document) as unknown as SceneDocument
  const floorId = Object.keys(scene.floors)[0]
  const room = (id: string, purpose: string, boundaryVertexIds: string[]): Room => ({ id, purpose, boundaryVertexIds, floorId, editLocked: false, visibility: 'public', accessExpectation: 'unspecified', supportRef: { kind: 'floor', id: floorId }, groundElevationMm: 0, floorStyle: null })
  scene.rooms = { kitchen: room('kitchen', '厨房', ['a', 'b', 'c', 'd']), hall: room('hall', '大厅', ['b', 'e', 'f', 'c']) }
  scene.vertices = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => [id, { id, floorId, editLocked: false, xMm: index * 1000, yMm: 0 }]))
  scene.walls = { shared: { id: 'shared', floorId, editLocked: false, startVertexId: 'b', endVertexId: 'c', thicknessMm: 100, blocksMovement: true, blocksSight: true, topStyle: null } }
  scene.openings = { door: { id: 'door', floorId, editLocked: false, wallId: 'shared', offsetReferenceVertexId: 'b', offsetMm: 200, widthMm: 900, kind: 'door', state: 'closed', locked: false, secret: false, revealed: false } }
  return scene
}

describe('readable scene entity labels', () => {
  it('names a shared wall and its door through the actual adjacent rooms', () => {
    const scene = fixture(), before = structuredClone(scene), name = createEntityLabeler(scene)
    expect(name('kitchen')).toBe('厨房')
    expect(name('shared')).toBe('厨房 / 大厅 · 共享墙 2')
    expect(name('door')).toBe('厨房 / 大厅 · 共享墙 2 · 门 1')
    expect(name('b')).toBe('厨房 / 大厅 · 顶点 2')
    expect(scene).toEqual(before)
  })

  it('uses actual material and elevation for a terrain surface and its contour', () => {
    const scene = fixture(), material = Object.values(scene.materials)[0], floorId = Object.keys(scene.floors)[0]
    scene.terrainAreas = { terrace: { id: 'terrace', floorId, editLocked: false, visibility: 'public', boundaryMm: [{ id: 'corner', segmentId: 'edge', positionMm: { x: 0, y: 0 } }], groundElevationMm: 2500, coveragePriority: 0, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1, surfaceStyle: { base: { materialRef: { id: material.id, version: material.version }, tileSizeMm: { width: 1000, height: 1000 }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] } } }
    const name = createEntityLabeler(scene)
    expect(name('terrace')).toBe(`${material.name} · 高程 2.5 m`)
    expect(name('corner')).toBe(`${material.name} · 高程 2.5 m · 轮廓点 1`)
  })

  it('keeps unknown IDs as fallback and reflects renamed rooms without a stale global cache', () => {
    const scene = fixture()
    expect(entityLabel(scene, 'missing-reference')).toBe('missing-reference')
    expect(entityLabel(scene, 'kitchen')).toBe('厨房')
    scene.rooms.kitchen.purpose = '餐厅'
    expect(entityLabel(scene, 'kitchen')).toBe('餐厅')
    expect(entityLabel(scene, 'shared')).toContain('餐厅 / 大厅')
  })

  it('shows readable candidate changes and keeps newly public content warning outside folded details', () => {
    const before = fixture(), after = structuredClone(before)
    after.notes['new-clue-id'] = { id: 'new-clue-id', floorId: Object.keys(after.floors)[0], editLocked: false, anchor: { type: 'point', positionMm: { x: 1000, y: 1000 } }, kind: 'clue', title: '桌边线索', text: '一封未寄出的信', visibility: 'public' }
    const current = { ...builtin.project, document: before } as unknown as EditableProject
    const candidate = { ...builtin.project, document: after } as unknown as EditableProject
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, { current, candidate, commands: [] }))
    expect(html).toContain('新增注记「桌边线索」')
    expect(html).toContain('对象 ID：new-clue-id')
    expect(html.indexOf('将新增公开内容')).toBeLessThan(html.indexOf('<details'))
    expect(html).toContain('<summary>字段与 ID 详情</summary>')
    expect(before.notes['new-clue-id']).toBeUndefined()
  })

  it('includes layer-only moves once per object and names both actual layers', () => {
    const before = fixture(), after = structuredClone(before), floorId = Object.keys(before.floors)[0]
    before.userLayers = { old: { id: 'old', floorId, name: '原图层', order: 0, editLocked: false }, next: { id: 'next', floorId, name: '新图层', order: 1, editLocked: false } }
    after.userLayers = structuredClone(before.userLayers)
    before.entityLayers.kitchen = 'old'; after.entityLayers.kitchen = 'next'
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, {
      current: { ...builtin.project, document: before } as unknown as EditableProject,
      candidate: { ...builtin.project, document: after } as unknown as EditableProject, commands: [],
    }))
    expect(html).toContain('更新1间房间')
    expect(html).toContain('核对实际变化 · 1 个场景对象')
    expect(html).toContain('图层：原图层 → 新图层')
    expect(html).toContain('修改：所属图层')
    expect(before.entityLayers.kitchen).toBe('old')
  })

  it('lists layer organization changes separately from scene objects', () => {
    const before = fixture(), after = structuredClone(before), floorId = Object.keys(before.floors)[0]
    before.userLayers = { old: { id: 'old', floorId, name: '原图层', order: 0, editLocked: false } }
    after.userLayers = { old: { id: 'old', floorId, name: '家具图层', order: 1, editLocked: true }, next: { id: 'next', floorId, name: '线索图层', order: 0, editLocked: false } }
    const html = renderToStaticMarkup(createElement(CompositionChangesPanel, {
      current: { ...builtin.project, document: before } as unknown as EditableProject,
      candidate: { ...builtin.project, document: after } as unknown as EditableProject, commands: [],
    }))
    expect(html).toContain('调整2个图层')
    expect(html).toContain('核对实际变化 · 0 个场景对象 · 2 个图层')
    expect(html).toContain('更新图层 · 家具图层')
    expect(html).toContain('新增图层 · 线索图层')
    expect(html).toContain('名称、图层顺序、编辑锁')
  })

})
