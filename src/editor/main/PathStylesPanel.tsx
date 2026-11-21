import { useState } from 'react'
import type { CompositionCommand } from '../../shared/model/appearance'
import type { SceneCommand } from '../../shared/commands/commands'
import type { Path, SceneDocument } from '../../shared/model/scene'
import type { PathAssemblyRecipe } from '../../shared/path-assembly/contracts'
import { fenceRoutePoints, sectionWidths } from '../../shared/path-assembly/fitted-layout'
import { LINE_PROFILES } from '../../shared/path-assembly/profiles'
import { visualBase } from '../../shared/visual/base'
import type { VisualBoundary } from '../../shared/visual/types'
import { appliedStyle, PathStyleFields, styleDefaults, StyleSourceSelect, templateParts, type StyleForm } from './PathStyleFields'

type Route = { id: string; label: string; locked: boolean } & ({ path: Path } | { fence: VisualBoundary })
interface Props {
  scene: SceneDocument
  disabled: boolean
  onPublish: (commands: CompositionCommand[], description: string) => void
  onReplace: (commands: SceneCommand[], description: string) => void
}

function routeStyleName(scene: SceneDocument, section: PathAssemblyRecipe['section']) {
  switch (section.kind) {
    case 'none': return '空边'
    case 'steel': return '工业金属边梁'
    case 'timber': return '木护栏'
    case 'profile': return LINE_PROFILES[section.profile].name
    case 'prop': return scene.propDefinitions[section.ref.id].name
    case 'prefab': return `${scene.prefabDefinitions[section.ref.id].name} · v${section.ref.version}`
  }
}

function routeEntries(scene: SceneDocument): Route[] {
  const paths = Object.values(scene.paths).filter(path => path.assembly)
  const fences = Object.values(visualBase(scene)?.boundaries ?? {}).filter(boundary => boundary.fence)
  return [
    ...paths.map((path, index) => ({ id: path.id, path,
      label: `${scene.floors[path.floorId].name} · ${path.assembly!.bridge ? '桥梁' : '道路'} ${index + 1} · ${routeStyleName(scene, path.assembly!.recipe.section)}`,
      locked: path.editLocked || !!scene.userLayers[scene.entityLayers[path.id]]?.editLocked })),
    ...fences.map((fence, index) => ({ id: fence.id, fence,
      label: `${scene.floors[fence.floorId].name} · 围栏 ${index + 1} · ${routeStyleName(scene, fence.fence!.recipe.section)}`,
      locked: fence.editLocked || !!scene.userLayers[fence.layerId]?.editLocked })),
  ]
}

export default function PathStylesPanel({ scene, disabled, onPublish, onReplace }: Props) {
  const styles = Object.values(scene.prefabDefinitions).filter(item => item.pathStyle)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh') || b.version - a.version)
  const [series, setSeries] = useState(''), [name, setName] = useState('')
  const [form, setForm] = useState<StyleForm>(() => ({ source: 'profile:boxGirder', defaults: styleDefaults(scene, 'profile:boxGirder') }))
  const [replacement, setReplacement] = useState('profile:industrialSteel'), [useDefaults, setUseDefaults] = useState(false)
  const [selected, setSelected] = useState<string[]>([]), [error, setError] = useState('')
  const routes = routeEntries(scene), chosen = routes.filter(row => !row.locked && selected.includes(row.id))
  const updateSeries = (id: string) => {
    setSeries(id)
    if (!id) return
    const style = scene.prefabDefinitions[id]
    setName(style.name)
    setForm({ source: `prefab:${style.id}`, defaults: style.pathStyle! })
  }
  const publish = () => {
    try {
      setError('')
      const { section, ...defaults } = appliedStyle(scene, form, true)
      if (section.kind === 'none') throw new Error('请选择一节构件。')
      const previous = styles.find(item => item.id === series)
      onPublish([{ type: 'publishPathStyle', id: 'line-style-' + crypto.randomUUID(), name, source: section,
        defaults: { lengthMm: form.defaults.lengthMm, ...defaults }, ...(previous ? { previousRef: { id: previous.id, version: previous.version } } : {}) }],
      previous ? `发布沿线样式新版 · ${name.trim()}` : `新建沿线样式 · ${name.trim()}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const replace = () => {
    try {
      setError('')
      const target = styleDefaults(scene, replacement)
      const commands: SceneCommand[] = chosen.map(row => {
        const assembly = 'path' in row ? row.path.assembly! : row.fence.fence!
        const prior = assembly.recipe, source = prior.section
        const priorStructure = 'path' in row ? row.path.assembly?.recipe.structure : undefined
        const structure = priorStructure && target.structure ? { ...priorStructure, palette: target.structure.palette } : priorStructure ?? target.structure
        const bridge = 'path' in row ? row.path.assembly?.bridge : undefined
        const previousWidths = !useDefaults && source.kind !== 'none' ? sectionWidths(templateParts(scene, source)) : undefined
        const defaults = useDefaults ? target : { lengthMm: 'lengthMm' in source ? source.lengthMm : target.lengthMm,
          dimensions: previousWidths ? { ...previousWidths, ...prior.dimensions } : prior.dimensions, fit: target.fit, lamps: prior.lamps, structure }
        const recipe = { ...appliedStyle(scene, { source: replacement, defaults }, !!bridge), endClearanceMm: prior.endClearanceMm,
          ...(prior.gaps ? { gaps: prior.gaps } : {}) }
        if ('fence' in row) return { type: 'setFenceAssembly', id: row.id, floorId: row.fence.floorId, layerId: row.fence.layerId,
          centerlineMm: fenceRoutePoints(row.fence), closed: row.fence.closed, visibility: row.fence.visibility, recipe }
        const { path } = row
        return { type: 'setPathAssembly', id: path.id, floorId: path.floorId, layerId: scene.entityLayers[path.id],
          centerlineMm: path.centerlineMm, widthMm: path.widthMm, recipe: { ...recipe, sides: path.assembly!.recipe.sides, shoulderMm: path.assembly!.recipe.shoulderMm },
          ...(bridge ? { bridge: { finish: bridge.finish, elevationMm: bridge.elevationMm, visibility: bridge.visibility } } : {}) }
      })
      onReplace(commands, `更换 ${chosen.length} 条路线的构件样式 · ${routeStyleName(scene, appliedStyle(scene, { source: replacement, defaults: target }).section)}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <fieldset disabled={disabled} className="line-style-manager">
    <details className="outdoor-advanced" open>
      <summary>维护样式版本</summary>
      <label>样式系列<select aria-label="样式系列" value={series} onChange={event => updateSeries(event.target.value)}>
        <option value="">新建样式</option>{styles.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
      </select></label>
      <label>样式名称<input aria-label="样式名称" value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
      <StyleSourceSelect scene={scene} value={form.source} onChange={source => setForm({ source, defaults: styleDefaults(scene, source) })}/>
      <PathStyleFields scene={scene} form={form} onChange={setForm} allowStructure/>
      <button type="button" className="primary asset-wide" disabled={!name.trim()} onClick={publish}>{series ? '预览发布新版' : '预览新建样式'}</button>
      <small>样式随工程保存。可在素材库的工程素材中将它保存到个人库，供另一工程采用。已绘制路线使用当时采用的版本。</small>
    </details>
    <details className="outdoor-advanced">
      <summary>批量更换工程中的沿线样式</summary>
      <StyleSourceSelect scene={scene} value={replacement} onChange={setReplacement}/>
      <label className="asset-check"><input type="checkbox" checked={useDefaults} onChange={event => setUseDefaults(event.target.checked)}/>采用新样式的默认尺寸、节距和灯具</label>
      <small>路线、净宽和留口会保留。预览将复核各条路线的承托和占地。</small>
      {routes.length > 0 && <>
        <button type="button" className="secondary asset-wide" onClick={() => setSelected(chosen.length ? [] : routes.filter(row => !row.locked).map(row => row.id))}>{chosen.length ? '取消所有选中' : '选择全部可编辑路线'}</button>
        <div className="line-style-routes">{routes.map(row => <label key={row.id} className="asset-check"><input type="checkbox" disabled={row.locked}
          checked={selected.includes(row.id) && !row.locked} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))}/>{row.label}{row.locked ? ' · 已锁定' : ''}</label>)}</div>
      </>}
      {!routes.length && <p className="asset-muted">工程中还没有沿线构件。</p>}
      <button type="button" className="primary asset-wide" disabled={!chosen.length} onClick={replace}>预览批量更换 · {chosen.length} 条</button>
    </details>
    {error && <p role="alert" className="asset-form-error">{error}</p>}
  </fieldset>
}
