import type { StaircaseMaterialId, StaircasePresetId } from './contracts.js'

export interface StaircasePreset {
  id: StaircasePresetId
  label: string
  description: string
  defaultMaterial: StaircaseMaterialId
}

/** Construction and material are independent: changing colour never changes support. */
export const STAIRCASE_PRESETS: readonly StaircasePreset[] = [
  { id: 'cut-stone', label: '整齐石阶', description: '整块踏面、交错拼缝与切削鼻口', defaultMaterial: 'limestone' },
  { id: 'rough-stone', label: '毛石台阶', description: '不规则分块、缺角与粗糙石缝', defaultMaterial: 'granite' },
  { id: 'carved-rock', label: '凿岩石阶', description: '连续岩面上凿出的不规则鼻口与裂隙', defaultMaterial: 'basalt' },
  { id: 'stepping-stones', label: '独立踏石', description: '留有土隙的独立厚石板', defaultMaterial: 'sandstone' },
  { id: 'flagstone', label: '碎拼板岩', description: '大小错落的薄石板铺装', defaultMaterial: 'slate' },
  { id: 'brick', label: '砖砌台阶', description: '两排错缝小砖与明显灰缝', defaultMaterial: 'terracotta' },
  { id: 'concrete', label: '混凝土台阶', description: '整体浇筑踏面、侧槽与伸缩缝', defaultMaterial: 'concrete' },
  { id: 'timber', label: '厚木台阶', description: '成对厚木板、木纹与紧固件', defaultMaterial: 'oak' },
  { id: 'boardwalk', label: '栈道木阶', description: '架空纵梁上铺设带间隙的横板', defaultMaterial: 'weathered-wood' },
  { id: 'metal-grate', label: '金属格栅', description: '外框、横向支撑与可透地面的格栅', defaultMaterial: 'iron' },
]

export interface StaircaseMaterial {
  id: StaircaseMaterialId
  label: string
  palette: { top: string; alternate: string; light: string; shadow: string; joint: string; grain: string }
}

export const STAIRCASE_MATERIALS: readonly StaircaseMaterial[] = [
  { id: 'limestone', label: '石灰岩', palette: { top: '#b8af95', alternate: '#aaa187', light: '#d9d2b9', shadow: '#77715f', joint: '#57564b', grain: '#96917d' } },
  { id: 'sandstone', label: '砂岩', palette: { top: '#bd9a6b', alternate: '#ad895c', light: '#dfc59b', shadow: '#83613e', joint: '#594b36', grain: '#a18054' } },
  { id: 'granite', label: '花岗岩', palette: { top: '#96978e', alternate: '#85887e', light: '#c9c9ba', shadow: '#5f665e', joint: '#414b44', grain: '#747c74' } },
  { id: 'basalt', label: '玄武岩', palette: { top: '#666c65', alternate: '#59615c', light: '#969e8c', shadow: '#39423c', joint: '#252f2a', grain: '#7c8377' } },
  { id: 'slate', label: '板岩', palette: { top: '#788586', alternate: '#667678', light: '#abbab6', shadow: '#46565a', joint: '#303f42', grain: '#8b9b98' } },
  { id: 'terracotta', label: '陶砖', palette: { top: '#ac6b4d', alternate: '#985840', light: '#d69872', shadow: '#713e30', joint: '#c0ae8d', grain: '#8c513c' } },
  { id: 'concrete', label: '混凝土', palette: { top: '#adaea2', alternate: '#a1a395', light: '#d0d0c1', shadow: '#71776e', joint: '#535b52', grain: '#90988b' } },
  { id: 'oak', label: '橡木', palette: { top: '#a17b4c', alternate: '#916a3d', light: '#d1ae74', shadow: '#644725', joint: '#3e3021', grain: '#795731' } },
  { id: 'weathered-wood', label: '风化木', palette: { top: '#8f8a70', alternate: '#7e7c64', light: '#bcb59a', shadow: '#555744', joint: '#343f32', grain: '#696e56' } },
  { id: 'iron', label: '铁', palette: { top: '#7c8784', alternate: '#687773', light: '#bdc9c2', shadow: '#414f4b', joint: '#26352f', grain: '#8f9b92' } },
]

export const staircasePreset = (id: StaircasePresetId): StaircasePreset => STAIRCASE_PRESETS.find(row => row.id === id)!
export const staircaseMaterial = (id: StaircaseMaterialId): StaircaseMaterial => STAIRCASE_MATERIALS.find(row => row.id === id)!
