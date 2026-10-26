import type { AuthoringEvidenceCheck } from '../../shared/ai/plan'
import type { ProjectData } from '../../shared/model/project'
import type { BoundsMm } from '../../shared/model/scene'

type Kind = AuthoringEvidenceCheck['kind']
const names: Record<Kind, string> = { clearArea: '活动区净空', propCount: '物件数量与分组', elevationConnection: '高差与连接', roomRole: '房间用途与布置', edgeKinds: '连续边带类型' }
const edges = { shore: '海岸', cliff: '崖面', grass: '草沿', path: '道路', fence: '围栏' } as const
const toggle = <T,>(values: T[], item: T, selected: boolean) => selected ? [...values, item] : values.filter(value => value !== item)
function NumberField({ name, value, onChange, min = 0, max }: { name: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <label>{name}<input aria-label={name} type="number" step="1" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))}/></label>
}
function Rectangle({ prefix, value, onChange }: { prefix: string; value: BoundsMm; onChange: (value: BoundsMm) => void }) {
  return <div>{(['x', 'y', 'width', 'height'] as const).map(key => <NumberField key={key} name={`${prefix}${({ x: '左侧X', y: '顶部Y', width: '宽', height: '高' })[key]}（毫米）`} value={value[key]} min={key === 'x' || key === 'y' ? Number.MIN_SAFE_INTEGER : 1} onChange={number => onChange({ ...value, [key]: number })}/>)}</div>
}
interface Props {
  value: AuthoringEvidenceCheck[]
  onChange: (value: AuthoringEvidenceCheck[]) => void
  project: ProjectData
  bounds: BoundsMm
  definitionIds: string[]
  materialIds: string[]
  disabled: boolean
}

/** Explicit, frozen checks only; choosing a check does not grant any scene or asset access. */
export default function AiBriefChecks({ value, onChange, project, bounds, definitionIds, materialIds, disabled }: Props) {
  const scene = project.document, floorId = Object.keys(scene.floors)[0]
  const definitions = definitionIds.flatMap(id => scene.propDefinitions[id] ? [scene.propDefinitions[id]] : [])
  const materials = materialIds.flatMap(id => scene.materials[id] ? [scene.materials[id]] : [])
  const rectangle = { x: bounds.x, y: bounds.y, width: Math.min(6000, bounds.width), height: Math.min(6000, bounds.height) }
  const add = (kind: Kind) => {
    if (value.length >= 16) return
    const common = { id: `check-${crypto.randomUUID()}` }
    let check: AuthoringEvidenceCheck
    switch (kind) {
      case 'clearArea': check = { ...common, kind, floorId, boundsMm: rectangle, minimumWidthMm: Math.min(rectangle.width, rectangle.height), avoidVisual: true }; break
      case 'propCount': check = { ...common, kind, definitionIds: definitions.slice(0, 1).map(item => item.id), minimum: 1 }; break
      case 'elevationConnection': check = { ...common, kind, minimumLevels: 2, minimumDeltaMm: 1000, minimumWidthMm: 1200, connectionKinds: ['stairs', 'ramp'] }; break
      case 'roomRole': check = { ...common, kind, purposeTerms: ['厨房'], definitionIds: definitions.slice(0, 1).map(item => item.id), minimumProps: 1 }; break
      case 'edgeKinds': check = { ...common, kind, kinds: ['shore'] }; break
    }
    onChange([...value, check])
  }
  const update = (index: number, check: AuthoringEvidenceCheck) => onChange(value.map((item, at) => at === index ? check : item))
  return <fieldset disabled={disabled} aria-label="AI 可核对目标">
    <legend>可核对目标（可选，最多16项）</legend>
    <p>只检查已授权公开内容；不会扩大编辑范围。净空不代表全图寻路，结构检查也不代表美术签收。创建任务后这些目标固定。</p>
    <div className="ai-actions">{(Object.keys(names) as Kind[]).map(kind => <button key={kind} disabled={value.length >= 16} onClick={() => add(kind)}>添加{names[kind]}</button>)}</div>
    {value.map((check, index) => <fieldset key={check.id} aria-label={`核对目标 ${index + 1}`}>
      <legend>{index + 1}. {names[check.kind]}</legend>
      <button onClick={() => onChange(value.filter((_, at) => at !== index))}>移除此目标</button>
      {check.kind === 'clearArea' && <>
        <Rectangle prefix="活动区" value={check.boundsMm} onChange={boundsMm => update(index, { ...check, boundsMm })}/>
        <NumberField name="活动区最小净宽（毫米）" value={check.minimumWidthMm} min={1} onChange={minimumWidthMm => update(index, { ...check, minimumWidthMm })}/>
        <label className="ai-check"><input type="checkbox" checked={check.avoidVisual} onChange={event => update(index, { ...check, avoidVisual: event.target.checked })}/>完整图像也须避开活动区</label>
      </>}
      {'definitionIds' in check && <>
        <p>选择已授权物件素材（最多16项）{!definitions.length && '：请先授权本工程素材。'}</p>
        {definitions.map(item => <label className="ai-check" key={item.id}><input type="checkbox" checked={check.definitionIds.includes(item.id)} disabled={!check.definitionIds.includes(item.id) && check.definitionIds.length >= 16} onChange={event => update(index, { ...check, definitionIds: toggle(check.definitionIds, item.id, event.target.checked) })}/>{item.name}</label>)}
        <NumberField name={check.kind === 'propCount' ? '物件最少总数' : '房间内最少物件数'} value={check.kind === 'propCount' ? check.minimum : check.minimumProps} min={1} max={check.kind === 'propCount' ? 64 : 32} onChange={number => update(index, check.kind === 'propCount' ? { ...check, minimum: number } : { ...check, minimumProps: number })}/>
      </>}
      {check.kind === 'propCount' && <>
        <p>可添加互不重叠的分组矩形；每组中的完整图像须位于矩形内。</p>
        <button disabled={(check.groups?.length ?? 0) >= 8} onClick={() => update(index, { ...check, groups: [...(check.groups ?? []), { boundsMm: { ...rectangle }, minimum: 1 }] })}>添加独立分组</button>
        {(check.groups ?? []).map((group, at) => <fieldset key={at}><legend>分组 {at + 1}</legend>
          <Rectangle prefix={`分组${at + 1}`} value={group.boundsMm} onChange={boundsMm => update(index, { ...check, groups: check.groups!.map((item, n) => n === at ? { ...item, boundsMm } : item) })}/>
          <NumberField name={`分组${at + 1}最少物件数`} value={group.minimum} min={1} max={16} onChange={minimum => update(index, { ...check, groups: check.groups!.map((item, n) => n === at ? { ...item, minimum } : item) })}/>
          <button onClick={() => update(index, { ...check, groups: check.groups!.filter((_, n) => n !== at) })}>移除此分组</button>
        </fieldset>)}
      </>}
      {check.kind === 'elevationConnection' && <>
        <NumberField name="最少高程层次" value={check.minimumLevels} min={2} max={8} onChange={minimumLevels => update(index, { ...check, minimumLevels })}/>
        <NumberField name="连接两端最小高差（毫米）" value={check.minimumDeltaMm} min={1} onChange={minimumDeltaMm => update(index, { ...check, minimumDeltaMm })}/>
        <NumberField name="连接最小净宽（毫米）" value={check.minimumWidthMm} min={1} onChange={minimumWidthMm => update(index, { ...check, minimumWidthMm })}/>
        {(['stairs', 'ramp'] as const).map(kind => <label className="ai-check" key={kind}><input type="checkbox" checked={check.connectionKinds.includes(kind)} onChange={event => update(index, { ...check, connectionKinds: toggle(check.connectionKinds, kind, event.target.checked) })}/>{kind === 'stairs' ? '台阶' : '坡道'}</label>)}
      </>}
      {check.kind === 'roomRole' && <>
        <label>房间用途词（每行一个，最多4个，匹配任意一个）<textarea aria-label="核对房间用途词" value={check.purposeTerms.join('\n')} onChange={event => update(index, { ...check, purposeTerms: event.target.value.split('\n') })}/></label>
        <label>房间地面材质<select aria-label="核对房间地面材质" value={check.materialId ?? ''} onChange={event => { const { materialId: _material, ...rest } = check; update(index, event.target.value ? { ...rest, materialId: event.target.value } : rest) }}><option value="">不限定</option>{materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
        <p>匹配的房间须含每种所选素材，并达到最少物件数。</p>
      </>}
      {check.kind === 'edgeKinds' && (Object.keys(edges) as (keyof typeof edges)[]).map(kind => <label className="ai-check" key={kind}><input type="checkbox" checked={check.kinds.includes(kind)} onChange={event => update(index, { ...check, kinds: toggle(check.kinds, kind, event.target.checked) })}/>{edges[kind]}</label>)}
    </fieldset>)}
  </fieldset>
}
