import { describe, expect, it } from 'vitest'
import { bitmapVariantPixelPipeline } from './bitmap-pixels.js'
import { CANONICAL_SVG_PROCESSOR, LEGACY_SVG_PROCESSOR } from '../ai/svg.js'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'

describe('fixed bitmap descendant pixel semantics', () => {
  it('inherits processor 2 through fixed descendants without changing old/plain bitmap roots', () => {
    const { bundle } = svgProjectFixture(), project = bundle.project
    project.appearance.variants = {
      a: { id: 'a', sourceAssetId: 'image', outputAssetId: 'child', tint: '#FFFFFF', brightness: 1 },
      b: { id: 'b', sourceAssetId: 'child', outputAssetId: 'grandchild', tint: null, brightness: .8 },
      c: { id: 'c', sourceAssetId: 'plain', outputAssetId: 'plain-child', tint: '#FFFFFF', brightness: .8 },
    }
    expect(bitmapVariantPixelPipeline(project, 'grandchild')).toBe('svg-rgba8-v1')
    expect(bitmapVariantPixelPipeline(project, 'plain-child')).toBe('native')
    const { rasterizer: _rasterizer, pixelFormat: _pixelFormat, ...source } = project.authoringSources.image as typeof project.authoringSources.image & typeof CANONICAL_SVG_PROCESSOR
    project.authoringSources.image = { ...source, ...LEGACY_SVG_PROCESSOR }
    expect(bitmapVariantPixelPipeline(project, 'grandchild')).toBe('native')
  })

  it('refuses a cyclic fixed source chain', () => {
    const { bundle } = svgProjectFixture(), project = bundle.project
    project.appearance.variants = {
      a: { id: 'a', sourceAssetId: 'second', outputAssetId: 'first', tint: null, brightness: .5 },
      b: { id: 'b', sourceAssetId: 'first', outputAssetId: 'second', tint: null, brightness: .5 },
    }
    expect(() => bitmapVariantPixelPipeline(project, 'first')).toThrow(/循环/)
  })
})
