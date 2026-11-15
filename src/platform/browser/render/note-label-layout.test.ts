import { expect, test } from 'vitest'
import { NOTE_LABEL_ROW_MM, noteLabelPositions } from './note-label-layout'
import type { ProjectedNote } from '../../../shared/projection/types.js'

const note = (id: string, visibility: 'gm' | 'public', x = 4000, y = 5000): ProjectedNote =>
  ({ id, visibility, positionMm: { x, y }, text: id, kind: 'note' })

test('same-anchor names and GM detail occupy separate fixed rows, with no input mutation', () => {
  const notes = [note('a-secret', 'gm'), note('z-name', 'public'), note('b-secret', 'gm')]
  const original = structuredClone(notes)
  const positions = noteLabelPositions(notes)
  expect(positions.get('z-name')).toEqual({ x: 4000, y: 5000 })
  expect(positions.get('a-secret')).toEqual({ x: 4000, y: 5280 })
  expect(positions.get('b-secret')).toEqual({ x: 4000, y: 5560 })
  expect(NOTE_LABEL_ROW_MM).toBeGreaterThan(220)
  expect(notes).toEqual(original)
  expect([...noteLabelPositions([...notes].reverse())]).toEqual([...positions])
})

test('independent anchors keep the exact old center, even one millimeter apart', () => {
  const notes = [note('a', 'public'), note('b', 'gm', 4001), note('c', 'gm', 4000, 5001)]
  const positions = noteLabelPositions(notes)
  for (const value of notes) expect(positions.get(value.id)).toEqual(value.positionMm)
  positions.get('a')!.x = 0
  expect(notes[0].positionMm.x).toBe(4000)
  expect(noteLabelPositions([]).size).toBe(0)
})

test('only projected notes affect placement; private changes cannot reposition public output', () => {
  const publicNotes = [note('b-name', 'public'), note('a-name', 'public')]
  const base = [...noteLabelPositions(publicNotes)]
  const withPrivate = [...publicNotes, note('0-secret', 'gm')]
  withPrivate[2].text = 'changed private text'
  expect([...noteLabelPositions(withPrivate.filter(row => row.visibility === 'public'))]).toEqual(base)
  const gm = noteLabelPositions(withPrivate)
  for (const row of publicNotes) expect(gm.get(row.id)).toEqual(new Map(base).get(row.id))
})
