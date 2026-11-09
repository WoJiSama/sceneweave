import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assessAssetPublication, assessThemePackPublication, createThemePackReviewContent, isControlledAssetReview, parseAssetReviewDeclaration,
  type AssetReviewDeclaration, type ThemePackReviewDeclaration } from '../../../shared/assets/review.js'
import { THEME_PACK_PLANS } from '../../../shared/assets/theme-packs.js'
import { cloneJson, canonicalJson } from '../../../shared/validation/json.js'
import { sha256Text } from '../../../shared/validation/hash.js'
import { ASSET_REVIEW_STORAGE_LIMITS, AssetReviewRepository, assetReviewDatabaseName } from './review-repository.js'

const repositories: AssetReviewRepository[] = [], databaseNames = new Set<string>()
const key = (suffix = 'item') => JSON.stringify([3, 'a'.repeat(64), 'prop', `prop.review.${suffix}`, 1, 'b'.repeat(64)])
const content = (suffix = 'item') => ({ catalogKey: key(suffix), resourceHashes: ['c'.repeat(64)], dependencyKeys: [] })
const passed = () => ({ status: 'passed' as const, reviewer: 'Local curator', reviewedAt: '2026-11-09T00:00:00.000Z',
  evidence: [{ label: 'Review evidence', reference: 'reviews/exact-scene.png' }] })
function declaration(suffix = 'item'): AssetReviewDeclaration {
  return { format: 'sceneweave-asset-review', version: 1, recordId: 'same-record-label', content: content(suffix),
    checks: { rights: passed(), technical: passed(), art: passed(), scene: passed() }, userSignoff: { ...passed(), reviewer: 'User', status: 'accepted' } }
}
const pack = () => ({ id: 'review-package', fixedVersion: 1, name: 'Review package', planId: 'modern-city',
  axes: cloneJson(THEME_PACK_PLANS[1].axes), availability: 'candidate', discovery: 'listed', catalogKeys: [key()],
  coverage: { planHash: 'f'.repeat(64), requiredRequirementIds: ['interior', 'exterior'], scenarios: [
    { id: 'scene-a', name: 'Interior', sourceLayoutHash: '1'.repeat(64), requirementIds: ['interior'], summary: { rooms: 2, terrainAreas: 0, paths: 0, props: 8, prefabInstances: 2 } },
    { id: 'scene-b', name: 'Exterior', sourceLayoutHash: '2'.repeat(64), requirementIds: ['exterior'], summary: { rooms: 0, terrainAreas: 2, paths: 1, props: 12, prefabInstances: 3 } },
  ] },
  theme: { catalogId: 'theme.review', fixedVersion: 1, contentHash: 'd'.repeat(64) } })
function packageDeclaration(): ThemePackReviewDeclaration {
  return { format: 'sceneweave-theme-pack-review', version: 1, recordId: 'package-review',
    content: cloneJson(createThemePackReviewContent(pack(), [content()])), checks: declaration().checks, userSignoff: declaration().userSignoff }
}
function repository(name = `sceneweave-asset-reviews-dev-v1-${sha256Text(crypto.randomUUID())}`) {
  const result = new AssetReviewRepository(name)
  repositories.push(result); databaseNames.add(name)
  return result
}
const storedPackKey = (value: ThemePackReviewDeclaration) => canonicalJson([value.content.packId, value.content.fixedVersion, value.content.registrationHash])

afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  for (const repository of repositories.splice(0)) repository.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('local controlled asset review persistence', () => {
  it('starts empty and uses the current library scope in an independent database namespace', async () => {
    expect(await repository().read()).toEqual({ assets: [], packs: [] })
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(assetReviewDatabaseName()).toBe('sceneweave-asset-reviews-dev-v1')
    const suffix = 'f'.repeat(64)
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ projects: `sceneweave-projects-dev-v1-${suffix}`, library: `sceneweave-library-dev-v1-${suffix}` }) })
    expect(assetReviewDatabaseName()).toBe(`sceneweave-asset-reviews-dev-v1-${suffix}`)
    for (const name of ['sceneweave-library-dev-v1', 'sceneweave-projects-dev-v1', 'sceneweave-catalog-v1', 'arbitrary-review-db']) expect(() => new AssetReviewRepository(name)).toThrow(/独立/)
  })

  it('returns controlled records only after an explicit successful write and cold loads them independently', async () => {
    const repo = repository(), external = parseAssetReviewDeclaration(declaration())
    expect(isControlledAssetReview(external)).toBe(false)
    const saved = await repo.putAsset(external), savedPack = await repo.putPack(packageDeclaration())
    expect(isControlledAssetReview(saved)).toBe(true)
    expect(isControlledAssetReview(external)).toBe(false)
    expect(assessThemePackPublication(pack(), [content()], [saved], savedPack).reviewReady).toBe(true)
    repo.close()
    const loaded = await repository(repo.database.name).read()
    expect(loaded.assets).toHaveLength(1); expect(loaded.packs).toHaveLength(1)
    expect(isControlledAssetReview(loaded.assets[0])).toBe(true)
    expect(assessThemePackPublication(pack(), [content()], loaded.assets, loaded.packs[0]).reviewReady).toBe(true)
    expect(Object.isFrozen(loaded)).toBe(true); expect(Object.isFrozen(loaded.assets[0].checks.art.evidence[0])).toBe(true)
  })

  it('captures request values before awaiting and never lets caller edits rewrite the pending review', async () => {
    const repo = repository(), input = declaration(), pending = repo.putAsset(input)
    input.content.resourceHashes[0] = 'e'.repeat(64); input.checks.art.reviewer = 'changed later'
    const result = await pending
    expect(result.content.resourceHashes).toEqual(['c'.repeat(64)]); expect(result.checks.art.reviewer).toBe('Local curator')
    expect((await repo.read()).assets[0]).toEqual(result)
  })

  it('updates only an exact asset key and preserves independent versions even with the same record label', async () => {
    const repo = repository()
    await repo.putAsset(declaration()); await repo.putAsset(declaration('other'))
    const updated = declaration(); updated.checks.art = { ...passed(), status: 'changes-required' }
    await repo.putAsset(updated)
    const result = await repo.read()
    expect(result.assets).toHaveLength(2)
    const current = result.assets.find(row => row.content.catalogKey === key())!
    expect(current.checks.art.status).toBe('changes-required')
    expect(assessAssetPublication(content('other'), current).reviewReady).toBe(false)
    expect(assessAssetPublication({ ...content(), resourceHashes: ['e'.repeat(64)] }, current).reviewReady).toBe(false)
  })

  it('binds package reviews to their exact registration hash and never promotes a changed pack', async () => {
    const repo = repository(), original = packageDeclaration(), changed = packageDeclaration()
    changed.content.registrationHash = 'e'.repeat(64)
    await repo.putPack(original); await repo.putPack(changed)
    const revised = cloneJson(original); revised.checks.scene = { ...passed(), status: 'changes-required' }
    await repo.putPack(revised)
    const result = await repo.read()
    expect(result.packs).toHaveLength(2)
    expect(result.packs.find(row => row.content.registrationHash === original.content.registrationHash)?.checks.scene.status).toBe('changes-required')
    const asset = await repo.putAsset(declaration())
    expect(assessThemePackPublication(pack(), [content()], [asset], result.packs.find(row => row.content.registrationHash === 'e'.repeat(64))).reviewReady).toBe(false)
  })

  it('rejects malicious or invalid declarations without invoking getters or changing persisted state', async () => {
    const repo = repository(); await repo.putAsset(declaration())
    let reads = 0
    const accessor = Object.defineProperty(declaration(), 'content', { enumerable: true, get() { reads++; return content() } })
    await expect(repo.putAsset(accessor)).rejects.toThrow(/访问器/)
    const hidden = declaration(); Object.defineProperty(hidden, 'hidden', { value: true })
    await expect(repo.putAsset(hidden)).rejects.toThrow(/隐藏/)
    await expect(repo.putAsset({ ...declaration(), [Symbol('approved')]: true })).rejects.toThrow(/Symbol/)
    await expect(repo.putAsset({ ...declaration(), status: 'P3' } as AssetReviewDeclaration)).rejects.toThrow()
    const missingEvidence = declaration(); missingEvidence.checks.art.evidence = []
    await expect(repo.putAsset(missingEvidence)).rejects.toThrow()
    await expect(repo.putPack({ ...packageDeclaration(), canEmbed: true } as ThemePackReviewDeclaration)).rejects.toThrow()
    expect(reads).toBe(0); expect((await repo.read()).assets).toHaveLength(1); expect((await repo.read()).packs).toHaveLength(0)
  })

  it('rolls back failed updates and does not return a saved or controlled result after transaction failure', async () => {
    const repo = repository(); await repo.putAsset(declaration()); await repo.putPack(packageDeclaration())
    const fail = () => { throw new Error('injected review transaction failure') }
    repo.database.assets.hook('updating', fail)
    const incoming = parseAssetReviewDeclaration({ ...declaration(), checks: { ...declaration().checks, art: { ...passed(), status: 'changes-required' } } })
    await expect(repo.putAsset(incoming)).rejects.toThrow(/injected/)
    repo.database.assets.hook('updating').unsubscribe(fail)
    expect(isControlledAssetReview(incoming)).toBe(false)
    const result = await repo.read()
    expect(result.assets[0].checks.art.status).toBe('passed'); expect(result.packs).toHaveLength(1)
    repo.close(); await expect(repo.putAsset(declaration())).rejects.toThrow(/已关闭/)
  })

  it('fails closed on corrupt stored identity/schema and preserves the existing rows on attempted writes', async () => {
    const repo = repository(); await repo.read()
    await repo.database.assets.put({ key: key('forged'), declaration: declaration() })
    await expect(repo.read()).rejects.toThrow(/主键/)
    await expect(repo.putAsset(declaration('new'))).rejects.toThrow(/主键/)
    expect(await repo.database.assets.count()).toBe(1)
    await repo.database.assets.clear()
    await repo.database.packs.put({ key: 'unbound-key', declaration: packageDeclaration() })
    await expect(repo.read()).rejects.toThrow(/主键/)
    await expect(repo.putPack(packageDeclaration())).rejects.toThrow(/主键/)
    expect(await repo.database.packs.count()).toBe(1)
  })

  it('enforces the 512 asset and 128 package limits while allowing an exact-key update at capacity', async () => {
    const repo = repository(); await repo.read()
    await repo.database.assets.bulkPut(Array.from({ length: ASSET_REVIEW_STORAGE_LIMITS.assets }, (_, index) => {
      const value = declaration(String(index)); return { key: value.content.catalogKey, declaration: value }
    }))
    await expect(repo.putAsset(declaration('overflow'))).rejects.toThrow(/512/)
    await repo.putAsset(declaration('0'))
    await repo.database.packs.bulkPut(Array.from({ length: ASSET_REVIEW_STORAGE_LIMITS.packs }, (_, index) => {
      const value = packageDeclaration(); value.content.registrationHash = index.toString(16).padStart(64, '0')
      return { key: storedPackKey(value), declaration: value }
    }))
    await expect(repo.putPack(packageDeclaration())).rejects.toThrow(/128/)
    expect(await repo.database.assets.count()).toBe(512); expect(await repo.database.packs.count()).toBe(128)
  })

  it('rejects a valid but oversized review without installing a partial record', async () => {
    const repo = repository(), value = packageDeclaration()
    value.content.members = Array.from({ length: 512 }, (_, index) => ({ catalogKey: key(String(index)), dependencyKeys: [],
      resourceHashes: Array.from({ length: 128 }, (_, resource) => resource.toString(16).padStart(64, '0')) }))
    await expect(repo.putPack(value)).rejects.toThrow(/4MiB/)
    expect(await repo.read()).toEqual({ assets: [], packs: [] })
  })

  it('rejects an unrelated existing database schema without upgrading or deleting its data', async () => {
    const repo = repository(), foreign = new Dexie(repo.database.name)
    foreign.version(1).stores({ external: 'id' })
    await foreign.open(); await foreign.table('external').put({ id: 'keep', value: 'original' }); foreign.close()
    await expect(repo.read()).rejects.toThrow(/结构版本/)
    const probe = new Dexie(repo.database.name)
    try { await probe.open(); expect(await probe.table('external').toArray()).toEqual([{ id: 'keep', value: 'original' }]) }
    finally { probe.close() }
  })
})
