import { describe, expect, it } from 'vitest'
import {
  clampWorkspacePanelWidth, DEFAULT_WORKSPACE_LAYOUT, loadWorkspaceLayout, parseWorkspaceLayout,
  resolveWorkspaceWidths, saveWorkspaceLayout, WORKSPACE_LAYOUT_KEY, LEGACY_WORKSPACE_LAYOUT_KEY, WORKSPACE_LAYOUT_LIMITS,
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
      JSON.stringify({ ...DEFAULT_WORKSPACE_LAYOUT, navigationCollapsed: false }),
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

  it('maps legacy navigation into the left panel while preserving the independent inspector', () => {
    for (const resourcesCollapsed of [false, true]) for (const navigationCollapsed of [false, true]) {
      const legacy = { version: 1, resourcesWidth: 390, detailsWidth: 430, resourcesCollapsed, navigationCollapsed, inspectorCollapsed: true }
      const storage = { getItem: (key: string) => key === LEGACY_WORKSPACE_LAYOUT_KEY ? JSON.stringify(legacy) : null }
      expect(loadWorkspaceLayout(storage)).toEqual({
        version: 2, resourcesWidth: 390, detailsWidth: 430,
        resourcesCollapsed: resourcesCollapsed && navigationCollapsed, inspectorCollapsed: true,
      })
    }
  })

  it('prefers valid current preferences without reading or changing legacy data', () => {
    const current = { ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 410, resourcesCollapsed: true }
    const reads: string[] = []
    const storage = { getItem(key: string) { reads.push(key); return JSON.stringify(current) } }
    expect(loadWorkspaceLayout(storage)).toEqual(current)
    expect(reads).toEqual([WORKSPACE_LAYOUT_KEY])
  })

  it('recovers from a damaged current record and saves only the new key', () => {
    const legacy = JSON.stringify({ version: 1, resourcesWidth: 350, detailsWidth: 400, resourcesCollapsed: true, navigationCollapsed: false, inspectorCollapsed: false })
    const values = new Map([[WORKSPACE_LAYOUT_KEY, '{broken'], [LEGACY_WORKSPACE_LAYOUT_KEY, legacy]])
    const writes: string[] = []
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem(key: string, value: string) { writes.push(key); values.set(key, value) },
    }
    const restored = loadWorkspaceLayout(storage)
    expect(restored).toEqual({ ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 350, detailsWidth: 400 })
    expect(saveWorkspaceLayout(restored, storage)).toBe(true)
    expect(writes).toEqual([WORKSPACE_LAYOUT_KEY])
    expect(values.get(LEGACY_WORKSPACE_LAYOUT_KEY)).toBe(legacy)
    expect(loadWorkspaceLayout(storage)).toEqual(restored)
  })

  it('uses accessible defaults when neither current nor legacy preferences are valid', () => {
    const legacy = { version: 1, resourcesWidth: 350, detailsWidth: 400, resourcesCollapsed: true, navigationCollapsed: true, inspectorCollapsed: false }
    for (const raw of ['{', '[]', JSON.stringify({ ...legacy, version: 9 }), JSON.stringify({ ...legacy, navigationCollapsed: 'false' }),
      JSON.stringify({ ...legacy, resourcesWidth: 50000 }), JSON.stringify({ ...legacy, projectId: 'private' })]) {
      expect(loadWorkspaceLayout({ getItem: key => key === LEGACY_WORKSPACE_LAYOUT_KEY ? raw : null })).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    }
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
    expect(1080 - WORKSPACE_LAYOUT_LIMITS.navigation - 2 * WORKSPACE_LAYOUT_LIMITS.separator - fitted.resources - fitted.details).toBeGreaterThanOrEqual(360)
    expect(resolveWorkspaceWidths(preferred, 1800)).toEqual({ resources: 440, details: 480 })
    expect(preferred.resourcesWidth).toBe(440)
  })

  it('restores saved expanded widths after collapse or an unmeasurable hidden host', () => {
    const preferred = { ...DEFAULT_WORKSPACE_LAYOUT, resourcesWidth: 390, detailsWidth: 430 }
    expect(resolveWorkspaceWidths({ ...preferred, resourcesCollapsed: true, inspectorCollapsed: true }, 1300))
      .toEqual({ resources: 36, details: 36 })
    expect(resolveWorkspaceWidths(preferred, 0)).toEqual({ resources: 390, details: 430 })
    expect(resolveWorkspaceWidths(preferred, Number.NaN)).toEqual({ resources: 390, details: 430 })
    expect(resolveWorkspaceWidths(preferred, 1800)).toEqual({ resources: 390, details: 430 })
  })
})
