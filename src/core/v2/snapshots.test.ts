import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHouse } from '../seed'
import { migrateSceneV1 } from './migration'
import * as schema from './schema'
import { reviseSceneSnapshotV2, validateSceneSnapshotV2 } from './snapshots'

const fixture = () => migrateSceneV1(createHouse('source'), { sceneId: 'snapshot-test', now: '2026-10-20T00:00:00.000Z' })
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child) }
  return value
}
afterEach(() => vi.restoreAllMocks())

describe('owned strict v2 scene snapshots', () => {
  it('certifies only the independent deeply frozen result and revalidates a changed caller input', () => {
    const source = fixture(), validate = vi.spyOn(schema, 'validateSceneV2')
    const result = validateSceneSnapshotV2(source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document).not.toBe(source)
    expect(Object.isFrozen(result.document.props['p-b2'].positionMm)).toBe(true)
    expect(Object.isFrozen(result.warnings)).toBe(true)
    expect(() => { result.document.props['p-b2'].positionMm.x = 1 }).toThrow()
    expect(validateSceneSnapshotV2(result.document)).toBe(result)
    expect(validate).toHaveBeenCalledTimes(1)
    source.props['p-b2'].rotationDeg = 400
    expect(validateSceneSnapshotV2(source).ok).toBe(false)
    expect(validate).toHaveBeenCalledTimes(2)
    expect(result.document.props['p-b2'].rotationDeg).toBe(0)
  })

  it('does not accept shallow or deeply frozen caller objects as credentials', () => {
    const shallow = Object.freeze(fixture()), deep = deepFreeze(fixture()), validate = vi.spyOn(schema, 'validateSceneV2')
    expect(validateSceneSnapshotV2(shallow).ok).toBe(true)
    expect(validateSceneSnapshotV2(shallow).ok).toBe(true)
    expect(validateSceneSnapshotV2(deep).ok).toBe(true)
    expect(validateSceneSnapshotV2(deep).ok).toBe(true)
    expect(validate).toHaveBeenCalledTimes(4)
    shallow.props['p-b2'].rotationDeg = -1
    expect(validateSceneSnapshotV2(shallow).ok).toBe(false)
    const known = validateSceneSnapshotV2(fixture())
    if (!known.ok) throw new Error('fixture invalid')
    expect(validateSceneSnapshotV2(Object.freeze({ ...known.document, revision: -1 })).ok).toBe(false)
  })

  it('strictly checks revision metadata while sharing only certified immutable content', () => {
    const source = fixture(), validate = vi.spyOn(schema, 'validateSceneV2'), result = validateSceneSnapshotV2(source)
    if (!result.ok) throw new Error('fixture invalid')
    const revised = reviseSceneSnapshotV2(result.document, 1, '2026-10-21T00:00:00.000Z')
    expect(revised).toMatchObject({ revision: 1, updatedAt: '2026-10-21T00:00:00.000Z' })
    expect(revised.props).toBe(result.document.props)
    expect(validateSceneSnapshotV2(revised)).toMatchObject({ ok: true, document: revised })
    expect(validate).toHaveBeenCalledTimes(1)
    for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) expect(() => reviseSceneSnapshotV2(revised, revision, revised.updatedAt)).toThrow()
    expect(() => reviseSceneSnapshotV2(revised, 2, 'invalid-time')).toThrow()
    expect(result.document.revision).toBe(0)
    expect(() => reviseSceneSnapshotV2({ ...source, revision: -1 }, 1, revised.updatedAt)).toThrow(/当前场景无效/)
  })
})
