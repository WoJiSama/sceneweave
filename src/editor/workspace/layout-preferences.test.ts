import { describe, expect, it } from 'vitest'
import {
  clampWorkspacePanelWidth, DEFAULT_WORKSPACE_LAYOUT, loadWorkspaceLayout, parseWorkspaceLayout,
  resolveWorkspaceWidths, saveWorkspaceLayout, WORKSPACE_LAYOUT_KEY, WORKSPACE_LAYOUT_LIMITS,
} from './layout-preferences'

describe('independent workspace layout preferences', () => {
  it('round trips the exact versioned UI record without scene or history fields', () => {
    const value = { ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 400, detailsWidth: 460, inspectorCollapsed: true }
    let saved = ''
    expect(saveWorkspaceLayout(value, { setItem(key, raw) { expect(key).toBe(WORKSPACE_LAYOUT_KEY); saved = raw } })).toBe(true)
    expect(loadWorkspaceLayout({ getItem(key) { expect(key).toBe(WORKSPACE_LAYOUT_KEY); return saved } })).toEqual(value)
    expect(Object.keys(JSON.parse(saved))).not.toContain('revision')
  })

  it('rejects damaged, old, unknown, nonfinite and out of range records as complete defaults', () => {
    for (const raw of [null, '{', '[]', 'null', '1', JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, version: 0 }),
      JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, sceneId: 'unrelated-project' }),
      JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 0 }),
      JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, detailsWidth: 999999 }),
      JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, detailsWidth: 320.5 }),
      JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, resourcesCollapsed: 'false' }),
      JSON.stringify(DEFAULT_WORKSPACE_LAYOUT).replace('280', '1e400')]) {
      expect(parseWorkspaceLayout(raw)).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    }
  })

  it('keeps the session usable when storage cannot be read or written', () => {
    expect(loadWorkspaceLayout({ getItem() { throw new Error('denied') } })).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    expect(saveWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT }, { setItem() { throw new Error('quota') } })).toBe(false)
    expect(loadWorkspaceLayout(null)).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    expect(saveWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT }, null)).toBe(false)
  })

  it('bounds pointer and keyboard width input, including nonfinite values', () => {
    expect(clampWorkspacePanelWidth('resources', -100)).toBe(220)
    expect(clampWorkspacePanelWidth('details', 9999)).toBe(480)
    expect(clampWorkspacePanelWidth('resources', Number.NaN)).toBe(DEFAULT_WORKSPACE_LAYOUT.resourcesWidth)
    expect(clampWorkspacePanelWidth('details', Number.POSITIVE_INFINITY)).toBe(DEFAULT_WORKSPACE_LAYOUT.detailsWidth)
    expect(clampWorkspacePanelWidth('resources', 301.75)).toBe(302)
  })

  it('fits two wide panels while reserving the center and retaining preferred widths', () => {
    const preferred = { ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 440, detailsWidth: 480 }
    const fitted = resolveWorkspaceWidths(preferred, 1080)
    expect(fitted.resources).toBeGreaterThanOrEqual(WORKSPACE_LAYOUT_LIMITS.resources.min)
    expect(fitted.details).toBeGreaterThanOrEqual(WORKSPACE_LAYOUT_LIMITS.details.min)
    expect(1080 - 48 - 16 - fitted.resources - fitted.details).toBeGreaterThanOrEqual(360)
    expect(resolveWorkspaceWidths(preferred, 1800)).toEqual({ resources: 440, details: 480 })
    expect(preferred.resourcesWidth).toBe(440)
  })

  it('restores saved expanded widths after collapse or an unmeasurable hidden host', () => {
    const preferred = { ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 390, detailsWidth: 430 }
    expect(resolveWorkspaceWidths({ ...preferred, resourcesCollapsed: true, inspectorCollapsed: true, navigationCollapsed: true }, 1300))
      .toEqual({ resources: 36, details: 36 })
    expect(resolveWorkspaceWidths(preferred, 0)).toEqual({ resources: 390, details: 430 })
    expect(resolveWorkspaceWidths(preferred, Number.NaN)).toEqual({ resources: 390, details: 430 })
    expect(resolveWorkspaceWidths(preferred, 1800)).toEqual({ resources: 390, details: 430 })
  })
})
