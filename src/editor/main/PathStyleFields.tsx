import { useEffect, useRef } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import { DEFAULT_BRIDGE_RELIEF, DEFAULT_BRIDGE_STRUCTURE, DEFAULT_FIXTURE_GLOW, type BridgeStructure, type PathAssemblyRecipe, type PathStyleDefaults, type PathStyleSource } from '../../shared/path-assembly/contracts'
import { LINE_PROFILE_IDS, LINE_PROFILES, type BridgeArt, type LineProfile } from '../../shared/path-assembly/profiles'
import { minimumPathSectionLength, profilePathSection, propDefinitionSection, standardPathSection } from '../../shared/path-assembly/layout'
import { sectionWidths } from '../../shared/path-assembly/fitted-layout'
import { drawBridgeSymbol } from '../../platform/browser/render/path-assembly'
import { NumberInput } from '../native-canvas/controls'

export type StyleForm = { source: string; defaults: PathStyleDefaults }
export const fixedPathProps = (scene: SceneDocument) => Object.values(scene.propDefinitions).filter(item => !item.tags.some(tag => tag.startsWith('sceneweave:')))
export const sectionOption = (section: PathAssemblyRecipe['section']): string => 'ref' in section ? `${section.kind}:${section.ref.id}`
  : section.kind === 'profile' ? `profile:${section.profile}` : section.kind

export function readPathSection(scene: SceneDocument, value: string, lengthMm: number): PathAssemblyRecipe['section'] {
  if (value === 'none') return { kind: 'none' }
  if (value === 'steel' || value === 'timber') return { kind: value, lengthMm }
  const separator = value.indexOf(':'), kind = value.slice(0, separator), id = value.slice(separator + 1)
  if (kind === 'profile' && Object.hasOwn(LINE_PROFILES, id)) return { kind, profile: id as LineProfile, lengthMm }
  const definition = kind === 'prefab' ? scene.prefabDefinitions[id] : kind === 'prop' ? scene.propDefinitions[id] : undefined
  if (!definition) throw new Error('请选择工程内已采用的一节构件。')
  return { kind: kind === 'prefab' ? 'prefab' : 'prop', ref: { id: definition.id, version: definition.version }, lengthMm }
}

export function templateParts(scene: SceneDocument, section: PathStyleSource) {
  if (section.kind === 'prefab') return scene.prefabDefinitions[section.ref.id].members
  const propTemplate = section.kind === 'profile' ? profilePathSection(section.profile, section.lengthMm)
    : section.kind === 'prop' ? propDefinitionSection(scene.propDefinitions[section.ref.id]) : standardPathSection(section.kind, section.lengthMm)
  return [{ key: 'body', propTemplate }]
}

export function styleDefaults(scene: SceneDocument, source: string): PathStyleDefaults {
  const section = readPathSection(scene, source, 2000)
  if (section.kind === 'none' || section.kind === 'steel') return { lengthMm: 2000 }
  if (section.kind === 'timber') return { lengthMm: 1600 }
  if (section.kind === 'profile') return { lengthMm: LINE_PROFILES[section.profile].pitchMm, fit: true,
    ...(section.profile === 'boxGirder' && { structure: DEFAULT_BRIDGE_STRUCTURE }) }
  const fixed = section.kind === 'prefab' ? scene.prefabDefinitions[section.ref.id].pathStyle : undefined
  return fixed ?? { lengthMm: minimumPathSectionLength(templateParts(scene, section).map(part => part.propTemplate)) }
}

export function StyleSourceSelect({ scene, value, onChange, allowEmpty = false }: { scene: SceneDocument; value: string; onChange: (value: string) => void; allowEmpty?: boolean }) {
  const definitions = Object.values(scene.prefabDefinitions), styles = definitions.filter(item => item.pathStyle)
  const prefabs = definitions.filter(item => !item.pathStyle), props = fixedPathProps(scene)
  return <label>重复源节<select aria-label="重复源节" value={value} onChange={event => onChange(event.target.value)}>
    {allowEmpty && <option value="none">空边</option>}
    <optgroup label="内置沿线样式">{LINE_PROFILE_IDS.map(id => <option key={id} value={`profile:${id}`}>{LINE_PROFILES[id].name}</option>)}</optgroup>
    {styles.length > 0 && <optgroup label="工程沿线样式">{styles.map(item => <option key={item.id} value={'prefab:' + item.id}>{item.name} · v{item.version}</option>)}</optgroup>}
    <optgroup label="经典桥边"><option value="steel">工业金属边梁</option><option value="timber">木护栏</option></optgroup>
    {prefabs.length > 0 && <optgroup label="固定组合">{prefabs.map(item => <option key={item.id} value={'prefab:' + item.id}>{item.name}</option>)}</optgroup>}
    {props.length > 0 && <optgroup label="工程内物件">{props.map(item => <option key={item.id} value={'prop:' + item.id}>{item.name}</option>)}</optgroup>}
  </select></label>
}

export function SourcePreview({ art, length, width, detail }: { art: BridgeArt; length: number; width: number; detail?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx || width <= 0 || length <= 0 || detail !== undefined && detail < 1) return
    ctx.clearRect(0, 0, 560, 128)
    const scale = Math.min(480 / length, 96 / width)
    drawBridgeSymbol(ctx, art, { x: (560 - length * scale) / 2, y: (128 - width * scale) / 2, width: length * scale, height: width * scale }, detail)
  }, [art, length, width, detail])
  return <canvas ref={ref} className="line-style-preview" width={560} height={128} role="img" aria-label="源节俯视预览"/>
}

function BridgeStructureFields({ unit, structure, onChange }: { unit: SceneDocument['units']['display']; structure?: BridgeStructure; onChange: (structure?: BridgeStructure) => void }) {
  const corner = structure?.corner, bridgehead = structure?.bridgehead
  return <details className="outdoor-advanced">
    <summary>工业桥构件</summary>
    <label className="asset-check"><input type="checkbox" checked={!!structure} onChange={event => onChange(event.target.checked ? DEFAULT_BRIDGE_STRUCTURE : undefined)}/>启用周期支座、转角与桥头</label>
    {structure && <>
      <label>构件外观<select aria-label="工业桥构件外观" value={structure.palette} onChange={event => onChange({ ...structure, palette: event.target.value as BridgeStructure['palette'] })}>
        <option value="riveted">铆接钢构</option><option value="alloy">青光合金</option>
      </select></label>
      <div className="workspace-form-pair">
        <NumberInput label="支座间距" value={structure.support.spacingMm} displayUnit={unit} onCommit={spacingMm => onChange({ ...structure, support: { ...structure.support, spacingMm } })}/>
        <NumberInput label="支座长度" value={structure.support.lengthMm} displayUnit={unit} onCommit={lengthMm => onChange({ ...structure, support: { ...structure.support, lengthMm } })}/>
        <NumberInput label="支座外观宽度" value={structure.support.visualWidthMm} displayUnit={unit} onCommit={visualWidthMm => onChange({ ...structure, support: { ...structure.support, visualWidthMm } })}/>
        <NumberInput label="支座占地宽度" value={structure.support.footprintWidthMm} displayUnit={unit} onCommit={footprintWidthMm => onChange({ ...structure, support: { ...structure.support, footprintWidthMm } })}/>
      </div>
      <label className="asset-check"><input type="checkbox" checked={!!structure.corner} onChange={event => onChange({ ...structure, corner: event.target.checked ? DEFAULT_BRIDGE_STRUCTURE.corner : undefined })}/>接合处添加转角件</label>
      {corner && <div className="workspace-form-pair">
        <NumberInput label="转角件长度" value={corner.lengthMm} displayUnit={unit} onCommit={lengthMm => onChange({ ...structure, corner: { ...corner, lengthMm } })}/>
        <NumberInput label="转角件外观宽度" value={corner.visualWidthMm} displayUnit={unit} onCommit={visualWidthMm => onChange({ ...structure, corner: { ...corner, visualWidthMm } })}/>
        <NumberInput label="转角件占地宽度" value={corner.footprintWidthMm} displayUnit={unit} onCommit={footprintWidthMm => onChange({ ...structure, corner: { ...corner, footprintWidthMm } })}/>
      </div>}
      <label>桥头搭接位置<select aria-label="桥头搭接位置" value={structure.bridgehead?.ends ?? ''} onChange={event => {
        const ends = event.target.value as '' | NonNullable<BridgeStructure['bridgehead']>['ends']
        onChange({ ...structure, bridgehead: ends ? { ...(structure.bridgehead ?? DEFAULT_BRIDGE_STRUCTURE.bridgehead), ends } : undefined })
      }}><option value="">关闭</option><option value="both">两端</option><option value="start">起点</option><option value="end">终点</option></select></label>
      {bridgehead && <div className="workspace-form-pair">
        <NumberInput label="桥头搭接长度" value={bridgehead.lengthMm} displayUnit={unit} onCommit={lengthMm => onChange({ ...structure, bridgehead: { ...bridgehead, lengthMm } })}/>
        <NumberInput label="桥头单侧加宽" value={bridgehead.wideningMm} displayUnit={unit} onCommit={wideningMm => onChange({ ...structure, bridgehead: { ...bridgehead, wideningMm } })}/>
      </div>}
      <label className="asset-check"><input type="checkbox" checked={!!structure.relief}
        onChange={event => onChange({ ...structure, relief: event.target.checked ? DEFAULT_BRIDGE_RELIEF : undefined })}/>显示梁腹和下层投影</label>
      {structure.relief && <div className="workspace-form-pair">
        <NumberInput label="梁腹显示厚度" value={structure.relief.depthMm} displayUnit={unit}
          onCommit={depthMm => onChange({ ...structure, relief: { ...structure.relief!, depthMm } })}/>
        <label>下层投影强度<input aria-label="下层投影强度" type="number" min={0} max={.85} step={.05}
          value={structure.relief.shadowOpacity} onChange={event => onChange({ ...structure, relief: { ...structure.relief!, shadowOpacity: Number(event.target.value) } })}/></label>
      </div>}
      <small>桥头可搭接同高平台。梁腹厚度影响出图，下层投影随楼层光照方向变化。</small>
    </>}
  </details>
}

export function PathStyleFields({ scene, form, onChange, allowStructure = false }: { scene: SceneDocument; form: StyleForm; onChange: (value: StyleForm) => void; allowStructure?: boolean }) {
  const { source, defaults } = form, { lengthMm, dimensions, lamps, fit } = defaults
  const section = readPathSection(scene, source, lengthMm)
  const structure = allowStructure && section.kind !== 'none' ? defaults.structure : undefined
  const parts = section.kind === 'none' ? [] : templateParts(scene, section)
  const widths = parts.length ? sectionWidths(parts) : undefined
  const art = parts.length === 1 && parts[0].propTemplate.appearance.kind === 'symbol' ? parts[0].propTemplate.appearance.bridgeArt : undefined
  const detail = parts.some(({ propTemplate: item }) => item.appearance.kind === 'symbol' && item.appearance.bridgeArt && item.appearance.bridgeArt !== 'lamp')
  const set = (value: Partial<PathStyleDefaults>) => onChange({ source, defaults: { ...defaults, ...value } })
  const dimension = (fields: NonNullable<PathStyleDefaults['dimensions']>) => set({ dimensions: { ...dimensions, ...fields } })
  const lamp = lamps?.ref?.id ?? (lamps ? 'default' : '')
  return <>
    {art && widths && lengthMm > 0 && <SourcePreview art={art} length={lengthMm} width={dimensions?.visualWidthMm ?? widths.visualWidthMm} detail={dimensions?.detailPercent}/>}
    {widths && <>
      <NumberInput label="源节长度" ariaLabel="源节长度" value={lengthMm} displayUnit={scene.units.display} onCommit={value => set({ lengthMm: value })}/>
      <div className="workspace-form-pair">
        <NumberInput label="外观横向宽度" value={dimensions?.visualWidthMm ?? widths.visualWidthMm} displayUnit={scene.units.display} onCommit={visualWidthMm => dimension({ visualWidthMm })}/>
        <NumberInput label="实际占地宽度" value={dimensions?.footprintWidthMm ?? widths.footprintWidthMm} displayUnit={scene.units.display} onCommit={footprintWidthMm => dimension({ footprintWidthMm })}/>
      </div>
      {detail && <label>细节粗细 %<input aria-label="细节粗细" type="number" min={35} max={180} step={1} value={dimensions?.detailPercent ?? 100} onChange={event => dimension({ detailPercent: Number(event.target.value) })}/></label>}
      {section.kind !== 'profile' && <label className="asset-check"><input type="checkbox" checked={!!fit || !!structure} disabled={!!structure} onChange={event => set({ fit: event.target.checked ? true : undefined })}/>接合铺设 · 按转角和端点调整各节长度</label>}
      {dimensions && <button type="button" className="secondary asset-wide" onClick={() => set({ dimensions: undefined })}>恢复源节尺寸</button>}
      <small>占地宽度参与支撑和通行检查。源节沿绘制方向排布，双侧铺设会镜像。</small>
    </>}
    {allowStructure && section.kind !== 'none' && <BridgeStructureFields unit={scene.units.display} structure={structure} onChange={value => set({ structure: value })}/>}
    <label>沿线灯具<select aria-label="沿线灯具" value={lamp} onChange={event => {
      const value = event.target.value, definition = scene.propDefinitions[value]
      set({ lamps: value ? { every: lamps?.every ?? 3, ...(lamps?.glow && { glow: lamps.glow }), ...(definition ? { ref: { id: definition.id, version: definition.version } } : {}) } : undefined })
    }}><option value="">关闭</option><option value="default">{structure ? '琥珀节点灯' : '琥珀小灯'}</option>
      {fixedPathProps(scene).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {lamps && <>
      <label>{structure ? '每隔几处支座放灯' : '每隔几节放灯'}<input aria-label={structure ? '每隔几处支座放灯' : '每隔几节放灯'} type="number" min={1} max={64} step={1} value={lamps.every} onChange={event => set({ lamps: { ...lamps, every: Number(event.target.value) } })}/></label>
      <label className="asset-check"><input type="checkbox" checked={!!lamps.glow}
        onChange={event => {
          const { glow, ...placement } = lamps
          set({ lamps: event.target.checked ? { ...placement, glow: DEFAULT_FIXTURE_GLOW } : placement })
        }}/>沿线灯具照地</label>
      <small>这些参数是整条线的默认值。各灯可在物件照光中单独调整。</small>
      {lamps.glow && <>
        <div className="workspace-form-pair">
          <label>照地颜色<input type="color" value={lamps.glow.color} onChange={event => set({ lamps: { ...lamps, glow: { ...lamps.glow!, color: event.target.value } } })}/></label>
          <NumberInput label="照地半径" value={lamps.glow.radiusMm} displayUnit={scene.units.display}
            onCommit={radiusMm => set({ lamps: { ...lamps, glow: { ...lamps.glow!, radiusMm } } })}/>
        </div>
        <label>照地强度<input type="number" min={0} max={2} step={.05} value={lamps.glow.intensity}
          onChange={event => set({ lamps: { ...lamps, glow: { ...lamps.glow!, intensity: Number(event.target.value) } } })}/></label>
      </>}
    </>}
  </>
}

export function appliedStyle(scene: SceneDocument, form: StyleForm, allowStructure = false) {
  const { lengthMm, dimensions, lamps, fit, structure } = form.defaults
  const section = readPathSection(scene, form.source, lengthMm)
  const bridge = structure && { palette: structure.palette, support: structure.support,
    ...(structure.relief ? { relief: structure.relief } : {}),
    ...(structure.corner ? { corner: structure.corner } : {}), ...(structure.bridgehead ? { bridgehead: structure.bridgehead } : {}) }
  return { section, ...(dimensions && section.kind !== 'none' ? { dimensions } : {}), ...(fit && section.kind !== 'none' ? { fit } : {}),
    ...(lamps ? { lamps } : {}), ...(allowStructure && bridge && section.kind !== 'none' ? { structure: bridge } : {}) }
}
