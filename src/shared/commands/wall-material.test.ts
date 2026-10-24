import { describe, expect, it } from 'vitest'
import native from '../../platform/browser/content/scenes-data.json'
import { applyCompositionCommands } from '../appearance/commands.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { CompositionCommand } from '../model/appearance.js'
import type { ProjectData } from '../model/project.js'
import type { PreparationContext } from '../ports/runtime.js'
import { validateProjectData } from '../project/validate.js'
import { canonicalJson, cloneJson } from '../validation/json.js'

const runtime = (): PreparationContext => ({ ids: { nextId: () => crypto.randomUUID() }, clock: { now: () => '2026-10-25T12:00:00.000Z' } })
const apply = (project: ProjectData, commands: CompositionCommand[]) => validateProjectData({ ...project, ...applyCompositionCommands({ document: project.document, appearance: project.appearance, historyIdentity: project.historyIdentity }, commands, runtime()) })
function fixture(): ProjectData {
  let project = validateProjectData(cloneJson(native.scenes.blank) as unknown as ProjectData)
  const alternate = cloneJson(project.document.materials['b2-m-04'])
  alternate.id = 'alternate-wall'; alternate.catalogId = 'test.material.alternate-wall'; alternate.name = 'Alternate wall stone'
  project.document.materials[alternate.id] = alternate
  project.licenseBindings.push({ ...project.licenseBindings.find(value => value.subjectKind === 'material' && value.subjectId === 'b2-m-04')!, subjectId: alternate.id })
  project = validateProjectData(project)
  return apply(project, [{ type: 'createRoom', id: 'house', floorId: 'blank-floor', layerId: 'layer-default-0',
    boundaryMm: [{ x: 2000, y: 2000 }, { x: 6000, y: 2000 }, { x: 6000, y: 6000 }, { x: 2000, y: 6000 }], thicknessMm: 200 }])
}

describe('native wall material command', () => {
  it('creates an opaque wall surface then retains paint, source ancestry, fixed definitions and licences on replacement', () => {
    const original = fixture(), id = 'house:wall:0'
    const first = apply(original, [{ type: 'setSurfaceMaterial', kind: 'wall', id, materialRef: { id: 'b2-m-04', version: 1 } }])
    expect(original.document.walls[id].topStyle).toBeNull()
    expect(first.document.walls[id].topStyle?.base).toMatchObject({ materialRef: { id: 'b2-m-04', version: 1 }, opacity: 1 })
    const styled = cloneJson(first.document), style = styled.walls[id].topStyle!
    style.base.rotationDeg = 30; style.base.tileSizeMm = { width: 3000, height: 2500 }
    const before = validateProjectData({ ...first, ...createCompositionContent(styled, runtime()) }), serialized = canonicalJson(before)
    const parentId = before.appearance.surfaceSources[id], parent = before.appearance.sources[parentId]
    const next = apply(before, [{ type: 'setSurfaceMaterial', kind: 'wall', id, materialRef: { id: 'alternate-wall', version: 1 } }])
    const expected = cloneJson(before.document)
    expected.walls[id].topStyle!.base.materialRef = { id: 'alternate-wall', version: 1 }
    expect(next.document).toEqual(expected)
    const source = next.appearance.sources[next.appearance.surfaceSources[id]]
    expect(source).toMatchObject({ kind: 'surface', parentSourceId: parentId, snapshot: expected.walls[id].topStyle })
    expect(next.appearance.sources[parentId]).toEqual(parent)
    for (const key of ['assets', 'licenses', 'licenseBindings', 'authoringSources', 'historyIdentity'] as const) expect(next[key]).toEqual(before[key])
    expect(canonicalJson(before)).toBe(serialized)
  })

  it('keeps native wall and layer locks, exact versions, surface compatibility, atomic rollback and the 256-command bound', () => {
    const project = fixture(), id = 'house:wall:0', command: CompositionCommand = { type: 'setSurfaceMaterial', kind: 'wall', id, materialRef: { id: 'b2-m-04', version: 1 } }
    const before = canonicalJson(project)
    expect(() => apply(project, [{ type: 'setWallThickness', id, thicknessMm: 300 }, { ...command, materialRef: { id: 'b2-m-04', version: 2 } }])).toThrow(/版本/)
    expect(() => apply(project, [{ ...command, materialRef: { id: 'b2-m-01', version: 1 } }])).toThrow(/不适用/)
    expect(() => apply(project, Array.from({ length: 257 }, () => command))).toThrow(/256/)
    for (const lock of [
      { type: 'setEditLock', kind: 'wall', id, locked: true },
      { type: 'setLayerLock', id: 'layer-default-0', locked: true },
    ] satisfies CompositionCommand[]) {
      const locked = apply(project, [lock]), serialized = canonicalJson(locked)
      expect(() => apply(locked, [command])).toThrow(/锁定/)
      expect(canonicalJson(locked)).toBe(serialized)
    }
    // Only material assignment gained a wall target. Other surface commands keep their contract.
    expect(() => apply(project, [{ type: 'setSurfacePaint', kind: 'wall', id, changes: { rotationDeg: 45 } } as unknown as CompositionCommand])).toThrow()
    expect(() => apply(project, [{ type: 'setOverlayBoundary', kind: 'wall', id, overlayId: 'overlay', boundaryMm: [] } as unknown as CompositionCommand])).toThrow()
    expect(canonicalJson(project)).toBe(before)
  })
})
