import type { EditableProject } from '../../application/workspace/project'
import type { SampleKind } from '../../platform/browser/content/factories'
import { workspaceSamples } from '../../platform/browser/content/workspace-samples'
import { createDetailedIslandProject, DETAILED_ISLAND_NAME } from '../../platform/browser/content/detailed-island'
import { createNearSideIslandProject, NEAR_SIDE_ISLAND_NAME } from '../../platform/browser/content/near-side'
import { createRefinedCoastProject, REFINED_COAST_NAME } from '../../platform/browser/content/refined-coast'
import { createRefinedInteriorProject, REFINED_INTERIOR_NAME } from '../../platform/browser/content/refined-interior'
import { createRefinedIslandProject, REFINED_ISLAND_NAME } from '../../platform/browser/content/refined-island'
import { STYLED_BUILDING_SHELLS, createStyledBuildingShellProject } from '../../platform/browser/content/styled-building-shells'
import { createVisualSampleProject } from '../../platform/browser/content/visual-samples'
import { createWaysideInnProject, WAYSIDE_INN_NAME } from '../../platform/browser/content/wayside-inn'

const visualSamples = [
  { id: 'beach', name: '潮声浅湾', label: '潮声浅湾 · 连续海岸' },
  { id: 'island', name: '苔冠岩岛', label: '苔冠岩岛 · 高差与草沿' },
  { id: 'interior', name: '灯下旅舍', label: '灯下旅舍 · 材质与灯光' },
] as const

const fixedSamples = [
  { id: 'study', label: '书房与露台' },
  { id: 'island', label: '双层岩岛' },
  { id: 'outpost', label: '海岸哨所' },
  { id: 'graveyard', label: '苔石墓园 · 内容小样' },
  { id: 'volcano', label: '灰烬熔脉 · 内容小样' },
] as const

type SampleFactory = (signal: AbortSignal) => Promise<EditableProject>

export default function WorkspaceSampleTools({ disabled, prepare, onVisualNew, onFixedSample }: {
  disabled: boolean
  prepare: (factory: SampleFactory, description: string) => boolean
  onVisualNew: () => void
  onFixedSample: (sample: SampleKind) => void
}) {
  return <section className="workspace-project-tools" aria-label="场景样板">
    <details className="workspace-advanced">
      <summary>从样板开始</summary>
      <h3>视觉创作</h3>
      <button className="secondary asset-wide" disabled={disabled} onClick={onVisualNew}>新建视觉空白 · 原创素材</button>
      <h3>视觉创作样板</h3>
      {workspaceSamples.map(sample => <button key={sample.name} className="secondary asset-wide" disabled={disabled} onClick={() => prepare(async signal => {
        const create = await sample.load()
        signal.throwIfAborted()
        return create(signal)
      }, sample.name)}>{sample.name}</button>)}
      <button className="secondary asset-wide" disabled={disabled} onClick={() => prepare(createDetailedIslandProject, DETAILED_ISLAND_NAME)}>{DETAILED_ISLAND_NAME}</button>
      {visualSamples.map(sample => <button key={sample.id} className="secondary asset-wide" disabled={disabled} onClick={() => prepare(signal => createVisualSampleProject(sample.id, signal), sample.name)}>{sample.label}</button>)}
      <button className="secondary asset-wide" disabled={disabled} onClick={() => prepare(createRefinedIslandProject, REFINED_ISLAND_NAME)}>岬湾苔岛 · 精修版</button>
      <button className="secondary asset-wide" disabled={disabled} onClick={() => prepare(createRefinedCoastProject, REFINED_COAST_NAME)}>{REFINED_COAST_NAME}</button>
      <button className="secondary asset-wide" disabled={disabled} onClick={() => prepare(createRefinedInteriorProject, REFINED_INTERIOR_NAME)}>{REFINED_INTERIOR_NAME}</button>
      <button className="secondary asset-wide" disabled={disabled} onClick={() => prepare(createNearSideIslandProject, NEAR_SIDE_ISLAND_NAME)}>新建近侧视苔岛</button>
      <h3>按风格布置建筑</h3>
      <p>先打开建筑空房，再到“素材与布景”逐房选择用途和年代风格。三种布局独立设计；专用生活设备仍须另选。</p>
      {STYLED_BUILDING_SHELLS.map(sample => <button key={sample.id} className="secondary asset-wide" disabled={disabled} title={sample.missing} onClick={() => prepare(signal => createStyledBuildingShellProject(sample.id, signal), sample.name)}>{sample.name}</button>)}
      <h3>可编辑样板</h3>
      <button className="secondary asset-wide" disabled={disabled} onClick={() => prepare(createWaysideInnProject, WAYSIDE_INN_NAME)}>{WAYSIDE_INN_NAME}</button>
      {fixedSamples.map(sample => <button key={sample.id} className="secondary asset-wide" disabled={disabled} onClick={() => onFixedSample(sample.id)}>{sample.label}</button>)}
    </details>
  </section>
}
