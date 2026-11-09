import { describe, expect, it, vi } from 'vitest'
import { svgFixtureValidation, svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures'
import { LEGACY_SVG_PROCESSOR } from '../ai/svg'
import type { CompleteValidationOptions, ResourceOptions } from '../ports/resources'
import { cloneJson } from '../validation/json'
import { getVerifiedProjectBundle, tryDerivedProjectBundle, validateProjectBundle, validateProjectBundles, validateProjectSnapshot } from './resources'

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function validation() {
  const options = svgFixtureValidation()
  const decode = vi.spyOn(options.images, 'decode'), rasterize = vi.spyOn(options.svg!, 'rasterize')
  return { options, decode, rasterize }
}
async function baseline() {
  const ports = validation(), raw = svgProjectFixture().bundle
  const bundle = await validateProjectBundle(raw, ports.options)
  ports.decode.mockClear(); ports.rasterize.mockClear()
  return { ...ports, raw, bundle }
}
function blockedValidation(options: CompleteValidationOptions) {
  const started = gate(), finish = gate(), decode = options.images.decode
  const images = { ...options.images, decode: vi.fn(async (...args: Parameters<typeof decode>) => {
    started.release(); await finish.promise
    return decode(...args)
  }) }
  return { options: { ...options, images }, started, finish, decode: images.decode }
}

describe('private complete-snapshot verification and capability lifecycle', () => {
  it('reuses only the exact owned pair and actual capabilities, independently of options and signal wrappers', async () => {
    const { bundle, options, decode, rasterize } = await baseline()
    expect(await validateProjectSnapshot(bundle, { ...options, signal: { aborted: false } })).toBe(bundle)
    expect(await validateProjectSnapshot({ project: bundle.project, resources: bundle.resources }, options)).toBe(bundle)
    expect(decode).not.toHaveBeenCalled(); expect(rasterize).not.toHaveBeenCalled()
    const publicResult = await validateProjectBundle(bundle, options)
    expect(publicResult).not.toBe(bundle)
    expect(decode).toHaveBeenCalledTimes(1); expect(rasterize).toHaveBeenCalledTimes(1)
  })

  it('fully validates cloned metadata, replacement readers, frozen lookalikes, and rejects corrupted input', async () => {
    const { bundle, options, decode } = await baseline()
    const cloned = Object.freeze({ project: cloneJson(bundle.project), resources: bundle.resources })
    const reader = Object.freeze({ project: bundle.project, resources: { read: bundle.resources.read } })
    expect(await validateProjectSnapshot(cloned, options)).not.toBe(bundle)
    expect(await validateProjectSnapshot(reader, options)).not.toBe(bundle)
    expect(decode).toHaveBeenCalledTimes(2)
    await expect(validateProjectSnapshot({ project: bundle.project, resources: { async read(hash) {
      const bytes = await bundle.resources.read(hash); bytes[0] ^= 1; return bytes
    } } }, options)).rejects.toThrow()
    const invalid = cloneJson(bundle.project); invalid.licenseBindings = []
    await expect(validateProjectSnapshot({ project: invalid, resources: bundle.resources }, options)).rejects.toThrow()
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('rechecks a changed owner or actual method, then remembers the result on the original snapshot', async () => {
    const { bundle, options, decode, rasterize } = await baseline()
    const other = { ...options, images: { ...options.images } }
    expect(await validateProjectSnapshot(bundle, other)).toBe(bundle)
    expect(await validateProjectSnapshot(bundle, other)).toBe(bundle)
    expect(decode).toHaveBeenCalledTimes(1)
    const original = other.images.decode
    other.images.decode = vi.fn((...args: Parameters<typeof original>) => original(...args))
    expect(await validateProjectSnapshot(bundle, other)).toBe(bundle)
    expect(await validateProjectSnapshot(bundle, other)).toBe(bundle)
    expect(other.images.decode).toHaveBeenCalledTimes(1)
    expect(rasterize).toHaveBeenCalledTimes(2)
  })

  it('inherits exact resource proofs for controlled derivation while changed closure fields fall back', async () => {
    const { bundle, options, decode } = await baseline()
    const candidate = { ...bundle.project, document: { ...bundle.project.document, title: 'Derived snapshot' } }
    const derived = tryDerivedProjectBundle({ project: candidate, resources: bundle.resources }, bundle)!
    expect(derived).toBeDefined()
    expect(await validateProjectSnapshot(derived, options)).toBe(derived)
    expect(decode).not.toHaveBeenCalled()
    const changed = { ...candidate, licenses: cloneJson(candidate.licenses) }
    expect(tryDerivedProjectBundle({ project: changed, resources: bundle.resources }, bundle)).toBeUndefined()
    await validateProjectSnapshot({ project: changed, resources: bundle.resources }, options)
    expect(decode).toHaveBeenCalledTimes(1)
    const other = { ...options, images: { ...options.images } }
    await validateProjectSnapshot(derived, other)
    const second = tryDerivedProjectBundle({ project: { ...derived.project, document: { ...derived.project.document, title: 'Next' } }, resources: derived.resources }, derived)!
    await validateProjectSnapshot(second, other)
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('shares overlapping complete checks for a new capability and captures methods before byte IO', async () => {
    const { bundle, options } = await baseline(), blocked = blockedValidation(options)
    const first = validateProjectSnapshot(bundle, blocked.options)
    await blocked.started.promise
    const second = validateProjectSnapshot(bundle, { ...blocked.options, signal: { aborted: false } })
    blocked.options.images.decode = vi.fn(() => { throw new Error('late replacement') })
    blocked.finish.release()
    expect(await first).toBe(bundle); expect(await second).toBe(bundle)
    expect(blocked.decode).toHaveBeenCalledTimes(1)
    await expect(validateProjectSnapshot(bundle, blocked.options)).rejects.toThrow('late replacement')
  })

  it('cancels one native-signal consumer without stopping another and removes captured subscriptions', async () => {
    const { bundle, options } = await baseline(), blocked = blockedValidation(options), controller = new AbortController(), other = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener'), removeOther = vi.spyOn(other.signal, 'removeEventListener')
    const first = validateProjectSnapshot(bundle, { ...blocked.options, signal: controller.signal }).catch(error => error)
    await blocked.started.promise
    const second = validateProjectSnapshot(bundle, { ...blocked.options, signal: other.signal })
    Object.defineProperty(controller.signal, 'removeEventListener', { value() { throw new Error('late replacement') } })
    controller.abort()
    expect((await first).name).toBe('AbortError'); expect(remove).toHaveBeenCalledTimes(1)
    blocked.finish.release()
    expect(await second).toBe(bundle)
    expect(removeOther).toHaveBeenCalledTimes(1)
    expect(await validateProjectSnapshot(bundle, blocked.options)).toBe(bundle)
    expect(blocked.decode).toHaveBeenCalledTimes(1)
  })

  it('revokes the final consumer, drains admitted work, and never publishes a late capability proof', async () => {
    const { bundle, options } = await baseline(), blocked = blockedValidation(options)
    const controllers = [new AbortController(), new AbortController()]
    const calls = controllers.map(({ signal }) => validateProjectSnapshot(bundle, { ...blocked.options, signal }).catch(error => error))
    await blocked.started.promise
    controllers.forEach(controller => controller.abort())
    expect((await Promise.all(calls)).map(error => error.name)).toEqual(['AbortError', 'AbortError'])
    // A retry must start independently while the abandoned decode is draining.
    const retry = validateProjectSnapshot(bundle, blocked.options)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(blocked.decode).toHaveBeenCalledTimes(2)
    blocked.finish.release()
    expect(await retry).toBe(bundle)
    expect(await validateProjectSnapshot(bundle, blocked.options)).toBe(bundle)
    expect(blocked.decode).toHaveBeenCalledTimes(2)
    expect(getVerifiedProjectBundle(bundle)).toBe(bundle)
  })

  it('honors flag-only cancellation at async checkpoints without retaining a late proof', async () => {
    const { bundle, options } = await baseline(), blocked = blockedValidation(options), signal = { aborted: false }
    let settled = false
    const pending = validateProjectSnapshot(bundle, { ...blocked.options, signal }).catch(error => { settled = true; return error })
    await blocked.started.promise; signal.aborted = true
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(settled).toBe(false)
    blocked.finish.release(); expect((await pending).name).toBe('AbortError')
    await validateProjectSnapshot(bundle, blocked.options)
    expect(blocked.decode).toHaveBeenCalledTimes(2)
  })

  it('shares failures only while in flight and retries complete verification', async () => {
    const { bundle, options } = await baseline(), blocked = blockedValidation(options)
    const original = blocked.options.images.decode
    let failing = true
    blocked.options.images.decode = vi.fn(async (...args) => {
      const image = await original(...args)
      if (failing) throw new Error('decode failed')
      return image
    })
    const first = validateProjectSnapshot(bundle, blocked.options).catch(error => error)
    await blocked.started.promise
    const second = validateProjectSnapshot(bundle, blocked.options).catch(error => error)
    blocked.finish.release()
    expect((await first).message).toBe('decode failed'); expect((await second).message).toBe('decode failed')
    expect(blocked.decode).toHaveBeenCalledTimes(1)
    failing = false
    await validateProjectSnapshot(bundle, blocked.options)
    expect(blocked.decode).toHaveBeenCalledTimes(2)
  })

  it('never shares overlapping unknown caller-owned inputs', async () => {
    const { raw, options } = await baseline(), started = gate(), finish = gate(), decode = options.images.decode
    let calls = 0
    const other = { ...options, images: { ...options.images, async decode(...args: Parameters<typeof decode>) {
      if (++calls === 2) started.release()
      await finish.promise; return decode(...args)
    } } }
    const first = validateProjectSnapshot(raw, other), second = validateProjectSnapshot(raw, other)
    await started.promise; finish.release()
    expect(await first).not.toBe(await second); expect(calls).toBe(2)
  })

  it('binds SVG methods and canonical processor configuration without invoking accessor profiles', async () => {
    const { bundle, options, decode, rasterize } = await baseline()
    const original = options.svg!.rasterize
    options.svg!.rasterize = vi.fn((...args: Parameters<typeof original>) => original(...args))
    await validateProjectSnapshot(bundle, options)
    await validateProjectSnapshot(bundle, options)
    expect(rasterize).toHaveBeenCalledTimes(1); expect(decode).toHaveBeenCalledTimes(1)
    let getters = 0
    Object.defineProperty(options.svg, 'processor', { get() { getters++; throw new Error('must not invoke') } })
    await expect(validateProjectSnapshot(bundle, options)).rejects.toThrow()
    expect(getters).toBe(0); expect(decode).toHaveBeenCalledTimes(1)
  })

  it('records only the actual capabilities used by each bundle in a mixed full-validation batch', async () => {
    const ports = validation(), svg = svgProjectFixture().bundle, plain = svgProjectFixture().bundle
    plain.project.authoringSources = {}
    const bundles = await validateProjectBundles([svg, plain], ports.options)
    ports.decode.mockClear(); ports.rasterize.mockClear()
    expect(await validateProjectSnapshot(bundles[0], ports.options)).toBe(bundles[0])
    expect(await validateProjectSnapshot(bundles[1], { images: ports.options.images })).toBe(bundles[1])
    expect(ports.decode).not.toHaveBeenCalled(); expect(ports.rasterize).not.toHaveBeenCalled()
  })

  it('tracks legacy and canonical SVG capabilities independently', async () => {
    const ports = validation(), canonical = svgProjectFixture().bundle, legacy = svgProjectFixture().bundle
    const source = legacy.project.authoringSources.image
    if (source.processorVersion !== 2) throw new Error('Expected canonical SVG fixture')
    const { rasterizer: _rasterizer, pixelFormat: _pixelFormat, ...records } = source
    legacy.project.authoringSources.image = { ...records, ...LEGACY_SVG_PROCESSOR }
    const legacySvg = { ...ports.options.svg!, processor: LEGACY_SVG_PROCESSOR }
    const options = { ...ports.options, legacySvg }
    const bundles = await validateProjectBundles([canonical, legacy], options)
    ports.decode.mockClear(); ports.rasterize.mockClear()
    const original = legacySvg.rasterize
    legacySvg.rasterize = vi.fn((...args: Parameters<typeof original>) => original(...args))
    expect(await validateProjectSnapshot(bundles[0], options)).toBe(bundles[0])
    expect(ports.decode).not.toHaveBeenCalled()
    expect(await validateProjectSnapshot(bundles[1], options)).toBe(bundles[1])
    expect(await validateProjectSnapshot(bundles[1], options)).toBe(bundles[1])
    expect(legacySvg.rasterize).toHaveBeenCalledTimes(1)
    expect(ports.decode).toHaveBeenCalledTimes(2)
  })

  it('does not allow pre-cancelled or accessor-subscription consumers to start or join work', async () => {
    const { bundle, options, decode } = await baseline()
    const signal: ResourceOptions['signal'] = { aborted: true }
    await expect(validateProjectSnapshot(bundle, { ...options, signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(validateProjectSnapshot(bundle, { ...options, images: { ...options.images }, signal })).rejects.toMatchObject({ name: 'AbortError' })
    let getters = 0
    const accessor = { aborted: false }
    Object.defineProperty(accessor, 'addEventListener', { get() { getters++; throw new Error('must not invoke') } })
    await expect(validateProjectSnapshot(bundle, { ...options, images: { ...options.images }, signal: accessor })).rejects.toThrow()
    expect(getters).toBe(0)
    expect(decode).not.toHaveBeenCalled()
  })
})
