import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import {
  clampWorkspacePanelWidth, DEFAULT_WORKSPACE_LAYOUT, loadWorkspaceLayout, resolveWorkspaceWidths,
  saveWorkspaceLayout, WORKSPACE_LAYOUT_LIMITS, WORKSPACE_NARROW_WIDTH,
} from './layout-preferences'
import type { WorkspaceLayoutPreferences } from './layout-preferences'
import './workspace-layout.css'

export type WorkspaceNavigationTab = 'layers' | 'objects' | 'history'
type Panel = 'resources' | 'inspector' | 'navigation'
type ResizeSide = 'resources' | 'details'

export interface WorkspaceLayoutProps {
  active: boolean
  resources: ReactNode
  inspector: ReactNode
  navigation: readonly { id: WorkspaceNavigationTab; label: string; content: ReactNode; disabled?: boolean }[]
  navigationTab: WorkspaceNavigationTab
  onNavigationTabChange: (tab: WorkspaceNavigationTab) => void
  panelRequest?: { id: Panel; sequence: number }
  tools: ReactNode
  footer: ReactNode
  children: ReactNode
}

function localStorageOrNull(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
}

const panelLabels: Record<Panel, string> = { resources: '资源面板', inspector: '属性面板', navigation: '场景导航' }
const collapsedKeys = { resources: 'resourcesCollapsed', inspector: 'inspectorCollapsed', navigation: 'navigationCollapsed' } as const

export default function WorkspaceLayout({ active, resources, inspector, navigation, navigationTab,
  onNavigationTabChange, panelRequest, tools, footer, children }: WorkspaceLayoutProps) {
  const [storage] = useState(localStorageOrNull)
  const [preferences, setPreferences] = useState(() => loadWorkspaceLayout(storage))
  const [persistent, setPersistent] = useState(true)
  const [hostWidth, setHostWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth)
  const [drawer, setDrawer] = useState<Panel | null>(null)
  const [resizing, setResizing] = useState<ResizeSide | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const resourcePanel = useRef<HTMLElement>(null)
  const inspectorPanel = useRef<HTMLElement>(null)
  const navigationPanel = useRef<HTMLElement>(null)
  const triggers = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({})
  const closeButtons = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({})
  const drag = useRef<{ pointerId: number; side: ResizeSide; x: number; width: number } | null>(null)
  const lastPanelFocus = useRef<HTMLElement | null>(null)
  const layoutId = useId()
  const narrow = hostWidth < WORKSPACE_NARROW_WIDTH
  const currentDrawer = useRef(drawer)
  currentDrawer.current = drawer
  const widths = resolveWorkspaceWidths(preferences, hostWidth)
  const bothDetailsCollapsed = preferences.inspectorCollapsed && preferences.navigationCollapsed
  const visible = (panel: Panel) => narrow ? drawer === panel : !preferences[collapsedKeys[panel]]
  const panelRef = (panel: Panel) => panel === 'resources' ? resourcePanel : panel === 'inspector' ? inspectorPanel : navigationPanel

  useEffect(() => { setPersistent(saveWorkspaceLayout(preferences, storage)) }, [preferences, storage])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {
      const width = element.getBoundingClientRect().width
      // Home keeps this mounted with display:none. Its zero must not erase a useful layout.
      if (width > 0) setHostWidth(Math.round(width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    if (!active || !narrow) setDrawer(null)
  }, [active, narrow])

  useEffect(() => {
    if (!panelRequest) return
    const panel = panelRequest.id
    if (narrow) {
      setDrawer(panel)
      requestAnimationFrame(() => closeButtons.current[panel]?.focus())
    } else setPreferences(current => ({ ...current, [collapsedKeys[panel]]: false }))
  }, [panelRequest?.id, panelRequest?.sequence])

  useEffect(() => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && navigationPanel.current?.contains(focused) && focused.closest('[hidden],[inert]')) {
      navigationPanel.current.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
    }
  }, [navigationTab])

  useEffect(() => {
    const previous = lastPanelFocus.current
    if (!active || !previous || !previous.closest('[hidden],[inert]') || document.querySelector('[role="dialog"],[role="menu"],dialog[open]')) return
    const panel = (['resources', 'inspector', 'navigation'] as const).find(id => panelRef(id).current?.contains(previous))
    if (!panel) return
    lastPanelFocus.current = null
    if (panel === 'navigation' && visible(panel)) navigationPanel.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus()
    else triggers.current[panel]?.focus()
  })

  const closeDrawer = (restoreFocus = true) => {
    const closing = currentDrawer.current
    setDrawer(null)
    currentDrawer.current = null
    if (restoreFocus && active && closing) triggers.current[closing]?.focus()
  }

  useEffect(() => {
    if (!active || !narrow || !drawer) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || target.closest('input,textarea,select,[contenteditable],[role="dialog"],[role="menu"]')) return
      if (!panelRef(drawer).current?.contains(target) && !triggers.current[drawer]?.contains(target)) return
      // Let form, menu and current candidate handlers consume Escape first. This drawer owns no tool state.
      queueMicrotask(() => {
        if (event.defaultPrevented || document.querySelector('[role="dialog"],[role="menu"],dialog[open]') || currentDrawer.current !== drawer) return
        closeDrawer()
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, narrow, drawer])

  const togglePanel = (panel: Panel) => {
    if (narrow) {
      if (drawer === panel) { closeDrawer(); return }
      setDrawer(panel)
      requestAnimationFrame(() => closeButtons.current[panel]?.focus())
      return
    }
    if (!preferences[collapsedKeys[panel]] && panelRef(panel).current?.contains(document.activeElement)) triggers.current[panel]?.focus()
    setPreferences(current => ({ ...current, [collapsedKeys[panel]]: !current[collapsedKeys[panel]] }))
  }

  const changeWidth = (side: ResizeSide, value: number) => {
    const maximum = maximumWidth(side)
    const width = Math.min(maximum, clampWorkspacePanelWidth(side, value))
    // A deliberate drag starts from the columns currently on screen. Otherwise an
    // auto-fitted neighbour would expand toward its old preference at every pixel.
    setPreferences(current => ({ ...current,
      resourcesWidth: side === 'resources' ? width : current.resourcesCollapsed ? current.resourcesWidth : widths.resources,
      detailsWidth: side === 'details' ? width : current.inspectorCollapsed && current.navigationCollapsed ? current.detailsWidth : widths.details,
    }))
  }
  const maximumWidth = (side: ResizeSide) => {
    const other = side === 'resources' ? widths.details : widths.resources
    const available = hostWidth - WORKSPACE_LAYOUT_LIMITS.tools - 2 * WORKSPACE_LAYOUT_LIMITS.separator - WORKSPACE_LAYOUT_LIMITS.canvas - other
    return Math.max(WORKSPACE_LAYOUT_LIMITS[side].min, Math.min(WORKSPACE_LAYOUT_LIMITS[side].max, Math.floor(available)))
  }
  const startResize = (event: PointerEvent<HTMLDivElement>, side: ResizeSide) => {
    if (event.button !== 0 || narrow) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, side, x: event.clientX, width: widths[side] }
    setResizing(side)
  }
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    changeWidth(current.side, current.width + (event.clientX - current.x) * (current.side === 'resources' ? 1 : -1))
  }
  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setResizing(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resizeKey = (event: KeyboardEvent<HTMLDivElement>, side: ResizeSide) => {
    const step = event.shiftKey ? 40 : 10
    const direction = side === 'resources' ? 1 : -1
    const requested = event.key === 'Home' ? WORKSPACE_LAYOUT_LIMITS[side].min : event.key === 'End' ? maximumWidth(side) :
      event.key === 'ArrowLeft' ? widths[side] - step * direction : event.key === 'ArrowRight' ? widths[side] + step * direction : null
    if (requested === null) return
    event.preventDefault()
    event.stopPropagation()
    changeWidth(side, requested)
  }

  const renderSeparator = (side: ResizeSide, hidden: boolean) => <div className="workspace-resizer" data-side={side}
    role="separator" aria-label={side === 'resources' ? '调整资源面板宽度' : '调整右侧面板宽度'} aria-orientation="vertical"
    aria-controls={`${layoutId}-${side === 'resources' ? 'resources' : 'details'}`} aria-valuemin={WORKSPACE_LAYOUT_LIMITS[side].min}
    aria-valuemax={maximumWidth(side)} aria-valuenow={widths[side]} aria-valuetext={`${widths[side]} 像素`}
    tabIndex={active && !narrow && !hidden ? 0 : -1} aria-hidden={narrow || hidden || undefined} data-disabled={hidden || narrow}
    onPointerDown={event => { if (!hidden) startResize(event, side) }} onPointerMove={moveResize}
    onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { drag.current = null; setResizing(null) }}
    onKeyDown={event => resizeKey(event, side)}/>

  const panelHeader = (panel: Panel) => <div className="workspace-panel-header">
    <h2>{panelLabels[panel]}</h2>
    <button type="button" ref={element => { closeButtons.current[panel] = element }}
      aria-label={`${narrow ? '关闭' : visible(panel) ? '折叠' : '展开'}${panelLabels[panel]}`} aria-expanded={visible(panel)}
      aria-controls={`${layoutId}-${panel}-content`} onClick={() => togglePanel(panel)}>
      <span aria-hidden="true">{narrow ? '×' : visible(panel) ? panel === 'resources' ? '‹' : '⌃' : panel === 'resources' ? '›' : '⌄'}</span>
    </button>
  </div>

  const navigationKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = navigation.filter(tab => !tab.disabled)
    if (!tabs.length) return
    const selected = Math.max(0, tabs.findIndex(tab => tab.id === navigationTab))
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (selected + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    event.preventDefault()
    onNavigationTabChange(tabs[index].id)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${tabs[index].id}"]`)?.focus()
  }

  const style = { '--workspace-resources-width': `${widths.resources}px`, '--workspace-details-width': `${widths.details}px` } as CSSProperties
  return <div className="workspace-layout" ref={host} style={style} data-testid="workspace-layout" data-narrow={narrow}
    data-resizing={resizing ?? undefined} data-details-collapsed={bothDetailsCollapsed} onFocusCapture={event => {
      const target = event.target as HTMLElement
      lastPanelFocus.current = (['resources', 'inspector', 'navigation'] as const).some(panel => panelRef(panel).current?.contains(target)) ? target : null
    }}>
    <div className="workspace-layout-actions" aria-label="工作区布局">
      {(['resources', 'inspector', 'navigation'] as const).map(panel => <button type="button" key={panel}
        ref={element => { triggers.current[panel] = element }} aria-expanded={visible(panel)} aria-controls={`${layoutId}-${panel}`}
        onClick={() => togglePanel(panel)}>{panelLabels[panel]}</button>)}
      <span className="workspace-layout-spacer"/>
      <button type="button" onClick={() => { setPreferences(current => ({ ...current, resourcesCollapsed: false, inspectorCollapsed: false, navigationCollapsed: false })); closeDrawer(false) }}>展开全部面板</button>
      <button type="button" onClick={() => { setPreferences({ ...DEFAULT_WORKSPACE_LAYOUT }); closeDrawer(false) }}>重置布局</button>
      {!persistent && <span className="workspace-layout-storage" role="status">布局仅在本次会话生效</span>}
    </div>
    <div className="workspace-layout-body">
      <nav className="workspace-tools" aria-label="画布工具">{tools}</nav>
      <section id={`${layoutId}-resources`} ref={resourcePanel} className="workspace-panel workspace-resources" data-testid="workspace-resources"
        aria-label="资源面板" data-open={visible('resources')} data-collapsed={!visible('resources')}
        inert={narrow && !visible('resources')} aria-hidden={narrow && !visible('resources') || undefined}>
        {panelHeader('resources')}
        <div id={`${layoutId}-resources-content`} className="workspace-panel-body" hidden={!visible('resources')} inert={!visible('resources')}>{resources}</div>
      </section>
      {renderSeparator('resources', preferences.resourcesCollapsed)}
      <section className="workspace-canvas" aria-label="场景画布">{children}</section>
      {renderSeparator('details', bothDetailsCollapsed)}
      <div id={`${layoutId}-details`} className="workspace-details">
        <section id={`${layoutId}-inspector`} ref={inspectorPanel} className="workspace-panel workspace-inspector" data-testid="workspace-inspector"
          aria-label="属性面板" data-open={visible('inspector')} data-collapsed={!visible('inspector')}
          inert={narrow && !visible('inspector')} aria-hidden={narrow && !visible('inspector') || undefined}>
          {panelHeader('inspector')}
          <div id={`${layoutId}-inspector-content`} className="workspace-panel-body" hidden={!visible('inspector')} inert={!visible('inspector')}>{inspector}</div>
        </section>
        <section id={`${layoutId}-navigation`} ref={navigationPanel} className="workspace-panel workspace-navigation" data-testid="workspace-navigation"
          aria-label="场景导航" data-open={visible('navigation')} data-collapsed={!visible('navigation')}
          inert={narrow && !visible('navigation')} aria-hidden={narrow && !visible('navigation') || undefined}>
          {panelHeader('navigation')}
          <div id={`${layoutId}-navigation-content`} className="workspace-panel-body" hidden={!visible('navigation')} inert={!visible('navigation')}>
            <div className="workspace-navigation-tabs" role="tablist" aria-label="场景导航" onKeyDown={navigationKey}>
              {navigation.map(tab => <button type="button" role="tab" key={tab.id} data-tab={tab.id} id={`${layoutId}-tab-${tab.id}`}
                aria-controls={`${layoutId}-tabpanel-${tab.id}`} aria-selected={navigationTab === tab.id} disabled={tab.disabled}
                tabIndex={navigationTab === tab.id ? 0 : -1} onClick={() => onNavigationTabChange(tab.id)}>{tab.label}</button>)}
            </div>
            {navigation.map(tab => <div key={tab.id} id={`${layoutId}-tabpanel-${tab.id}`} role="tabpanel"
              aria-labelledby={`${layoutId}-tab-${tab.id}`} className="workspace-navigation-content"
              hidden={navigationTab !== tab.id} inert={navigationTab !== tab.id}>{tab.content}</div>)}
          </div>
        </section>
      </div>
    </div>
    <footer className="workspace-footer">{footer}</footer>
  </div>
}
