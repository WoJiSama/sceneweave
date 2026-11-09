import { describe, expect, it } from 'vitest'
import { cloneJson } from '../validation/json.js'
import { THEME_PACK_PLANS } from './theme-packs.js'
import { ASSET_REVIEW_DIMENSIONS, assessAssetPublication, assessThemePackPublication, createThemePackReviewContent,
  isControlledAssetReview, parseAssetReviewDeclaration, parseThemePackReviewDeclaration,
  recordControlledAssetReview, recordControlledThemePackReview, type AssetReviewDeclaration, type ThemePackReviewDeclaration } from './review.js'

const key = (algorithm: 1 | 2 | 3, suffix = 'source') => JSON.stringify([algorithm, 'a'.repeat(64), 'prop', `prop.test.${suffix}`, 1, 'b'.repeat(64)])
const content = (algorithm: 1 | 2 | 3 = 1) => ({ catalogKey: key(algorithm), resourceHashes: ['c'.repeat(64), 'd'.repeat(64)], dependencyKeys: [key(2, 'parent')] })
const passed = () => ({ status: 'passed' as const, reviewer: 'Project curator', reviewedAt: '2026-11-09T00:00:00.000Z',
  evidence: [{ label: 'Actual review record', reference: 'review-records/fixture' }] })
const accepted = () => ({ ...passed(), status: 'accepted' as const, reviewer: 'User', evidence: [{ label: 'Explicit user signoff', reference: 'user-signoff/fixture' }] })
function declaration(algorithm: 1 | 2 | 3 = 1): AssetReviewDeclaration {
  return { format: 'sceneweave-asset-review', version: 1, recordId: 'fixture-review', content: content(algorithm),
    checks: { rights: passed(), technical: passed(), art: passed(), scene: passed() }, userSignoff: accepted() }
}
const pack = () => ({ id: 'test-package', fixedVersion: 1, name: 'Fixture package', planId: 'modern-city',
  axes: cloneJson(THEME_PACK_PLANS[1].axes), availability: 'candidate', discovery: 'listed', catalogKeys: [key(1)],
  coverage: { planHash: 'f'.repeat(64), requiredRequirementIds: ['first', 'second'], scenarios: [
    { id: 'scene-a', name: 'First scene', sourceLayoutHash: '1'.repeat(64), requirementIds: ['first'], summary: { rooms: 2, terrainAreas: 1, paths: 1, props: 8, prefabInstances: 2 } },
    { id: 'scene-b', name: 'Second scene', sourceLayoutHash: '2'.repeat(64), requirementIds: ['second'], summary: { rooms: 0, terrainAreas: 2, paths: 1, props: 12, prefabInstances: 3 } },
  ] },
  theme: { catalogId: 'theme.fixture', fixedVersion: 1, contentHash: 'e'.repeat(64) } })
function packageReview(): ThemePackReviewDeclaration {
  return { format: 'sceneweave-theme-pack-review', version: 1, recordId: 'fixture-package-review',
    content: createThemePackReviewContent(pack(), [content()]),
    checks: { rights: passed(), technical: passed(), art: passed(), scene: passed() }, userSignoff: accepted() }
}

describe('exact independent asset review records', () => {
  it.each([1, 2, 3] as const)('accepts algorithm %s only with the complete exact key, resources and dependency set', algorithm => {
    const record = recordControlledAssetReview(declaration(algorithm))
    expect(isControlledAssetReview(record)).toBe(true)
    expect(assessAssetPublication(content(algorithm), record)).toEqual({ mode: 'public-default', reviewReady: true, issues: [], requiresFullValidation: true })
    expect(assessAssetPublication({ ...content(algorithm), resourceHashes: [...content(algorithm).resourceHashes].reverse() }, record).reviewReady).toBe(true)
    expect(assessAssetPublication({ ...content(algorithm), resourceHashes: ['f'.repeat(64)] }, record).reviewReady).toBe(false)
    expect(assessAssetPublication({ ...content(algorithm), dependencyKeys: [] }, record).reviewReady).toBe(false)
    expect(assessAssetPublication({ ...content(algorithm), catalogKey: key(algorithm, 'other') }, record).reviewReady).toBe(false)
  })

  it('treats external declarations, JSON roundtrips and frozen copies as untrusted administrative claims', () => {
    const external = parseAssetReviewDeclaration(declaration()), controlled = recordControlledAssetReview(declaration())
    expect(isControlledAssetReview(external)).toBe(false)
    expect(assessAssetPublication(content(), external).reviewReady).toBe(false)
    expect(assessAssetPublication(content(), JSON.parse(JSON.stringify(controlled))).reviewReady).toBe(false)
    expect(assessAssetPublication(content(), Object.freeze(cloneJson(controlled))).reviewReady).toBe(false)
    expect(() => parseAssetReviewDeclaration({ ...declaration(), status: 'P3', trusted: true })).toThrow()
  })

  it('keeps personal imports independent from public P3 without granting a validation exemption', () => {
    expect(assessAssetPublication(content(), undefined, 'personal')).toEqual({ mode: 'personal', reviewReady: true, issues: [], requiresFullValidation: true })
    expect(() => assessAssetPublication({ ...content(), resourceHashes: ['not-a-hash'] }, undefined, 'personal')).toThrow()
  })

  it('requires all four actual review dimensions and explicit user acceptance separately', () => {
    for (const dimension of ASSET_REVIEW_DIMENSIONS) {
      const input = declaration()
      input.checks[dimension] = { status: 'not-checked', reviewer: null, reviewedAt: null, evidence: [] }
      expect(assessAssetPublication(content(), recordControlledAssetReview(input)).reviewReady).toBe(false)
    }
    const input = declaration(); input.userSignoff = { status: 'not-requested', reviewer: null, reviewedAt: null, evidence: [] }
    expect(assessAssetPublication(content(), recordControlledAssetReview(input)).reviewReady).toBe(false)
    input.userSignoff = { ...accepted(), status: 'changes-requested' }
    expect(assessAssetPublication(content(), recordControlledAssetReview(input)).reviewReady).toBe(false)
  })

  it('rejects conclusions lacking evidence, duplicate dependency/resource rows and unsafe JSON without reading getters', () => {
    const input = declaration(); input.checks.art.evidence = []
    expect(() => recordControlledAssetReview(input)).toThrow()
    expect(() => recordControlledAssetReview({ ...declaration(), content: { ...content(), dependencyKeys: [key(2, 'parent'), key(2, 'parent')] } })).toThrow()
    expect(() => recordControlledAssetReview({ ...declaration(), content: { ...content(), resourceHashes: ['c'.repeat(64), 'c'.repeat(64)] } })).toThrow()
    let reads = 0
    const accessor = { ...declaration(), get content() { reads++; return content() } }
    expect(() => recordControlledAssetReview(accessor)).toThrow(); expect(reads).toBe(0)
  })

  it('owns immutable review fields so later caller edits cannot rewrite a recorded conclusion', () => {
    const input = declaration(), record = recordControlledAssetReview(input)
    input.content.resourceHashes[0] = 'f'.repeat(64); input.checks.art.reviewer = 'Different curator'
    expect(record.content.resourceHashes[0]).toBe('c'.repeat(64))
    expect(record.checks.art.reviewer).toBe('Project curator')
    expect(Object.isFrozen(record.checks.art.evidence[0])).toBe(true)
  })
})

describe('whole-theme public readiness and withdrawal', () => {
  it('requires the exact complete registration, actual member descriptors, independent member reviews and whole-map signoff', () => {
    const record = recordControlledAssetReview(declaration()), packageRecord = recordControlledThemePackReview(packageReview())
    const result = assessThemePackPublication(pack(), [content()], [record], packageRecord)
    expect(result).toMatchObject({ reviewReady: true, issues: [], requiresFullValidation: true })
    expect(result.members).toHaveLength(1)
    expect(assessThemePackPublication(pack(), [content()], [record]).reviewReady).toBe(false)
    expect(assessThemePackPublication(pack(), [content()], [record], parseThemePackReviewDeclaration(packageReview())).reviewReady).toBe(false)
    expect(assessThemePackPublication(pack(), [content()], [parseAssetReviewDeclaration(declaration())], packageRecord).reviewReady).toBe(false)
  })

  it('rejects added/removed members, substituted theme, altered scope, duplicate selection and incomplete package signoff', () => {
    const input = pack(), record = recordControlledAssetReview(declaration()), packageRecord = recordControlledThemePackReview(packageReview())
    expect(assessThemePackPublication(input, [], [record], packageRecord).reviewReady).toBe(false)
    expect(assessThemePackPublication(input, [content(), content()], [record], packageRecord).reviewReady).toBe(false)
    expect(assessThemePackPublication(input, [content()], [record, record], packageRecord).reviewReady).toBe(false)
    expect(assessThemePackPublication({ ...input, theme: { ...input.theme, contentHash: 'f'.repeat(64) } }, [content()], [record], packageRecord).reviewReady).toBe(false)
    expect(assessThemePackPublication({ ...input, axes: { ...input.axes, scene: ['laboratory'] } }, [content()], [record], packageRecord).reviewReady).toBe(false)
    expect(assessThemePackPublication({ ...input, theme: null }, [content()], [record], packageRecord).reviewReady).toBe(false)
    expect(assessThemePackPublication({ ...input, coverage: null }, [content()], [record], packageRecord).reviewReady).toBe(false)
    const layoutChanged = cloneJson(input); layoutChanged.coverage.scenarios[0].sourceLayoutHash = '3'.repeat(64)
    expect(assessThemePackPublication(layoutChanged, [content()], [record], packageRecord).reviewReady).toBe(false)
    const summaryChanged = cloneJson(input); summaryChanged.coverage.scenarios[0].summary.props++
    expect(assessThemePackPublication(summaryChanged, [content()], [record], packageRecord).reviewReady).toBe(false)
    const requirementChanged = cloneJson(input); requirementChanged.coverage.planHash = '4'.repeat(64)
    expect(assessThemePackPublication(requirementChanged, [content()], [record], packageRecord).reviewReady).toBe(false)
    const unsigned = packageReview(); unsigned.userSignoff = { status: 'not-requested', reviewer: null, reviewedAt: null, evidence: [] }
    expect(assessThemePackPublication(input, [content()], [record], recordControlledThemePackReview(unsigned)).reviewReady).toBe(false)
  })

  it('removes publication eligibility without mutating fixed content, project data or earlier records', () => {
    const input = pack(), before = cloneJson(input), record = recordControlledAssetReview(declaration()), packageRecord = recordControlledThemePackReview(packageReview())
    expect(assessThemePackPublication({ ...input, discovery: 'withdrawn' }, [content()], [record], packageRecord).reviewReady).toBe(false)
    expect(input).toEqual(before)
    expect(assessThemePackPublication(input, [content()], [record], packageRecord).reviewReady).toBe(true)
    expect(() => createThemePackReviewContent(input, [])).toThrow()
  })
})
