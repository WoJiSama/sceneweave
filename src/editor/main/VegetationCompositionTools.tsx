import { useState } from 'react'
import type { SceneDocument } from '../../shared/model/scene'
import type { AppearanceGraph } from '../../shared/model/appearance'
import type { SceneCommand } from '../../shared/commands/commands'
import { buildVegetationCompositionPlan, VEGETATION_COMPOSITION_CHANNELS, type VegetationCompositionChannel, type VegetationCompositionRequest } from '../../shared/vegetation/composition-plan'
import OutdoorCoordinates from './OutdoorCoordinates'
import { outdoorPoints } from './outdoor-coordinates'
import { NumberInput } from '../native-canvas/controls'
import { newId } from './runtime'
import { createEntityLabeler } from './entity-label'

const labels: Record<VegetationCompositionChannel, string> = { mainTrees: '主树群', secondaryTrees: '次树与林缘', shrubs: '灌木与蕨', grass: '草簇' }
const initialCells = { mainTrees: 3200, secondaryTrees: 4200, shrubs: 2400, grass: 1800 }
export default function VegetationCompositionTools({ scene, appearance, layerId, disabled, onPreview, onDraftChange }: {
  scene: SceneDocument; appearance: AppearanceGraph; layerId: string; disabled: boolean
  onPreview: (commands: SceneCommand[], label: string) => void; onDraftChange: () => void
}) {
  const floorId = scene.userLayers[layerId]?.floorId, name = createEntityLabeler(scene)
  const [areaId, setAreaId] = useState(''), [seed, setSeed] = useState('woodland-community-1'), [density, setDensity] = useState(.35)
  const [enabled, setEnabled] = useState<Record<VegetationCompositionChannel, boolean>>({ mainTrees: true, secondaryTrees: false, shrubs: false, grass: false })
  const [definitions, setDefinitions] = useState<Record<VegetationCompositionChannel, string>>({ mainTrees: '', secondaryTrees: '', shrubs: '', grass: '' })
  const [cells, setCells] = useState(initialCells), [spacing, setSpacing] = useState(350), [clearance, setClearance] = useState(250)
  const [clearing, setClearing] = useState(''), [avoid, setAvoid] = useState<string[]>([]), [error, setError] = useState('')
  const avoidances = [
    ...Object.values(scene.rooms).filter(row => row.floorId === floorId && row.visibility === 'public').map(row => ({ ref: { kind: 'room' as const, id: row.id }, label: `房间 · ${name(row.id)}` })),
    ...Object.values(scene.paths).filter(row => row.floorId === floorId && row.visibility === 'public').map(row => ({ ref: { kind: 'path' as const, id: row.id }, label: `道路 · ${name(row.id)}` })),
    ...Object.values(scene.props).filter(row => row.floorId === floorId && row.visibility === 'public').map(row => ({ ref: { kind: 'prop' as const, id: row.id }, label: `物件 · ${name(row.id)}` })),
  ]
  const run = () => {
    try {
      setError('')
      if (!floorId || !scene.terrainAreas[areaId]) throw new Error('请明确选择当前楼层的适植地形与目标图层。')
      const channels = Object.fromEntries(VEGETATION_COMPOSITION_CHANNELS.map(key => {
        if (!enabled[key]) return [key, { enabled: false }]
        const definition = scene.propDefinitions[definitions[key]]
        if (!definition) throw new Error(`请明确选择${labels[key]}使用的已采用固定素材。`)
        return [key, { enabled: true, palette: [{ key: definition.id, propDefinitionRef: { id: definition.id, version: definition.version }, weight: 1 }],
          densityFactor: density, cellSizeMm: cells[key], minDistanceMm: spacing }]
      })) as VegetationCompositionRequest['channels']
      const chosen = avoidances.filter(row => avoid.includes(JSON.stringify(row.ref)))
      const plan = buildVegetationCompositionPlan(scene, { version: 1, operationId: newId(), floorId, areaId, layerId, visibility: 'public', seed, channels,
        clearings: clearing.trim() ? [{ boundaryMm: outdoorPoints(clearing), footprintMarginMm: clearance, paintMarginMm: clearance }] : [],
        avoidances: chosen.map(row => ({ ref: row.ref, footprintMarginMm: clearance, paintMarginMm: clearance })) },
      { appearance, ids: { nextId: newId }, clock: { now: () => scene.updatedAt } })
      const activeChannels = plan.channelSummary.filter(channel => channel.groupId)
      const counts = activeChannels.map(channel => `${labels[channel.key]}：${channel.createdMembers} 件${channel.createdMembers === 0 ? '（本次未生成）' : ''}`).join('；')
      onPreview(plan.commands, `植被群落 · 本次新增 ${activeChannels.reduce((sum, channel) => sum + channel.createdMembers, 0)} 件 · ${activeChannels.length} 组；${counts}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  return <details className="workspace-advanced"><summary>植被群落编排 · 主树、林缘与草灌</summary>
    <section aria-label="植被群落编排" onChangeCapture={onDraftChange}>
      <p className="asset-muted">在明确地形上新建可分别调整的散布组。选择素材、疏密和活动空地后预览实际成员；已有物件、散布及人工记录保持。树冠与根部占地分别避让，重开不重撒。</p>
      <fieldset disabled={disabled}>
        <label>适植地形<select aria-label="群落适植地形" value={areaId} onChange={e => setAreaId(e.target.value)}><option value="">明确选择地形</option>{Object.values(scene.terrainAreas).filter(row => row.floorId === floorId && row.visibility === 'public' && !row.blocksMovement).map(row => <option key={row.id} value={row.id}>{name(row.id)}</option>)}</select></label>
        {VEGETATION_COMPOSITION_CHANNELS.map(key => <fieldset key={key}><legend><label><input aria-label={`启用${labels[key]}`} type="checkbox" checked={enabled[key]} onChange={e => setEnabled({ ...enabled, [key]: e.target.checked })}/>{labels[key]}</label></legend>
          {enabled[key] && <><label>固定素材<select aria-label={`${labels[key]}素材`} value={definitions[key]} onChange={e => setDefinitions({ ...definitions, [key]: e.target.value })}><option value="">明确选择素材</option>{Object.values(scene.propDefinitions).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><NumberInput label="采样间隔" ariaLabel={`${labels[key]}采样间隔`} displayUnit={scene.units.display} value={cells[key]} onCommit={value => setCells({ ...cells, [key]: value })}/></>}
        </fieldset>)}
        <label>密度倍率<input aria-label="群落密度倍率" type="number" min="0" max="1" step=".05" value={density} onChange={e => setDensity(Number(e.target.value))}/></label>
        <label>种子<input aria-label="群落编排种子" value={seed} onChange={e => setSeed(e.target.value)}/></label>
        <NumberInput label="物件最小间距" ariaLabel="群落最小间距" displayUnit={scene.units.display} value={spacing} onCommit={setSpacing}/>
        <NumberInput label="避让余量" ariaLabel="群落避让余量" displayUnit={scene.units.display} value={clearance} onCommit={setClearance}/>
        <label>明确避让的房屋、道路与物件<select multiple aria-label="群落明确避让" value={avoid} onChange={e => setAvoid([...e.target.selectedOptions].map(row => row.value))}>{avoidances.map(row => <option key={JSON.stringify(row.ref)} value={JSON.stringify(row.ref)}>{row.label}</option>)}</select></label>
        <p className="asset-muted">按住 Ctrl／⌘ 可多选。避让读取所选对象的真实几何与支撑；已锁定的明确依赖须先单独处理。</p>
        <OutdoorCoordinates text={clearing} onChange={setClearing} label="活动空地（可留空）" ariaLabel="群落活动空地坐标" unit={scene.units.display}/>
        <button type="button" className="primary asset-wide" disabled={!areaId || !VEGETATION_COMPOSITION_CHANNELS.some(key => enabled[key])} onClick={run}>预览植被群落编排</button>
      </fieldset>
      {error && <p role="alert" className="asset-form-error">{error}</p>}
    </section>
  </details>
}
