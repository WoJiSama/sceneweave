import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Columns3, PanelLeft, PanelRight, SlidersHorizontal } from 'lucide-react'
import {
  clampWorkspacePanelWidth, DEFAULT_WORKSPACE_LAYOUT, loadWorkspaceLayout, resolveWorkspaceWidths,
  saveWorkspaceLayout, WORKSPACE_LAYOUT_LIMITS, WORKSPACE_NARROW_WIDTH,
} from './layout-preferences'
import './workspace-layout.css'

type Panel = 'resources' | 'inspector'
type ResizeSide = 'resources' | 'details'

export interface WorkspaceLayoutProps {
  active: boolean
  resources: ReactNode
  inspector: ReactNode
  modules: readonly { id: string; label: string; icon?: ReactNode; disabled?: boolean; group?: 'workflow' | 'utility' }[]
  activeModule: string
  onModuleChange: (id: string) => void
  resourceTitle?: string
  inspectorTitle?: string
  sessionKey?: string | number
  panelRequest?: { id: Panel; sequence: number; action?: 'open' | 'close'; focus?: boolean; narrowOnly?: boolean }
  tools: ReactNode
  layoutControlsTarget?: HTMLElement | null
  footer: ReactNode
  children: ReactNode
}

function localStorageOrNull(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
}

const panels = ['resources', 'inspector'] as const
const panelLabels: Record<Panel, string> = { resources: '内容面板', inspector: '当前详情' }
const collapsedKeys = { resources: 'resourcesCollapsed', inspector: 'inspectorCollapsed' } as const
const COMPACT_WORKSPACE_WIDTH = 760
const mapOptionsToolbar = '.asset-viewport-toolbar'
const mapOptionsControls = `${mapOptionsToolbar} :is(button, input, select):enabled`

export default function WorkspaceLayout({ active, resources, inspector, modules, activeModule, onModuleChange,
  resourceTitle, inspectorTitle, sessionKey, panelRequest, tools, layoutControlsTarget, footer, children }: WorkspaceLayoutProps) {
  const [storage] = useState(localStorageOrNull)
  const [preferences, setPreferences] = useState(() => loadWorkspaceLayout(storage))
  const [persistent, setPersistent] = useState(true)
  const [hostWidth, setHostWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth)
  const [drawer, setDrawer] = useState<Panel | null>(null)
  const [mapOptionsOpen, setMapOptionsOpen] = useState(false)
  const [resizing, setResizing] = useState<ResizeSide | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const resourcePanel = useRef<HTMLElement>(null)
  const resourceBody = useRef<HTMLDivElement>(null)
  const inspectorPanel = useRef<HTMLElement>(null)
  const moduleNavigation = useRef<HTMLElement>(null)
  const layoutSettings = useRef<HTMLDetailsElement>(null)
  const mapOptionsTrigger = useRef<HTMLButtonElement>(null)
  const restoreMapOptionsFocus = useRef(false)
  const focusedLayoutControl = useRef<Panel | 'settings' | null>(null)
  const triggers = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({})
  const closeButtons = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({})
  const drag = useRef<{ pointerId: number; side: ResizeSide; x: number; width: number } | null>(null)
  const lastPanelFocus = useRef<HTMLElement | null>(null)
  const drawerReturnFocus = useRef<HTMLElement | null>(null)
  const pendingPanelFocus = useRef<Panel | null>(null)
  const moduleScroll = useRef(new Map<string, number>())
  const layoutId = useId()
  const narrow = hostWidth < WORKSPACE_NARROW_WIDTH
  const compact = hostWidth <= COMPACT_WORKSPACE_WIDTH
  const currentDrawer = useRef(drawer)
  currentDrawer.current = drawer
  const widths = resolveWorkspaceWidths(preferences, hostWidth)
  const visible = (panel: Panel) => narrow ? drawer === panel : !preferences[collapsedKeys[panel]]
  const resourcesVisible = visible('resources')
  const panelRef = (panel: Panel) => panel === 'resources' ? resourcePanel : inspectorPanel
  const resourceLabel = resourceTitle ?? modules.find(module => module.id === activeModule)?.label ?? panelLabels.resources

  useEffect(() => { setPersistent(saveWorkspaceLayout(preferences, storage)) }, [preferences, storage])
  useLayoutEffect(() => {
    // Acquiring the header target moves the controls to a different DOM parent.
    if (!active || document.activeElement !== document.body || !focusedLayoutControl.current) return
    if (focusedLayoutControl.current === 'settings') layoutSettings.current?.querySelector('summary')?.focus()
    else triggers.current[focusedLayoutControl.current]?.focus()
  }, [active, layoutControlsTarget])

  useEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {
      const width = Math.round(element.getBoundingClientRect().width)
      // Home keeps this mounted with display:none. Its zero must not erase a useful layout.
      if (width <= 0) return
      const nextCompact = width <= COMPACT_WORKSPACE_WIDTH
      if (element.dataset.compact !== String(nextCompact)) {
        const focused = document.activeElement
        restoreMapOptionsFocus.current = !nextCompact && focused === mapOptionsTrigger.current
        setMapOptionsOpen(nextCompact && !!focused?.closest(mapOptionsToolbar))
      }
      setHostWidth(width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    if (!active || !narrow) setDrawer(null)
    if (!active) {
      pendingPanelFocus.current = null
      setMapOptionsOpen(false)
    }
  }, [active, narrow])
  useLayoutEffect(() => {
    if (!active) return
    if (compact && mapOptionsOpen && !document.activeElement?.closest(mapOptionsToolbar)) {
      const firstOption = host.current?.querySelector<HTMLElement>(mapOptionsControls) ?? mapOptionsTrigger.current
      firstOption?.focus()
    }
    if (!compact && restoreMapOptionsFocus.current) {
      restoreMapOptionsFocus.current = false
      const firstControl = host.current?.querySelector<HTMLElement>(mapOptionsControls)
        ?? host.current?.querySelector<HTMLButtonElement>('.workspace-canvas-tools button:enabled:not([hidden])')
        ?? triggers.current.resources
      firstControl?.focus()
    }
  }, [active, compact, mapOptionsOpen])

  useLayoutEffect(() => { moduleScroll.current.clear() }, [sessionKey])
  useLayoutEffect(() => {
    if (active && resourcesVisible && resourceBody.current) resourceBody.current.scrollTop = moduleScroll.current.get(activeModule) ?? 0
  }, [active, activeModule, resourcesVisible, sessionKey])

  useEffect(() => {
    if (active) moduleNavigation.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, activeModule])

  const closeDrawer = (restoreFocus = true) => {
    const closing = currentDrawer.current
    // The opener can sit outside this layout, so its focus event may not reach our capture handler.
    lastPanelFocus.current = null
    pendingPanelFocus.current = null
    setDrawer(null)
    currentDrawer.current = null
    if (restoreFocus && active && closing) {
      const previous = drawerReturnFocus.current
      // Programmatic panels can open after their initiating button unmounts,
      // leaving body as the recorded opener. Connected/visible alone does not
      // make an element focusable (a disabled opener also ignores focus()).
      let restored = false
      if (previous?.isConnected && previous !== document.body && !previous.closest('[hidden],[inert]') && !panelRef(closing).current?.contains(previous)) {
        previous.focus()
        restored = document.activeElement === previous
      }
      if (!restored) triggers.current[closing]?.focus()
    }
    drawerReturnFocus.current = null
  }

  const focusOpenPanel = (panel: Panel) => {
    const button = closeButtons.current[panel]
    if (!active || !button || panelRef(panel).current?.dataset.open !== 'true' || button.closest('[hidden],[inert]')) return false
    pendingPanelFocus.current = null
    button.focus({ preventScroll: true })
    return document.activeElement === button
  }

  const openPanel = (panel: Panel, focus = narrow) => {
    pendingPanelFocus.current = focus ? panel : null
    if (narrow) {
      setMapOptionsOpen(false)
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const outsidePanel = opener && opener !== document.body && !panelRef(panel).current?.contains(opener)
      if (currentDrawer.current !== panel || outsidePanel) drawerReturnFocus.current = opener
      currentDrawer.current = panel
      setDrawer(panel)
    } else setPreferences(current => ({ ...current, [collapsedKeys[panel]]: false }))
    if (focus) focusOpenPanel(panel)
  }

  useEffect(() => {
    if (!active || !panelRequest || (panelRequest.narrowOnly && !narrow)) return
    const panel = panelRequest.id
    if (panelRequest.action === 'close') {
      if (narrow) { if (panelRequest.narrowOnly || currentDrawer.current === panel) closeDrawer(panelRequest.focus ?? true) }
      else setPreferences(current => ({ ...current, [collapsedKeys[panel]]: true }))
    } else openPanel(panel, panelRequest.focus ?? narrow)
  }, [panelRequest?.id, panelRequest?.sequence])

  useLayoutEffect(() => {
    // A newly opened drawer can receive focus once its visible DOM has committed.
    const requested = pendingPanelFocus.current
    if (requested && focusOpenPanel(requested)) return
    const previous = lastPanelFocus.current
    const focused = document.activeElement
    if (focused && focused !== document.body && focused !== previous) return
    if (!active || !previous || !previous.closest('[hidden],[inert]') || document.querySelector('[role="dialog"],[role="menu"],dialog[open]')) return
    const panel = panels.find(id => panelRef(id).current?.contains(previous))
    if (!panel) return
    lastPanelFocus.current = null
    if (visible(panel)) closeButtons.current[panel]?.focus()
    else triggers.current[panel]?.focus()
  })

  const closeLayoutSettings = () => {
    if (!layoutSettings.current) return
    layoutSettings.current.open = false
    layoutSettings.current.querySelector('summary')?.focus()
  }

  const isMapOptionsTarget = (target: EventTarget | null) => target instanceof Element &&
    (target === mapOptionsTrigger.current || !!target.closest(mapOptionsToolbar))

  const closeMapOptions = () => {
    mapOptionsTrigger.current?.focus({ preventScroll: true })
    setMapOptionsOpen(false)
  }

  const toggleMapOptions = () => {
    if (mapOptionsOpen) closeMapOptions()
    else {
      if (drawer) closeDrawer(false)
      setMapOptionsOpen(true)
    }
  }

  const mapOptionsKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!active || !compact || !mapOptionsOpen || !isMapOptionsTarget(event.target) || event.defaultPrevented ||
      event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    event.stopPropagation()
    // Let the native grid picker handle Escape while it is open.
    if (event.target instanceof HTMLSelectElement &&
      (!CSS.supports('selector(:open)') || event.target.matches(':open'))) return
    event.preventDefault()
    closeMapOptions()
  }

  const drawerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active || !narrow || !drawer || event.defaultPrevented || event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest('input,textarea,select,[contenteditable],[role="dialog"],[role="menu"]') || document.querySelector('[role="dialog"],[role="menu"],dialog[open]')) return
    if (!panelRef(drawer).current?.contains(target) && !triggers.current[drawer]?.contains(target) && !moduleNavigation.current?.contains(target)) return
    // Bubble after local form/tool handlers, before the global candidate shortcut.
    event.preventDefault()
    event.stopPropagation()
    closeDrawer()
  }

  const togglePanel = (panel: Panel) => {
    if (narrow) {
      if (drawer === panel) closeDrawer()
      else openPanel(panel)
      return
    }
    if (!preferences[collapsedKeys[panel]] && panelRef(panel).current?.contains(document.activeElement)) triggers.current[panel]?.focus()
    setPreferences(current => ({ ...current, [collapsedKeys[panel]]: !current[collapsedKeys[panel]] }))
  }

  const selectModule = (id: string) => {
    if (resourceBody.current && resourcesVisible) moduleScroll.current.set(activeModule, resourceBody.current.scrollTop)
    onModuleChange(id)
    openPanel('resources')
  }

  const maximumWidth = (side: ResizeSide) => {
    const other = side === 'resources' ? widths.details : widths.resources
    const available = hostWidth - WORKSPACE_LAYOUT_LIMITS.navigation - 2 * WORKSPACE_LAYOUT_LIMITS.separator - WORKSPACE_LAYOUT_LIMITS.canvas - other
    return Math.max(WORKSPACE_LAYOUT_LIMITS[side].min, Math.min(WORKSPACE_LAYOUT_LIMITS[side].max, Math.floor(available)))
  }
  const changeWidth = (side: ResizeSide, value: number) => {
    const width = Math.min(maximumWidth(side), clampWorkspacePanelWidth(side, value))
    // Start a deliberate drag from fitted columns rather than expanding the neighbour on every pixel.
    setPreferences(current => ({ ...current,
      resourcesWidth: side === 'resources' ? width : current.resourcesCollapsed ? current.resourcesWidth : widths.resources,
      detailsWidth: side === 'details' ? width : current.inspectorCollapsed ? current.detailsWidth : widths.details,
    }))
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
    role="separator" aria-label={side === 'resources' ? '调整内容面板宽度' : '调整当前详情宽度'} aria-orientation="vertical"
    aria-controls={`${layoutId}-${side === 'resources' ? 'resources' : 'inspector'}`} aria-valuemin={WORKSPACE_LAYOUT_LIMITS[side].min}
    aria-valuemax={maximumWidth(side)} aria-valuenow={widths[side]} aria-valuetext={`${widths[side]} 像素`}
    tabIndex={active && !narrow && !hidden ? 0 : -1} aria-hidden={narrow || hidden || undefined} data-disabled={hidden || narrow}
    onPointerDown={event => { if (!hidden) startResize(event, side) }} onPointerMove={moveResize}
    onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { drag.current = null; setResizing(null) }}
    onKeyDown={event => resizeKey(event, side)}/>

  const panelHeader = (panel: Panel) => <div className="workspace-panel-header">
    <h2>{panel === 'resources' ? resourceLabel : inspectorTitle ?? panelLabels.inspector}</h2>
    <button type="button" ref={element => { closeButtons.current[panel] = element }}
      aria-label={`${narrow ? '关闭' : visible(panel) ? '折叠' : '展开'}${panelLabels[panel]}`} aria-expanded={visible(panel)}
      aria-controls={`${layoutId}-${panel}-content`} onClick={() => togglePanel(panel)}>
      <span aria-hidden="true">{narrow ? '×' : (panel === 'resources') === visible(panel) ? '‹' : '›'}</span>
    </button>
  </div>

  const moduleKey = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (!buttons.length) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (Math.max(0, current) + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    event.stopPropagation()
    buttons[index].focus()
  }

  const renderModule = (module: WorkspaceLayoutProps['modules'][number]) => <button type="button" key={module.id} data-module={module.id} disabled={module.disabled}
    aria-current={activeModule === module.id ? 'page' : undefined} aria-expanded={activeModule === module.id && resourcesVisible}
    aria-controls={`${layoutId}-resources`} onClick={() => selectModule(module.id)}>
    {module.icon && <span aria-hidden="true" className="workspace-module-icon">{module.icon}</span>}
    <span>{module.label}</span>
  </button>

  const toolbarKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
      event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    // The native canvas portals select and pan buttons into this toolbar.
    const toolbar = event.target instanceof Element ? event.target.closest('.workspace-canvas-tools') : null
    if (!toolbar) return
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button:enabled'))
      .filter(button => button.getClientRects().length > 0)
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0 || !buttons.length) return
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    event.preventDefault()
    event.stopPropagation()
    buttons[index].focus()
  }

  const layoutActions = <div className="workspace-layout-actions" aria-label="工作区布局" data-compact={!!layoutControlsTarget}
    onFocusCapture={event => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-layout-panel]')?.dataset.layoutPanel
      focusedLayoutControl.current = panel === 'resources' || panel === 'inspector' ? panel : 'settings'
    }} onBlurCapture={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) focusedLayoutControl.current = null
    }}>
      {panels.map(panel => <button type="button" key={panel}
        data-layout-panel={panel}
        ref={element => { triggers.current[panel] = element }} aria-expanded={visible(panel)} aria-controls={`${layoutId}-${panel}`}
        aria-label={panelLabels[panel]} title={panelLabels[panel]} onClick={() => togglePanel(panel)}>
        {panel === 'resources' ? <PanelLeft size={16} aria-hidden="true"/> : <PanelRight size={16} aria-hidden="true"/>}<span>{panelLabels[panel]}</span></button>)}
      <span className="workspace-layout-spacer"/>
      <details className="workspace-layout-settings" ref={layoutSettings} onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || !event.currentTarget.open) return
        event.preventDefault(); event.stopPropagation()
        closeLayoutSettings()
      }}>
        <summary aria-label="布局设置" title="布局设置"><Columns3 size={16} aria-hidden="true"/><span>布局设置</span></summary>
        <div aria-label="面板布局设置">
          <button type="button" onClick={() => { setPreferences(current => ({ ...current, resourcesCollapsed: false, inspectorCollapsed: false })); closeDrawer(false); closeLayoutSettings() }}>展开全部面板</button>
          <button type="button" onClick={() => { setPreferences({ ...DEFAULT_WORKSPACE_LAYOUT }); closeDrawer(false); closeLayoutSettings() }}>重置布局</button>
        </div>
      </details>
      {!persistent && <span className="workspace-layout-storage" role="status">布局仅在本次会话生效</span>}
    </div>
  const style = { '--workspace-resources-width': `${widths.resources}px`, '--workspace-details-width': `${widths.details}px` } as CSSProperties
  return <div className="workspace-layout" ref={host} style={style} data-testid="workspace-layout" data-narrow={narrow}
    data-compact={compact} data-map-options-open={compact && mapOptionsOpen}
    data-resizing={resizing ?? undefined} onKeyDown={drawerKey} onFocusCapture={event => {
      const target = event.target as HTMLElement
      lastPanelFocus.current = panels.some(panel => panelRef(panel).current?.contains(target)) ? target : null
    }}>
    {layoutControlsTarget ? createPortal(layoutActions, layoutControlsTarget) : layoutActions}
    <div className="workspace-layout-body">
      <nav ref={moduleNavigation} className="workspace-module-navigation" data-testid="workspace-module-navigation" aria-label="工作区模块导航" onKeyDown={moduleKey}>
        <div className="workspace-module-group workspace-module-workflow" role="group" aria-label="创作流程">
          {modules.filter(module => module.group !== 'utility').map(renderModule)}
        </div>
        {modules.some(module => module.group === 'utility') && <div className="workspace-module-group workspace-module-utility" role="group" aria-label="全程工具">
          {modules.filter(module => module.group === 'utility').map(renderModule)}
        </div>}
      </nav>
      <section id={`${layoutId}-resources`} ref={resourcePanel} className="workspace-panel workspace-resources" data-testid="workspace-resources"
        aria-label={resourceLabel} data-open={resourcesVisible} data-collapsed={!resourcesVisible}
        inert={narrow && !resourcesVisible} aria-hidden={narrow && !resourcesVisible || undefined}>
        {panelHeader('resources')}
        <div ref={resourceBody} id={`${layoutId}-resources-content`} className="workspace-panel-body" hidden={!resourcesVisible} inert={!resourcesVisible}
          onScroll={event => { if (resourcesVisible) moduleScroll.current.set(activeModule, event.currentTarget.scrollTop) }}>{resources}</div>
      </section>
      {renderSeparator('resources', preferences.resourcesCollapsed)}
      <section className="workspace-canvas" aria-label="场景画布" onKeyDown={event => {
        if (event.key === 'Escape') mapOptionsKey(event)
        else toolbarKey(event)
      }} onBlur={event => {
        if (mapOptionsOpen && isMapOptionsTarget(event.target) && !isMapOptionsTarget(event.relatedTarget)) setMapOptionsOpen(false)
      }}>
        <div className="workspace-canvas-tools" role="toolbar" aria-label="画布工具">
          {tools}
          <button type="button" ref={mapOptionsTrigger} className="workspace-map-options-trigger" hidden={!compact}
            aria-label="地图选项" title="地图选项" aria-expanded={mapOptionsOpen} onClick={toggleMapOptions}>
            <SlidersHorizontal size={14} aria-hidden="true"/><span>选项</span>
          </button>
        </div>
        {children}
      </section>
      {renderSeparator('details', preferences.inspectorCollapsed)}
      <section id={`${layoutId}-inspector`} ref={inspectorPanel} className="workspace-panel workspace-inspector" data-testid="workspace-inspector"
        aria-label={`${inspectorTitle ?? panelLabels.inspector}面板`} data-open={visible('inspector')} data-collapsed={!visible('inspector')}
        inert={narrow && !visible('inspector')} aria-hidden={narrow && !visible('inspector') || undefined}>
        {panelHeader('inspector')}
        <div id={`${layoutId}-inspector-content`} className="workspace-panel-body" hidden={!visible('inspector')} inert={!visible('inspector')}>{inspector}</div>
      </section>
    </div>
    <footer className="workspace-footer">{footer}</footer>
  </div>
}
