import { describe, expect, it } from 'vitest'
import { createBenchmarkScene, createHouse } from '../core/seed'
import type { Note } from '../core/types'
import { projectScene } from './projection'
import type { Audience } from './projection'

function publicNote(id: string, anchor: Note['anchor'], text = '公开文字'): Note {
  return { id, floorId: 'f-a1', editLocked: false, kind: 'label', visibility: 'public', text, anchor }
}

describe('audience projection', () => {
  it('drops private geometry, secret opening records and GM text before rendering', () => {
    const scene = createHouse('scene-test')
    const player = projectScene(scene, 'player')
    expect(player.rooms).toHaveLength(2)
    expect(player.props).toHaveLength(7)
    expect(player.notes.map(note => note.text)).toEqual(['会客厅', '书房'])
    expect(player.walls.flatMap(wall => wall.openings).map(opening => opening.id)).toEqual(expect.arrayContaining(['o-a1', 'o-b2']))
    const encoded = JSON.stringify(player)
    for (const privateValue of ['r-c3', 'p-h8', 'o-c3', 'n-c3', 'n-d4', 'g-a1', '未寄出的信', '净宽', '旧账册', '秘密通路']) expect(encoded).not.toContain(privateValue)
    expect(projectScene(scene, 'gm').notes.some(note => note.text.includes('旧账册'))).toBe(true)
    expect(player.masks).toEqual([scene.regions['g-a1'].boundaryMm])
    expect(player.bounds).toEqual(scene.exportBoundsMm)
  })

  it('reconstructs an unrevealed secret door as an ordinary uninterrupted wall', () => {
    const scene = createHouse()
    const player = projectScene(scene, 'player')
    const northernWall = player.walls.find(wall => wall.start.y === 4000 && wall.end.y === 4000)
    expect(northernWall?.start).toEqual({ x: 2000, y: 4000 })
    expect(northernWall?.end).toEqual({ x: 14000, y: 4000 })
    expect(northernWall?.openings).toEqual([])
    scene.openings['o-c3'].revealed = true
    expect(projectScene(scene, 'player').walls.flatMap(wall => wall.openings).find(opening => opening.id === 'o-c3')?.secret).toBe(false)
    expect(projectScene(scene, 'player').rooms).toHaveLength(2)
  })

  it('filters public notes attached to private targets and masked points', () => {
    const scene = createHouse()
    const anchors: Note['anchor'][] = [
      { type: 'entity', entityKind: 'room', entityId: 'r-c3' },
      { type: 'entity', entityKind: 'prop', entityId: 'p-h8' },
      { type: 'entity', entityKind: 'opening', entityId: 'o-c3' },
      { type: 'entity', entityKind: 'wall', entityId: 'w-7a' },
      { type: 'entity', entityKind: 'region', entityId: 'g-a1' },
      { type: 'entity', entityKind: 'note', entityId: 'n-d4' },
      { type: 'point', positionMm: { x: 16000, y: 1000 } },
    ]
    anchors.forEach((anchor, index) => { scene.notes[`unsafe-${index}`] = publicNote(`unsafe-${index}`, anchor, `不应发布 ${index}`) })
    scene.notes.safe = publicNote('safe', { type: 'point', positionMm: { x: 15000, y: 9000 } })
    expect(projectScene(scene, 'player').notes.map(note => note.id)).toEqual(['n-a1', 'n-b2', 'safe'])
    expect(projectScene(scene, 'gm').diagnostics.length).toBeGreaterThan(0)
  })

  it('treats discovered and unspecified-visibility notes as private', () => {
    const scene = createHouse()
    scene.notes['n-d4'].discovered = true
    const defaultPrivate = publicNote('default-private', { type: 'point', positionMm: { x: 16000, y: 9000 } })
    delete (defaultPrivate as Partial<Note>).visibility
    scene.notes['default-private'] = defaultPrivate
    expect(projectScene(scene, 'player').notes.map(note => note.id)).toEqual(['n-a1', 'n-b2'])
  })

  it('breaks cyclic note anchors without leaking hidden anchors', () => {
    const scene = createHouse()
    scene.notes.loop1 = publicNote('loop1', { type: 'entity', entityKind: 'note', entityId: 'loop2' })
    scene.notes.loop2 = publicNote('loop2', { type: 'entity', entityKind: 'note', entityId: 'loop1' })
    expect(projectScene(scene, 'player').notes.map(note => note.id)).toEqual(['n-a1', 'n-b2'])
  })

  it('produces identical player models when only secrets change', () => {
    const original = createHouse('paired')
    const changed = structuredClone(original)
    changed.vertices['v-g7'].yMm = 1900
    changed.vertices['v-h8'].yMm = 1900
    changed.rooms['r-c3'].purpose = '完全不同的密室用途'
    changed.openings['o-c3'].offsetMm = 2000
    changed.openings['o-c3'].widthMm = 1500
    changed.props['p-h8'].positionMm = { x: 8800, y: 3000 }
    changed.notes['n-c3'].text = '另外一条秘密'
    changed.notes['n-d4'].text = '另一个答案'
    expect(projectScene(changed, 'player')).toEqual(projectScene(original, 'player'))
    expect(projectScene(changed, 'gm')).not.toEqual(projectScene(original, 'gm'))
  })

  it('ignores private wall splits and vertex IDs on a public boundary', () => {
    const original = createHouse('paired')
    const changed = structuredClone(original)
    changed.vertices['hidden-driven-id'] = { id: 'hidden-driven-id', floorId: 'f-a1', xMm: 5000, yMm: 4000, editLocked: false }
    changed.rooms['r-a1'].boundaryVertexIds.splice(1, 0, 'hidden-driven-id')
    changed.rooms['r-c3'].boundaryVertexIds.splice(4, 0, 'hidden-driven-id')
    changed.walls['w-0a'].endVertexId = 'hidden-driven-id'
    changed.walls['another-hidden-driven-id'] = { ...changed.walls['w-0a'], id: 'another-hidden-driven-id', startVertexId: 'hidden-driven-id', endVertexId: 'v-b2' }
    expect(projectScene(changed, 'player')).toEqual(projectScene(original, 'player'))
  })

  it('refuses player output without a sufficient conservative fixed mask', () => {
    const scene = createHouse()
    scene.regions = {}
    expect(() => projectScene(scene, 'player')).toThrow('遮罩未覆盖')
    expect(() => projectScene(scene, 'gm')).not.toThrow()
    const partial = createHouse()
    partial.regions['g-a1'].boundaryMm[1].x = 9000
    partial.regions['g-a1'].boundaryMm[2].x = 9000
    expect(() => projectScene(partial, 'player')).toThrow('遮罩未覆盖')
  })

  it('refuses a precise nonrectangular mask and accepts a safe union of rectangles', () => {
    const precise = createHouse()
    precise.regions['g-a1'].boundaryMm = [{ x: 2000, y: 2700 }, { x: 14000, y: 2700 }, { x: 14000, y: 4000 }, { x: 8000, y: 3500 }, { x: 2000, y: 4000 }]
    expect(() => projectScene(precise, 'player')).toThrow('整块轴对齐矩形')
    const union = createHouse()
    union.regions['g-a1'].boundaryMm = [{ x: -500, y: -500 }, { x: 8000, y: -500 }, { x: 8000, y: 4000 }, { x: -500, y: 4000 }]
    union.regions['mask-2'] = { ...union.regions['g-a1'], id: 'mask-2', boundaryMm: [{ x: 8000, y: -500 }, { x: 18500, y: -500 }, { x: 18500, y: 4000 }, { x: 8000, y: 4000 }] }
    expect(() => projectScene(union, 'player')).not.toThrow()
  })

  it('does not mutate or retain mutable source objects', () => {
    const scene = createHouse()
    const original = structuredClone(scene)
    const projection = projectScene(scene, 'player')
    projection.props[0].positionMm.x = -123
    projection.rooms[0].points[0].x = -456
    projection.masks[0][0].y = -789
    expect(scene).toEqual(original)
  })

  it('supports the open-space workload without inventing private walls', () => {
    const benchmark = createBenchmarkScene(500)
    const projection = projectScene(benchmark, 'player')
    expect(projection.props).toHaveLength(500)
    expect(projection.walls).toEqual([])
    expect(projection.masks).toEqual([])
  })

  it('retains public independent walls and their notes in open-space scenes', () => {
    const scene = createBenchmarkScene(500)
    scene.vertices.a = { id: 'a', floorId: 'f-a1', editLocked: false, xMm: 1000, yMm: 5000 }
    scene.vertices.b = { ...scene.vertices.a, id: 'b', xMm: 8000 }
    scene.walls.fence = { id: 'fence', floorId: 'f-a1', editLocked: false, startVertexId: 'a', endVertexId: 'b', thicknessMm: 100, blocksMovement: true, blocksSight: true }
    scene.notes.fence = publicNote('fence-label', { type: 'entity', entityKind: 'wall', entityId: 'fence' }, '庭院围栏')
    const projection = projectScene(scene, 'player')
    expect(projection.walls).toHaveLength(1)
    expect(projection.walls[0].start).toEqual({ x: 1000, y: 5000 })
    expect(projection.walls[0].end).toEqual({ x: 8000, y: 5000 })
    expect(projection.notes.map(note => note.text)).toEqual(['庭院围栏'])
    expect(projectScene(createHouse(), 'player').walls.some(wall => wall.start.y === 2700)).toBe(false)
  })

  it('discards a fully masked independent wall and any public note anchored to it', () => {
    const scene = createHouse()
    scene.vertices.maskA = { id: 'maskA', floorId: 'f-a1', editLocked: false, xMm: 3000, yMm: 1500 }
    scene.vertices.maskB = { ...scene.vertices.maskA, id: 'maskB', xMm: 9000 }
    scene.walls.maskedFence = { id: 'maskedFence', floorId: 'f-a1', editLocked: false, startVertexId: 'maskA', endVertexId: 'maskB', thicknessMm: 100, blocksMovement: true, blocksSight: true }
    scene.notes.maskedFence = publicNote('maskedFence', { type: 'entity', entityKind: 'wall', entityId: 'maskedFence' }, 'masked-fence-note')
    const encoded = JSON.stringify(projectScene(scene, 'player'))
    expect(encoded).not.toContain('maskedFence')
    expect(encoded).not.toContain('masked-fence-note')
    expect(projectScene(scene, 'player').walls).toEqual(projectScene(createHouse(), 'player').walls)
  })

  it('offsets clue badges from furniture and checks the drawn point against masks', () => {
    const scene = createHouse()
    expect(projectScene(scene, 'gm').notes.find(note => note.id === 'n-d4')?.positionMm).toEqual({ x: 10900, y: 4300 })
    scene.notes.maskedClue = { ...publicNote('maskedClue', { type: 'point', positionMm: { x: 16000, y: 4200 } }), kind: 'clue' }
    expect(projectScene(scene, 'player').notes.some(note => note.id === 'maskedClue')).toBe(false)
  })

  it('rejects unsupported floors and invalid fixed export bounds', () => {
    const scene = createHouse()
    scene.floors.extra = { ...scene.floors['f-a1'], id: 'extra' }
    expect(() => projectScene(scene, 'player')).toThrow('单楼层')
    const bad = createHouse()
    bad.exportBoundsMm.width = 0
    expect(() => projectScene(bad, 'gm')).toThrow('固定矩形')
    expect(() => projectScene(createHouse(), 'unknown' as Audience)).toThrow('明确选择')
  })
})
