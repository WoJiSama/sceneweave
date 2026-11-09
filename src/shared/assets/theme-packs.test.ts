import { describe, expect, it } from 'vitest'
import { cloneJson } from '../validation/json.js'
import { THEME_PACK_AXES, THEME_PACK_PLAN_REGISTRY, THEME_PACK_PLANS, selectThemePacks,
  validateThemePackRegistrations, validateThemePackRegistry } from './theme-packs.js'

const key = (algorithm: 1 | 2 | 3) => JSON.stringify([algorithm, 'a'.repeat(64), 'prop', `prop.test.${algorithm}`, 1, 'b'.repeat(64)])
const registration = () => ({ id: 'fixture', name: 'Fixture', fixedVersion: 1, planId: 'modern-city',
  axes: cloneJson(THEME_PACK_PLANS[1].axes), availability: 'candidate', discovery: 'listed',
  catalogKeys: [key(1), key(2), key(3)], theme: { catalogId: 'theme.test', fixedVersion: 1, contentHash: 'c'.repeat(64) } })

describe('theme pack planning and metadata discovery', () => {
  it('keeps six planned packages with four content roles and exactly two referenced, observable scenarios', () => {
    expect(THEME_PACK_PLANS.map(pack => pack.id)).toEqual(['period-investigation', 'modern-city', 'fantasy-town',
      'underground-ruins', 'temperate-wilderness', 'coastal-settlement'])
    expect(Object.isFrozen(THEME_PACK_PLAN_REGISTRY)).toBe(true)
    for (const pack of THEME_PACK_PLANS) {
      expect(pack.status).toBe('planned')
      expect(Object.isFrozen(pack.requirements[0].completion)).toBe(true)
      expect(Object.keys(pack.axes).sort()).toEqual([...THEME_PACK_AXES].sort())
      expect(new Set(pack.requirements.map(row => row.role))).toEqual(new Set(['surface', 'subject', 'detail', 'composition']))
      expect(pack.scenarios).toHaveLength(2)
      expect(pack.requirements.every(row => pack.scenarios.some(scenario => scenario.requirementIds.includes(row.id)))).toBe(true)
      expect(pack.completion.some(value => value.includes('用户签收'))).toBe(true)
      expect('catalogKeys' in pack).toBe(false)
    }
  })

  it('keeps scene, drawing style and state independent with OR within a facet and AND across facets', () => {
    expect(selectThemePacks(THEME_PACK_PLANS, { scene: ['office', 'shop'] }).map(pack => pack.id)).toEqual(['modern-city'])
    expect(selectThemePacks(THEME_PACK_PLANS, { style: ['coastal-ink'], scene: ['forest'] })).toEqual([])
    expect(selectThemePacks(THEME_PACK_PLANS, { scene: ['forest'], state: ['abandoned'] }).map(pack => pack.id)).toEqual(['temperate-wilderness'])
    expect(selectThemePacks(THEME_PACK_PLANS, { query: '近代 调查', scene: [] }).map(pack => pack.id)).toEqual(['period-investigation'])
    expect(selectThemePacks(THEME_PACK_PLANS, { query: '不存在' })).toEqual([])
  })

  it('withdraws only discovery, preserving the registered members and original input', () => {
    const input = registration(), before = cloneJson(input)
    const [pack] = validateThemePackRegistrations([{ ...input, discovery: 'withdrawn' }])
    expect(selectThemePacks([pack])).toEqual([])
    expect(selectThemePacks([pack], { includeWithdrawn: true })).toEqual([pack])
    expect(pack.catalogKeys).toEqual(input.catalogKeys)
    expect(input).toEqual(before)
  })

  it('registers all three current identity algorithms and rejects duplicates, fabricated planned members and extra fields', () => {
    const input = registration()
    expect(validateThemePackRegistrations([input])[0].catalogKeys).toEqual(input.catalogKeys)
    expect(() => validateThemePackRegistrations([{ ...input, catalogKeys: [...input.catalogKeys, key(1)] }])).toThrow()
    expect(() => validateThemePackRegistrations([{ ...input, availability: 'planned' }])).toThrow()
    expect(() => validateThemePackRegistrations([{ ...input, catalogKeys: [JSON.stringify([4, 'a'.repeat(64), 'prop', 'prop.test', 1, 'b'.repeat(64)])] }])).toThrow()
    expect(() => validateThemePackRegistrations([{ ...input, approved: true }])).toThrow()
    expect(() => validateThemePackRegistrations([input, input])).toThrow()
  })

  it('rejects missing content roles, dangling or uncovered requirements, wrong scenario facets and self-reported completion', () => {
    const input = cloneJson(THEME_PACK_PLAN_REGISTRY)
    const noComposition = cloneJson(input)
    noComposition.packs[0].requirements = noComposition.packs[0].requirements.filter(row => row.role !== 'composition')
    expect(() => validateThemePackRegistry(noComposition)).toThrow()
    const dangling = cloneJson(input); dangling.packs[0].scenarios[0].requirementIds.push('missing')
    expect(() => validateThemePackRegistry(dangling)).toThrow()
    const uncovered = cloneJson(input)
    for (const scenario of uncovered.packs[0].scenarios) scenario.requirementIds = scenario.requirementIds.slice(1)
    expect(() => validateThemePackRegistry(uncovered)).toThrow()
    const wrongScene = cloneJson(input); wrongScene.packs[0].scenarios[0].scenes = ['space-station']
    expect(() => validateThemePackRegistry(wrongScene)).toThrow()
    expect(() => validateThemePackRegistry({ ...input, packs: [{ ...input.packs[0], status: 'accepted' }] })).toThrow()
  })

  it('captures owned metadata without evaluating caller getters or retaining a caller-owned array', () => {
    let reads = 0
    const accessor = { ...registration(), get name() { reads++; return 'Getter' } }
    expect(() => validateThemePackRegistrations([accessor])).toThrow()
    expect(reads).toBe(0)
    const input = registration(), output = validateThemePackRegistrations([input])
    input.axes.style.push('other-style'); input.catalogKeys.pop()
    expect(output[0].axes.style).not.toContain('other-style')
    expect(output[0].catalogKeys).toHaveLength(3)
  })

  it('requires distinct saved layout descriptors, complete requirement mapping and actual entity summaries', () => {
    const coverage = { planHash: 'a'.repeat(64), requiredRequirementIds: ['surface', 'composition'], scenarios: [
      { id: 'first', name: 'First scene', sourceLayoutHash: 'b'.repeat(64), requirementIds: ['surface'], summary: { rooms: 1, terrainAreas: 1, paths: 1, props: 4, prefabInstances: 1 } },
      { id: 'second', name: 'Second scene', sourceLayoutHash: 'c'.repeat(64), requirementIds: ['composition'], summary: { rooms: 0, terrainAreas: 3, paths: 1, props: 7, prefabInstances: 2 } },
    ] }
    const input = { ...registration(), coverage }
    expect(validateThemePackRegistrations([input])[0].coverage).toEqual(coverage)
    const duplicate = cloneJson(input); duplicate.coverage.scenarios[1].sourceLayoutHash = duplicate.coverage.scenarios[0].sourceLayoutHash
    expect(() => validateThemePackRegistrations([duplicate])).toThrow()
    const uncovered = cloneJson(input); uncovered.coverage.scenarios[1].requirementIds = ['surface']
    expect(() => validateThemePackRegistrations([uncovered])).toThrow()
    const dangling = cloneJson(input); dangling.coverage.scenarios[1].requirementIds = ['not-required']
    expect(() => validateThemePackRegistrations([dangling])).toThrow()
    const flattened = cloneJson(input); flattened.coverage.scenarios[0].summary.props = 0
    expect(() => validateThemePackRegistrations([flattened])).toThrow()
  })
})
