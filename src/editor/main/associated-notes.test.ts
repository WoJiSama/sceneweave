import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fixture } from '../../application/workspace/test-fixtures'
import type { Note } from '../../shared/model/scene'
import AssociatedNotes from './AssociatedNotes'
import { associatedNotes, noteAnchorRoot } from './associated-notes'

function sceneWithNotes() {
  const scene = fixture({ building: true }).project.document
  const note = (id: string, anchor: Note['anchor'], text = id): Note => ({ id, floorId: 'blank-floor', editLocked: false, anchor, kind: 'clue', title: id, text, visibility: 'gm' })
  scene.notes = {
    child: note('child', { type: 'entity', entityKind: 'note', entityId: 'parent' }),
    parent: note('parent', { type: 'entity', entityKind: 'room', entityId: 'room' }),
    sibling: note('sibling', { type: 'entity', entityKind: 'room', entityId: 'room' }),
    nearby: note('nearby', { type: 'point', positionMm: { x: 6500, y: 6500 } }),
    prop: note('prop', { type: 'entity', entityKind: 'prop', entityId: 'item' }),
  }
  return scene
}

describe('associated note reader', () => {
  it('finds recursive notes without treating nearby points or room contents as attached notes', () => {
    const scene = sceneWithNotes(), before = structuredClone(scene)
    expect(associatedNotes(scene, 'room').map(note => note.id)).toEqual(['parent', 'sibling', 'child'])
    expect(associatedNotes(scene, 'parent').map(note => note.id)).toEqual(['parent', 'child'])
    expect(associatedNotes(scene, 'item').map(note => note.id)).toEqual(['prop'])
    expect(associatedNotes(scene, 'missing')).toEqual([])
    expect(scene).toEqual(before)
  })

  it('resolves an adopted door through a recursive anchor and terminates on invalid cycles', () => {
    const scene = sceneWithNotes()
    scene.notes.parent.anchor = { type: 'entity', entityKind: 'opening', entityId: 'door' }
    expect(noteAnchorRoot(scene, 'child')).toBe('door')
    expect(noteAnchorRoot(scene, 'nearby')).toBeNull()
    scene.notes.parent.anchor = { type: 'entity', entityKind: 'note', entityId: 'child' }
    expect(noteAnchorRoot(scene, 'child')).toBeNull()
    expect(associatedNotes(scene, 'child').map(note => note.id)).toEqual(['child', 'parent'])
  })

  it('renders full plain text under locks, escapes markup and does not offer editing controls', () => {
    const scene = sceneWithNotes()
    scene.rooms.room.editLocked = true
    scene.notes.parent.editLocked = true
    scene.notes.parent.title = '<img src=x onerror=alert(1)>'
    scene.notes.parent.text = '第一段\n\n<script>alert("secret")</script>\n最后一行'
    const before = structuredClone(scene), html = renderToStaticMarkup(createElement(AssociatedNotes, { scene, selectedId: 'room', onSelect: () => { throw Error('Read must not navigate') } }))
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('第一段\n\n&lt;script&gt;alert(&quot;secret&quot;)&lt;/script&gt;\n最后一行')
    expect(html).toContain('可见性设置：仅主持人')
    expect(html).not.toMatch(/<(textarea|input|select|script|img)\b/)
    expect(scene).toEqual(before)
  })

  it('keeps the static note title while refreshing actual door state from adopted content', () => {
    const scene = sceneWithNotes()
    scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: true, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 2000, widthMm: 900, kind: 'door', state: 'closed', locked: true, secret: true, revealed: false }
    scene.notes.parent.anchor = { type: 'entity', entityKind: 'opening', entityId: 'door' }
    scene.notes.parent.title = '已锁的旧门'
    const render = () => renderToStaticMarkup(createElement(AssociatedNotes, { scene, selectedId: 'child', onSelect: () => {} }))
    expect(render()).toContain('关闭 · 已锁 · 秘密门（未揭示）')
    const changed = structuredClone(scene)
    Object.assign(changed.openings.door, { state: 'open', locked: false, revealed: true })
    const html = renderToStaticMarkup(createElement(AssociatedNotes, { scene: changed, selectedId: 'door', onSelect: () => {} }))
    expect(html).toContain('已锁的旧门')
    expect(html).toContain('开启 · 未锁 · 秘密门（已揭示）')
    expect(scene.openings.door.state).toBe('closed')
  })
})
