import { describe, expect, it } from 'vitest'
import { THEMED_ROOM_PRESETS, createThemedRoomDocument } from './themed-rooms.js'
import { canonicalJson } from '../../../shared/validation/json.js'
import { polygonInside, propFootprint, roomPoints } from '../../../shared/geometry/geometry.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'

describe('coordinated real-scale purpose room examples', () => {
  it.each(THEMED_ROOM_PRESETS)('$id uses actual dimensions and the current solver without scaling fixed furniture', preset => {
    const result = createThemedRoomDocument(preset.id), { document, report } = result, room = document.rooms['themed-room']
    expect(validateSceneDocument(document).ok).toBe(true)
    expect(Object.values(document.props).length).toBeGreaterThan(1)
    for (const prop of Object.values(document.props)) {
      const definition = document.propDefinitions[prop.definitionRef!.id]
      expect(prop.footprintMm).toEqual(definition.defaultFootprintMm)
      expect(prop.visualBoundsMm).toEqual(definition.defaultVisualBoundsMm)
      expect(polygonInside(propFootprint(prop), roomPoints(document, room))).toBe(true)
    }
    expect(report.rooms).toHaveLength(1)
    expect(report.rooms[0].circulation?.every(row => row.status === 'clear')).toBe(true)
    expect(report.rooms[0].placed.some(row => row.role === (preset.purpose === '客房' ? 'bed' : preset.purpose === '厨房' ? 'hearth' : 'storage'))).toBe(true)
    expect(canonicalJson(createThemedRoomDocument(preset.id))).toBe(canonicalJson(result))
  })
})
