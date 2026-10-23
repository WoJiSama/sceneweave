export const WORKSPACE_LAYOUT_KEY = 'sceneweave:workspace-layout:v1'
export const WORKSPACE_NARROW_WIDTH = 1080
export const WORKSPACE_LAYOUT_LIMITS = Object.freeze({
  resources: { min: 220, max: 440 },
  details: { min: 260, max: 480 },
  tools: 48,
  separator: 8,
  collapsed: 36,
  canvas: 360,
})

export interface WorkspaceLayoutPreferences {
  version: 1
  resourcesWidth: number
  detailsWidth: number
  resourcesCollapsed: boolean
  inspectorCollapsed: boolean
  navigationCollapsed: boolean
}

export const DEFAULT_WORKSPACE_LAYOUT: Readonly<WorkspaceLayoutPreferences> = Object.freeze({
  version: 1,
  resourcesWidth: 280,
  detailsWidth: 320,
  resourcesCollapsed: false,
  inspectorCollapsed: false,
  navigationCollapsed: false,
})

const preferenceKeys = Object.keys(DEFAULT_WORKSPACE_LAYOUT).sort()
const freshDefaults = (): WorkspaceLayoutPreferences => ({ ...DEFAULT_WORKSPACE_LAYOUT })
const validWidth = (value: unknown, limits: { min: number; max: number }): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= limits.min && value <= limits.max

/** This is an independent UI record. Unknown or damaged versions never enter project data. */
export function parseWorkspaceLayout(raw: string | null): WorkspaceLayoutPreferences {
  if (raw === null) return freshDefaults()
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return freshDefaults()
    const record = value as Record<string, unknown>
    if (Object.keys(record).sort().join('|') !== preferenceKeys.join('|') || record.version !== 1 ||
      !validWidth(record.resourcesWidth, WORKSPACE_LAYOUT_LIMITS.resources) ||
      !validWidth(record.detailsWidth, WORKSPACE_LAYOUT_LIMITS.details) ||
      typeof record.resourcesCollapsed !== 'boolean' || typeof record.inspectorCollapsed !== 'boolean' ||
      typeof record.navigationCollapsed !== 'boolean') return freshDefaults()
    return {
      version: 1, resourcesWidth: record.resourcesWidth, detailsWidth: record.detailsWidth,
      resourcesCollapsed: record.resourcesCollapsed, inspectorCollapsed: record.inspectorCollapsed,
      navigationCollapsed: record.navigationCollapsed,
    }
  } catch { return freshDefaults() }
}

export function loadWorkspaceLayout(storage: Pick<Storage, 'getItem'> | null): WorkspaceLayoutPreferences {
  try { return parseWorkspaceLayout(storage?.getItem(WORKSPACE_LAYOUT_KEY) ?? null) }
  catch { return freshDefaults() }
}

export function saveWorkspaceLayout(preferences: WorkspaceLayoutPreferences, storage: Pick<Storage, 'setItem'> | null): boolean {
  if (!storage) return false
  try { storage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(preferences)); return true }
  catch { return false }
}

export function clampWorkspacePanelWidth(side: 'resources' | 'details', width: number): number {
  const limits = WORKSPACE_LAYOUT_LIMITS[side]
  const fallback = side === 'resources' ? DEFAULT_WORKSPACE_LAYOUT.resourcesWidth : DEFAULT_WORKSPACE_LAYOUT.detailsWidth
  return Math.round(Math.max(limits.min, Math.min(limits.max, Number.isFinite(width) ? width : fallback)))
}

/** Fit actual columns without changing remembered expanded widths. A hidden host has no new measurement. */
export function resolveWorkspaceWidths(preferences: WorkspaceLayoutPreferences, hostWidth: number) {
  const limits = WORKSPACE_LAYOUT_LIMITS
  const detailsCollapsed = preferences.inspectorCollapsed && preferences.navigationCollapsed
  let resources = preferences.resourcesCollapsed ? limits.collapsed : clampWorkspacePanelWidth('resources', preferences.resourcesWidth)
  let details = detailsCollapsed ? limits.collapsed : clampWorkspacePanelWidth('details', preferences.detailsWidth)
  const minResources = preferences.resourcesCollapsed ? limits.collapsed : limits.resources.min
  const minDetails = detailsCollapsed ? limits.collapsed : limits.details.min
  if (Number.isFinite(hostWidth) && hostWidth >= WORKSPACE_NARROW_WIDTH) {
    const available = hostWidth - limits.tools - 2 * limits.separator - limits.canvas
    const excess = resources + details - available
    if (excess > 0) {
      const flexibleResources = resources - minResources, flexibleDetails = details - minDetails
      const flexible = flexibleResources + flexibleDetails
      if (flexible > 0) {
        resources = Math.max(minResources, Math.floor(resources - excess * flexibleResources / flexible))
        details = Math.max(minDetails, Math.floor(details - excess * flexibleDetails / flexible))
      }
    }
  }
  return { resources, details }
}
