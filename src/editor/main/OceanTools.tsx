import { useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { WATER_PRESETS, type WaterAppearance, type WaterSurface } from '../../shared/ocean/contracts'
import { effectiveEditLocked } from '../../shared/commands/layers'
import { NumberInput } from '../native-canvas/controls'

type Preview = (commands: SceneCommand[], description: string) => void
const presetNames = { calm: '平静远海', shallow: '清澈浅水', rough: '风浪海面' }
function WaterFields({ water, onChange }: { water: WaterSurface; onChange: (value: WaterSurface) => void }) {
  return <>
    <label>水色<input aria-label="水色" type="color" value={water.color} onChange={event => onChange({ ...water, color: event.target.value })}/></label>
    <label>浪花颜色<input aria-label="浪花颜色" type="color" value={water.highlightColor} onChange={event => onChange({ ...water, highlightColor: event.target.value })}/></label>
    <NumberInput label="浪纹间距" value={water.waveSpacingMm} onCommit={waveSpacingMm => onChange({ ...water, waveSpacingMm })}/>
    <NumberInput label="浪纹方向" unit="°" value={water.waveDirectionDeg} onCommit={waveDirectionDeg => onChange({ ...water, waveDirectionDeg })}/>
    <label>浪纹强度<input aria-label="浪纹强度" type="number" min={0} max={1} step={.05} value={water.waveStrength} onChange={event => onChange({ ...water, waveStrength: Number(event.target.value) })}/></label>
    <label>水体清澈度<input aria-label="水体清澈度" type="number" min={0} max={1} step={.05} value={water.clarity} onChange={event => onChange({ ...water, clarity: Number(event.target.value) })}/></label>
  </>
}

export function OceanCreateTools({ scene, layerId, disabled, onPreview }: { scene: SceneDocument; layerId: string; disabled: boolean; onPreview: Preview }) {
  const [preset, setPreset] = useState<keyof typeof WATER_PRESETS>('calm')
  const floor = scene.floors[scene.userLayers[layerId]?.floorId]
  return <details className="workspace-detail-disclosure" aria-label="海洋成图"><summary>海面与浪纹</summary>
    <p className="asset-muted">在当前楼层铺一层静态海面。已有陆地保留在上方；选中已有地形也可添加水面外观。</p>
    <fieldset disabled={disabled || !floor || scene.mapMode !== 'scene'}>
      <label>海面预设<select aria-label="海面预设" value={preset} onChange={event => setPreset(event.target.value as typeof preset)}>{Object.keys(presetNames).map(key => <option key={key} value={key}>{presetNames[key as typeof preset]}</option>)}</select></label>
      <button type="button" className="secondary asset-wide" onClick={() => {
        if (!floor) return
        const b = floor.boundsMm, id = `ocean-${crypto.randomUUID()}`
        const priority = Math.min(0, ...Object.values(scene.terrainAreas).filter(row => row.floorId === floor.id).map(row => row.coveragePriority)) - 1
        onPreview([
          { type: 'createTerrainArea', id, floorId: floor.id, layerId, boundaryMm: [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }], coveragePriority: priority, groundElevationMm: 0, blocksMovement: true },
          { type: 'setWaterSurface', id, settings: { ...WATER_PRESETS[preset], seed: id } },
        ], '铺设静态海面与浪纹 · 海水阻挡普通步行，已有支撑冲突时整笔拒绝')
      }}>预览铺设海面</button>
    </fieldset>
    <p className="asset-muted">鱼、海怪和舟船从“素材与布景”放置；放置表面明确选水面，再在物件详情调整浸水效果。</p>
  </details>
}

export function WaterSurfaceTools({ scene, id, disabled, onPreview }: { scene: SceneDocument; id: string; disabled: boolean; onPreview: Preview }) {
  const area = scene.terrainAreas[id]
  const [water, setWater] = useState<WaterSurface>({ ...(area.waterSurface ?? WATER_PRESETS.calm) })
  if (area.rockBody || scene.mapMode !== 'scene') return null
  return <details className="workspace-detail-disclosure" aria-label="水面外观"><summary>水面与静态浪纹{area.waterSurface ? ' · 已启用' : ''}</summary>
    <fieldset disabled={disabled || effectiveEditLocked(scene, id)}>
      <div className="workspace-field-pair">{Object.entries(presetNames).map(([key, label]) => <button className="secondary water-preset" type="button" key={key} onClick={() => setWater({ ...WATER_PRESETS[key as keyof typeof WATER_PRESETS] })}>{label}</button>)}</div>
      <WaterFields water={water} onChange={setWater}/>
      <button type="button" className="primary asset-wide" onClick={() => onPreview([{ type: 'setWaterSurface', id, settings: water }], '调整水面与静态浪纹')}>预览水面外观</button>
      {area.waterSurface && <button type="button" className="secondary asset-wide" onClick={() => onPreview([{ type: 'setWaterSurface', id, settings: null }], '移除水面外观，恢复原地材')}>预览移除水面外观</button>}
    </fieldset>
    <p className="asset-muted">覆盖原地材的画面，原材质保留。高程和通行分别设置；清澈度只影响水下布景。</p>
  </details>
}

export function WaterPropTools({ scene, id, disabled, onPreview, onDraftChange }: { scene: SceneDocument; id: string; disabled: boolean; onPreview: Preview; onDraftChange: (dirty: boolean) => void }) {
  const prop = scene.props[id], area = prop.supportRef.kind === 'terrainArea' ? scene.terrainAreas[prop.supportRef.id] : undefined
  const [mode, setMode] = useState<WaterAppearance['mode'] | 'none'>(prop.waterAppearance?.mode ?? 'none')
  const [depth, setDepth] = useState(prop.waterAppearance && prop.waterAppearance.mode !== 'surface' ? prop.waterAppearance.depth : .35)
  const [fraction, setFraction] = useState(prop.waterAppearance?.mode === 'partial' ? prop.waterAppearance.submergedFraction : .55)
  const effects = prop.waterAppearance?.mode !== 'submerged' ? prop.waterAppearance?.surfaceEffects : undefined
  const [ripples, setRipples] = useState(effects?.ripples ?? .6), [wake, setWake] = useState(effects?.wakeLengthMm ?? 0)
  const [effectsEnabled, setEffectsEnabled] = useState(!!effects)
  if (!area?.waterSurface && !prop.waterAppearance) return null
  return <details className="workspace-detail-disclosure" aria-label="物件浸水效果"><summary>水面与水下表现</summary>
    <fieldset disabled={disabled || effectiveEditLocked(scene, id) || effectiveEditLocked(scene, prop.supportRef.id)} onChangeCapture={() => onDraftChange(true)}>
      <label>浸水方式<select aria-label="浸水方式" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="none">普通物件</option><option value="surface">浮在水面</option><option value="submerged">完全在水下</option><option value="partial">部分出水</option></select></label>
      {(mode === 'partial' || mode === 'submerged') && <label>视觉深度<input aria-label="视觉深度" type="number" min={0} max={1} step={.05} value={depth} onChange={event => setDepth(Number(event.target.value))}/></label>}
      {mode === 'partial' && <label>水下比例<input aria-label="水下比例" type="number" min={.05} max={.95} step={.05} value={fraction} onChange={event => setFraction(Number(event.target.value))}/></label>}
      {(mode === 'surface' || mode === 'partial') && <><label className="composition-check"><input type="checkbox" aria-label="启用水线与静态尾流" checked={effectsEnabled} onChange={event => setEffectsEnabled(event.target.checked)}/>水线、周围波纹与静态尾流</label>{effectsEnabled && <><label>波纹强度<input aria-label="物件波纹强度" type="number" min={0} max={1} step={.05} value={ripples} onChange={event => setRipples(Number(event.target.value))}/></label><NumberInput label="静态尾流长度" value={wake} onCommit={setWake}/></>}</>}
      <button type="button" className="primary asset-wide" onClick={() => {
        const extra = effectsEnabled ? { surfaceEffects: { ripples, wakeLengthMm: wake } } : {}
        const settings: WaterAppearance | null = mode === 'none' ? null : mode === 'surface' ? { mode, ...extra } : mode === 'submerged' ? { mode, depth } : { mode, depth, submergedFraction: fraction, ...extra }
        onPreview([{ type: 'setPropWaterAppearance', id, settings }], '调整物件浸水效果，保留同一物件的位置与旋转')
      }}>预览浸水效果</button>
    </fieldset>
    <p className="asset-muted">部分出水以图像下部为水下，分界线随物件旋转。水下布景须不阻挡移动和视线；视觉深度不代表真实米数。</p>
  </details>
}
