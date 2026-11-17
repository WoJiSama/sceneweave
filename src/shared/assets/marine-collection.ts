import { freezeJson } from '../validation/json.js'

export const MARINE_CATEGORIES = freezeJson([{ id: 'marine-life', name: '海洋生物与海怪' }])
export const MARINE_DESIGNS = freezeJson([
  { key: 'silver-school', category: 'marine-life', name: '银鳞鱼群', era: 'fantasy' as const, widthMm: 3000, heightMm: 2200, design: '七条错落游动的小鱼，独立尾鳍与背部明暗' },
  { key: 'reef-shark', category: 'marine-life', name: '礁鲨', era: 'fantasy' as const, widthMm: 1900, heightMm: 4200, design: '俯视长鲨，双胸鳍、背鳍和不对称尾鳍' },
  { key: 'manta', category: 'marine-life', name: '宽翼蝠鲼', era: 'fantasy' as const, widthMm: 4800, heightMm: 3600, design: '宽菱形双翼、前卷头鳍与细长尾' },
  { key: 'dolphin', category: 'marine-life', name: '破浪海豚', era: 'fantasy' as const, widthMm: 1800, heightMm: 3200, design: '流线身体、短吻与水平分叉尾' },
  { key: 'kraken', category: 'marine-life', name: '卷腕海怪', era: 'fantasy' as const, widthMm: 6500, heightMm: 6500, design: '斑驳长头与八条不对称盘卷腕足，可设置部分出水' },
  { key: 'sea-serpent', category: 'marine-life', name: '盘游海蛇', era: 'fantasy' as const, widthMm: 5200, heightMm: 7000, design: '连续弯曲躯干、鳞脊和窄尾，单一可编辑主体' },
])
export const marineAssetId = (key: string) => `marine-collection-v1-art-${key}`
export const marineDefinitionId = (key: string) => `marine-collection-v1-prop-${key}`
