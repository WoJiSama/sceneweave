/** Frozen failed-input SVGs, rendered by the pinned WASM profile. PNG pixels
 * were independently decoded with Python zlib/unfilter before recording these
 * values. Every browser consumes the same source/pixel hashes. */
export const SVG_PROCESSOR2_GOLDENS = [
  { key: 'interior-armchair', normalizedSha256: '9c42657c0af9b7e998ac3b0fbf25582b7a10d151b077beef209d925a8931a2ad',
    rgbaSha256: '52e2073542956960e0eaa272c9c1963bc7eba1baba80bb938b90fc5f8904af34' },
  { key: 'coast-driftwood', normalizedSha256: '8be25a255fd5f5a3c68ab0397031a505b060be9ceca07f3ba2d2322892ce0e7a',
    rgbaSha256: '7f4d9fbd067fa12b60445cfc8ac56e9340a0e7ef48e27c00303f30cc9d82afe2' },
  { key: 'island-debris-driftwood', normalizedSha256: '55e984dcb135c11d12b03fea9d1b654a7ed9858b75d5c188dd85665266fee7a8',
    rgbaSha256: '9c75620b70234fdfa8246a3e31242b49e54e79a519d7a986d11940e6195e91e8' },
] as const
