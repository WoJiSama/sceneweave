import { describe, expect, it } from 'vitest'
import { imageImportDraftMatches, workspaceFormDraftLabels, workspaceTransitionReason, type WorkspaceTransient } from './session-guard'

const idle = (): WorkspaceTransient => ({
  ...Object.fromEntries(Object.keys(workspaceFormDraftLabels).map(key => [key, false])),
  busy: false, preparing: false, newScene: false, candidate: false,
  placement: false, prefabPlacement: false, sketch: false, outdoorSketch: false,
  restore: false, structureRestore: false, structure: false,
} as WorkspaceTransient)

describe('image import draft session protection', () => {
  it('blocks departures for an unadopted image draft even when the project is saved', () => {
    const state = { ...idle(), imageImport: true }
    expect(workspaceTransitionReason(state)).not.toBeNull()
    expect(workspaceTransitionReason(state)).toMatch(/图片.*草稿/)
    expect(workspaceTransitionReason(state, 'buildingForm')).toMatch(/图片.*草稿/)
  })

  it('allows its own preparation while preserving every other conflicting draft and candidate', () => {
    const state = { ...idle(), imageImport: true }
    expect(workspaceTransitionReason(state, 'imageImport')).toBeNull()
    expect(workspaceTransitionReason({ ...state, buildingForm: true }, 'imageImport')).toMatch(/建筑表单/)
    expect(workspaceTransitionReason({ ...state, placement: true }, 'imageImport')).toMatch(/物件放置/)
    expect(workspaceTransitionReason({ ...state, candidate: true }, 'imageImport')).toMatch(/待打开工程/)
    expect(workspaceTransitionReason({ ...state, preparing: true }, 'imageImport')).toMatch(/准备完整资源/)
  })

  it('releases only the exact adopted draft and excludes unrelated or stale candidates', () => {
    expect(imageImportDraftMatches('current-image', 'current-image')).toBe(true)
    expect(imageImportDraftMatches('current-image', 'previous-image')).toBe(false)
    expect(imageImportDraftMatches('current-image', undefined)).toBe(false)
    expect(imageImportDraftMatches(null, 'previous-image')).toBe(false)
    expect(imageImportDraftMatches(null, undefined)).toBe(false)
  })
})
