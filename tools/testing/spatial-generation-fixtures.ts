import type { InteriorGenerationUiRequest, MixedGenerationUiRequest } from '../../src/application/workspace/generation-intent.js'

/** Ordinary form inputs for the use-space comparison. The actual fixed
 * resources and every generated entity still come from the normal content /
 * shared generation paths; no map geometry is copied into the generator. */
export const spatialInteriorRequest: InteriorGenerationUiRequest = {
  title: '林路旅店', widthMm: 20000, heightMm: 16000, seed: 'crossroads-inn-54', wallThicknessMm: 200,
  rooms: [
    { id: 'common', purpose: '旅店餐厅与酒馆', minAreaMm2: 48_000_000, maxAreaMm2: 140_000_000, minClearSideMm: 4500 },
    { id: 'kitchen', purpose: '厨房', minAreaMm2: 18_000_000, maxAreaMm2: 55_000_000, minClearSideMm: 3200 },
    { id: 'guest-east', purpose: '客房', minAreaMm2: 16_000_000, maxAreaMm2: 42_000_000, minClearSideMm: 3000 },
    { id: 'guest-west', purpose: '客房', minAreaMm2: 16_000_000, maxAreaMm2: 42_000_000, minClearSideMm: 3000 },
    { id: 'pantry', purpose: '储藏室', minAreaMm2: 10_000_000, maxAreaMm2: 30_000_000, minClearSideMm: 2500 },
  ],
  relations: [], corridor: { axis: 'horizontal', clearWidthMm: 1600 },
  arrangement: { doors: true, entrance: true, furniture: true, doorWidthMm: 1400, clearWidthMm: 1000 },
}

export const spatialMixedRequest: MixedGenerationUiRequest = {
  title: '林缘补给前哨', environment: 'forest', widthMm: 50000, heightMm: 38000,
  seed: 'woodland-crossroads-54', roomCount: 3, purpose: '前哨会客与补给', furniture: true,
  vegetationMultiplier: 0.9, algorithmVersion: 4,
}
