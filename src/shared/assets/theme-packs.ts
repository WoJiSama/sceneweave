import { z } from 'zod'
import { validateCatalogKey } from '../library/metadata.js'
import { captureJson, freezeJson } from '../validation/json.js'

const key = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/)
const text = z.string().min(1).max(1000).refine(value => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value))
const unique = <T>(values: T[]) => new Set(values).size === values.length
const values = z.array(key).min(1).max(32).refine(unique, '主题维度不能重复。')
const completion = z.array(text).min(1).max(16).refine(unique, '完成条件不能重复。')
const exactCatalogKey = z.string().max(4096).refine(value => {
  try { validateCatalogKey(value); return true } catch { return false }
}, '主题成员必须绑定算法1/2/3的确切目录身份。')

export const THEME_PACK_AXES = ['scene', 'style', 'era', 'use', 'state'] as const
export type ThemePackAxis = typeof THEME_PACK_AXES[number]
export const themePackAxesSchema = z.object({ scene: values, style: values, era: values, use: values, state: values }).strict()
export type ThemePackAxes = z.infer<typeof themePackAxesSchema>

export const themePackRequirementSchema = z.object({
  id: key, kind: z.enum(['material', 'prop', 'prefab']), role: z.enum(['surface', 'subject', 'detail', 'composition']),
  name: text, states: values, completion,
}).strict().refine(value => value.kind === 'material' ? value.role === 'surface'
  : value.kind === 'prefab' ? value.role === 'composition' : value.role === 'subject' || value.role === 'detail',
'素材类型与覆盖职责不一致。')
export type ThemePackRequirement = z.infer<typeof themePackRequirementSchema>
const scenarioSchema = z.object({ id: key, name: text, scenes: values,
  requirementIds: z.array(key).min(1).max(128).refine(unique), completion }).strict()
export const themePackPlanSchema = z.object({
  id: key, name: text, status: z.literal('planned'), discovery: z.literal('listed'), axes: themePackAxesSchema,
  requirements: z.array(themePackRequirementSchema).min(4).max(128),
  scenarios: z.array(scenarioSchema).length(2), completion,
}).strict().superRefine((plan, context) => {
  const ids = new Set(plan.requirements.map(value => value.id))
  if (ids.size !== plan.requirements.length) context.addIssue({ code: 'custom', message: '主题必需项身份重复。' })
  for (const role of ['surface', 'subject', 'detail', 'composition']) if (!plan.requirements.some(value => value.role === role)) {
    context.addIssue({ code: 'custom', message: `主题缺少必需覆盖：${role}。` })
  }
  if (new Set(plan.scenarios.map(value => value.id)).size !== 2) context.addIssue({ code: 'custom', message: '代表场景身份重复。' })
  const covered = new Set<string>()
  for (const scenario of plan.scenarios) {
    if (scenario.scenes.some(value => !plan.axes.scene.includes(value))) context.addIssue({ code: 'custom', message: '代表场景引用未声明的场景维度。' })
    for (const id of scenario.requirementIds) {
      if (!ids.has(id)) context.addIssue({ code: 'custom', message: '代表场景引用缺失的必需项。' })
      covered.add(id)
    }
  }
  if ([...ids].some(id => !covered.has(id))) context.addIssue({ code: 'custom', message: '必需项必须至少在一份代表场景中核对。' })
  if (plan.requirements.some(value => value.states.some(state => !plan.axes.state.includes(state)))) {
    context.addIssue({ code: 'custom', message: '必需项状态未在主题维度中声明。' })
  }
})
export type ThemePackPlan = z.infer<typeof themePackPlanSchema>
const registrySchema = z.object({ format: z.literal('sceneweave-theme-pack-plans'), version: z.literal(1),
  packs: z.array(themePackPlanSchema).min(1).max(128) }).strict()
export type ThemePackPlanRegistry = z.infer<typeof registrySchema>

/** Independent planning metadata. No row asserts that artwork, bytes or user acceptance exists. */
export function validateThemePackRegistry(input: unknown): ThemePackPlanRegistry {
  const registry = registrySchema.parse(captureJson(input))
  if (new Set(registry.packs.map(pack => pack.id)).size !== registry.packs.length) throw new Error('主题包计划身份重复。')
  return freezeJson(registry)
}

const roleChecks: Record<ThemePackRequirement['role'], string> = {
  surface: '按真实世界尺度检查2×2和3×3平铺，接缝与重复痕迹不得破坏场景可读性。',
  subject: '在真实比例及旋转对照中核对图像、根锚、占地、阻挡与阴影；图片不隐式创建结构或通行。',
  detail: '在全景和近景均可辨识；细节不遮蔽主要通路，不从名称或像素推断阻挡和秘密。',
  composition: '组合保存实际独立成员、固定依赖和局部布局，可逐件修改与拆开，保留人工结果。',
}
const requirement = (id: string, role: ThemePackRequirement['role'], name: string, states = ['intact']): ThemePackRequirement => ({
  id, role, name, kind: role === 'surface' ? 'material' : role === 'composition' ? 'prefab' : 'prop', states,
  completion: [roleChecks[role], '实际源文件、图片、固定身份、许可及相关依赖须有记录，计划名称不充作文件或验收证据。'],
})
const surface = (id: string, name: string, states?: string[]) => requirement(id, 'surface', name, states)
const subject = (id: string, name: string, states?: string[]) => requirement(id, 'subject', name, states)
const detail = (id: string, name: string, states?: string[]) => requirement(id, 'detail', name, states)
const composition = (id: string, name: string, states?: string[]) => requirement(id, 'composition', name, states)
function plan(id: string, name: string, axes: ThemePackAxes, requirements: ThemePackRequirement[],
  scenarios: [string, string, string[], string[]?][]): ThemePackPlan {
  return { id, name, status: 'planned', discovery: 'listed', axes, requirements,
    scenarios: scenarios.map(([id, name, scenes, requirementIds]) => ({ id, name, scenes, requirementIds: requirementIds ?? requirements.map(value => value.id),
      completion: ['从完整可编辑工程核对场景用途、尺度和主要通路，不能用整图位图替代场景。',
        '保留中性及效果全景、固定近景，并核对一次编辑、撤销、保存冷开与适用双受众输出。'] })),
    completion: ['全部必需项在两份代表场景中有可观察结果，缺项逐一标明，数量不能抵消场景或美术缺口。',
      '画风、年代、用途、场景与状态分别描述；换色、缩放和旧素材副本不自动计为新形状或新风格。',
      '资源、技术、美术、场景审核分别记录；公开默认发行须有确切内容的用户签收，个人导入不强制P3。'] }
}

export const THEME_PACK_PLAN_REGISTRY = validateThemePackRegistry({ format: 'sceneweave-theme-pack-plans', version: 1, packs: [
  plan('period-investigation', '近代调查 · 细描手绘', {
    scene: ['agency', 'archive', 'old-house', 'clinic'], style: ['fine-handdrawn'], era: ['late-19th-early-20th'],
    use: ['investigation', 'work', 'storage', 'treatment'], state: ['intact', 'worn', 'abandoned'],
  }, [
    surface('wood-and-old-masonry', '木地板、旧砖与墙石', ['intact', 'worn']),
    subject('desks-seating', '调查书桌与配套座具'), subject('archive-storage', '档案柜、书架与文件储物'),
    subject('treatment-furniture', '诊疗床、器具台与隐私屏风'),
    detail('paper-and-instruments', '纸件、记录工具与调查小物'), detail('lamps-and-lived-in-details', '灯具及生活细节', ['intact', 'worn']),
    composition('investigation-corner', '调查工作角'), composition('archive-corner', '档案角'), composition('treatment-corner', '诊疗角'),
  ], [['agency-archive', '事务所与档案室', ['agency', 'archive'], ['wood-and-old-masonry', 'desks-seating', 'archive-storage', 'paper-and-instruments', 'lamps-and-lived-in-details', 'investigation-corner', 'archive-corner']],
    ['old-house-clinic', '旧宅诊所', ['old-house', 'clinic'], ['wood-and-old-masonry', 'desks-seating', 'treatment-furniture', 'paper-and-instruments', 'lamps-and-lived-in-details', 'treatment-corner']]]),
  plan('modern-city', '现代城市 · 清晰写实俯视', {
    scene: ['apartment', 'office', 'shop', 'hospital', 'warehouse'], style: ['clear-realistic-topdown'], era: ['modern'],
    use: ['living', 'work', 'retail', 'treatment', 'storage'], state: ['intact', 'worn', 'abandoned'],
  }, [
    surface('modern-surfaces', '瓷砖、地毯、混凝土与沥青', ['intact', 'worn']),
    subject('modern-furniture', '现代桌椅、沙发、床与柜'), subject('sanitary-and-treatment', '卫生设施与医疗家具'),
    subject('shelves-and-appliances', '货架、电器与操作设备'),
    detail('daily-and-office-items', '生活用品、办公与收银细节'), detail('warehouse-items', '包装箱、托盘与仓储细节', ['intact', 'worn']),
    composition('office-workstation', '办公位'), composition('checkout-area', '收银区'), composition('living-corner', '生活角'),
  ], [['street-corner-shop', '街角商店与储物区', ['shop', 'warehouse'], ['modern-surfaces', 'shelves-and-appliances', 'daily-and-office-items', 'warehouse-items', 'checkout-area']],
    ['apartment-office', '办公诊疗中心与生活区', ['apartment', 'office', 'hospital'], ['modern-surfaces', 'modern-furniture', 'sanitary-and-treatment', 'shelves-and-appliances', 'daily-and-office-items', 'office-workstation', 'living-corner']]]),
  plan('fantasy-town', '奇幻城镇 · 暖色厚涂', {
    scene: ['tavern', 'inn', 'market', 'smithy', 'dwelling'], style: ['warm-painterly'], era: ['fantasy-preindustrial'],
    use: ['dining', 'lodging', 'trade', 'craft', 'living'], state: ['intact', 'worn', 'damaged'],
  }, [
    surface('town-surfaces', '木板、砌石与泥土地面', ['intact', 'worn']),
    subject('tavern-inn-furniture', '酒馆桌椅、客房家具与炉台'), subject('market-workshop-furniture', '摊位、工坊台架与储物'),
    detail('barrels-crates-and-goods', '桶箱、货品与餐饮细节'), detail('craft-tools', '铁匠及日常工艺工具', ['intact', 'worn']),
    composition('dining-table', '餐桌组'), composition('guest-room', '客房组'), composition('market-stall', '摊位组'), composition('workshop-corner', '工坊角'),
  ], [['tavern-inn', '酒馆旅舍', ['tavern', 'inn'], ['town-surfaces', 'tavern-inn-furniture', 'barrels-crates-and-goods', 'dining-table', 'guest-room']],
    ['market-smithy', '集市与铁匠铺', ['market', 'smithy'], ['town-surfaces', 'market-workshop-furniture', 'barrels-crates-and-goods', 'craft-tools', 'market-stall', 'workshop-corner']]]),
  plan('underground-ruins', '地下遗迹 · 冷色线描', {
    scene: ['dungeon', 'tomb', 'prison', 'altar', 'ruins'], style: ['cool-etched'], era: ['fantasy-ancient'],
    use: ['exploration', 'burial', 'confinement', 'ritual', 'storage'], state: ['intact', 'worn', 'damaged', 'abandoned'],
  }, [
    surface('ruin-surfaces', '旧石、碎土与破损铺装', ['worn', 'damaged']),
    subject('stone-monuments', '柱石、棺与祭坛', ['intact', 'damaged']), subject('cell-furniture', '牢房家具与储藏设施', ['worn', 'abandoned']),
    detail('ritual-and-burial-items', '祭祀、墓葬与遗留小物', ['intact', 'worn']), detail('debris-and-clutter', '散落碎件与杂物', ['damaged', 'abandoned']),
    composition('ritual-group', '祭祀组'), composition('tomb-group', '墓室组'), composition('storage-corner', '储藏角'),
  ], [['burial-chambers', '墓穴与祭坛', ['tomb', 'altar'], ['ruin-surfaces', 'stone-monuments', 'ritual-and-burial-items', 'debris-and-clutter', 'ritual-group', 'tomb-group']],
    ['ruined-prison', '遗迹监牢与储物区', ['ruins', 'prison'], ['ruin-surfaces', 'stone-monuments', 'cell-furniture', 'debris-and-clutter', 'storage-corner']]]),
  plan('temperate-wilderness', '温带荒野 · 自然水彩', {
    scene: ['forest', 'camp', 'riverbank', 'mountain-trail', 'abandoned-camp'], style: ['natural-watercolor'], era: ['setting-neutral'],
    use: ['travel', 'camping', 'exploration', 'nature-dressing'], state: ['intact', 'worn', 'abandoned', 'wet'],
  }, [
    surface('wilderness-surfaces', '土、草、岩与河岸底材', ['intact', 'wet']),
    subject('distinct-trees', '轮廓与结构不同的树木'), subject('shrubs-and-rocks', '灌丛与独立岩石'), subject('camp-equipment', '帐篷与营具', ['intact', 'worn']),
    detail('grass-and-ground-detail', '草缘、碎石与自然小物'), detail('abandoned-camp-details', '遗留营地细节', ['worn', 'abandoned']),
    composition('camp-group', '营地组'), composition('abandoned-camp-group', '废弃营地组', ['abandoned']), composition('trail-dressing', '路边布景组'),
  ], [['woodland-camp', '林间营地与废弃营地', ['forest', 'camp', 'abandoned-camp'], ['wilderness-surfaces', 'distinct-trees', 'shrubs-and-rocks', 'camp-equipment', 'grass-and-ground-detail', 'abandoned-camp-details', 'camp-group', 'abandoned-camp-group']],
    ['river-trail', '河岸山道', ['riverbank', 'mountain-trail'], ['wilderness-surfaces', 'distinct-trees', 'shrubs-and-rocks', 'grass-and-ground-detail', 'trail-dressing']]]),
  plan('coastal-settlement', '海岸聚落 · 潮苔墨绘', {
    scene: ['beach', 'rocky-shore', 'fishing-village', 'dock', 'coastal-outpost'], style: ['coastal-ink'], era: ['preindustrial-coastal'],
    use: ['fishing', 'supply', 'living', 'watch', 'shore-dressing'], state: ['intact', 'worn', 'wet', 'abandoned'],
  }, [
    surface('coastal-surfaces', '沙、水、湿石与风化木', ['intact', 'worn', 'wet']),
    subject('reef-and-shore-objects', '礁石与独立岸边主体'), subject('fishing-and-supply-equipment', '渔具、补给与工作设施', ['intact', 'worn']),
    detail('shells-and-shore-detail', '贝类、海岸植物与小物'), detail('dock-and-cargo-detail', '船岸杂物与补给细节', ['intact', 'worn']),
    composition('fishing-work-group', '渔具工作组'), composition('supply-group', '补给组'), composition('shore-work-corner', '岸边工作角'),
  ], [['fishing-village-dock', '渔村码头', ['fishing-village', 'dock'], ['coastal-surfaces', 'fishing-and-supply-equipment', 'shells-and-shore-detail', 'dock-and-cargo-detail', 'fishing-work-group', 'shore-work-corner']],
    ['coastal-watch', '海岸哨所与礁岸', ['coastal-outpost', 'rocky-shore'], ['coastal-surfaces', 'reef-and-shore-objects', 'fishing-and-supply-equipment', 'shells-and-shore-detail', 'dock-and-cargo-detail', 'supply-group']]]),
] })
export const THEME_PACK_PLANS: readonly ThemePackPlan[] = THEME_PACK_PLAN_REGISTRY.packs

const requirementIds = z.array(key).min(1).max(128).refine(unique)
export const themePackCoverageSchema = z.object({
  planHash: z.string().regex(/^[a-f0-9]{64}$/), requiredRequirementIds: requirementIds,
  scenarios: z.array(z.object({ id: key, name: text, sourceLayoutHash: z.string().regex(/^[a-f0-9]{64}$/),
    requirementIds, summary: z.object({ rooms: z.number().int().nonnegative(), terrainAreas: z.number().int().nonnegative(),
      paths: z.number().int().nonnegative(), props: z.number().int().positive(), prefabInstances: z.number().int().positive() }).strict(),
  }).strict()).length(2),
}).strict().superRefine((coverage, context) => {
  if (new Set(coverage.scenarios.map(scenario => scenario.id)).size !== 2) context.addIssue({ code: 'custom', message: '样板场景身份不能重复。' })
  if (new Set(coverage.scenarios.map(scenario => scenario.sourceLayoutHash)).size !== 2) context.addIssue({ code: 'custom', message: '两个代表场景不能复用同一布局。' })
  const required = new Set(coverage.requiredRequirementIds), covered = new Set<string>()
  for (const scenario of coverage.scenarios) for (const id of scenario.requirementIds) {
    if (!required.has(id)) context.addIssue({ code: 'custom', message: '样板场景引用未声明的必需项。' })
    covered.add(id)
  }
  if ([...required].some(id => !covered.has(id))) context.addIssue({ code: 'custom', message: '整包样板审核须列明全部必需项的核对范围。' })
})
export type ThemePackCoverage = z.infer<typeof themePackCoverageSchema>

/** Registration is discovery metadata, not a validity certificate or a new project container. */
export const themePackRegistrationSchema = z.object({
  id: key, fixedVersion: z.number().int().safe().positive(), name: text, axes: themePackAxesSchema,
  planId: key.nullable(), availability: z.enum(['planned', 'candidate', 'available']), discovery: z.enum(['listed', 'withdrawn']),
  catalogKeys: z.array(exactCatalogKey).max(512).refine(unique),
  theme: z.object({ catalogId: text, fixedVersion: z.number().int().safe().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  coverage: themePackCoverageSchema.nullable().default(null),
}).strict().refine(value => value.availability === 'planned' ? !value.catalogKeys.length && value.theme === null && value.coverage === null : value.catalogKeys.length > 0,
'计划包不声明未存在的内容，候选或可用包必须列确切成员。')
export type ThemePackRegistration = z.infer<typeof themePackRegistrationSchema>
export function validateThemePackRegistrations(input: unknown): readonly ThemePackRegistration[] {
  const packs = z.array(themePackRegistrationSchema).max(128).parse(captureJson(input))
  if (new Set(packs.map(pack => JSON.stringify([pack.id, pack.fixedVersion]))).size !== packs.length) throw new Error('主题包固定注册身份重复。')
  return freezeJson(packs)
}

export interface ThemePackFilter {
  query?: string; scene?: string[]; style?: string[]; era?: string[]; use?: string[]; state?: string[]; includeWithdrawn?: boolean
}
const filterValues = z.array(key).max(32).refine(unique)
const filterSchema = z.object({ query: z.string().max(1000).optional(), scene: filterValues.optional(), style: filterValues.optional(),
  era: filterValues.optional(), use: filterValues.optional(), state: filterValues.optional(), includeWithdrawn: z.boolean().optional() }).strict()
type SelectableThemePack = { id: string; name: string; axes: ThemePackAxes; discovery: 'listed' | 'withdrawn' }
/** OR within each dimension, AND across dimensions. Selection never loads images or changes engineering data. */
export function selectThemePacks<T extends SelectableThemePack>(packs: readonly T[], input: ThemePackFilter = {}): T[] {
  const filter = filterSchema.parse(captureJson(input))
  const terms = filter.query?.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean) ?? []
  return packs.filter(pack => (filter.includeWithdrawn || pack.discovery !== 'withdrawn')
    && THEME_PACK_AXES.every(axis => !filter[axis]?.length || filter[axis]!.some(value => pack.axes[axis].includes(value)))
    && terms.every(term => `${pack.id} ${pack.name} ${THEME_PACK_AXES.flatMap(axis => pack.axes[axis]).join(' ')}`.normalize('NFKC').toLocaleLowerCase().includes(term)))
}
