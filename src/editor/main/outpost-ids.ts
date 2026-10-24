import { OUTPOST_CATALOG } from './outpost-catalog'
export const OUTPOST_IDS = {
  floor: 'blank-floor', water: 'outpost-water', low: 'outpost-low', high: 'outpost-high', room: 'outpost-room', store: 'outpost-store',
  entrance: 'outpost-entrance', sharedDoor: 'outpost-shared-door', sharedWall: 'outpost-shared-wall', southWall: 'outpost-room-south',
  yard: 'outpost-yard', yardOverlay: 'outpost-yard-gravel', path: 'outpost-path', connection: 'outpost-stairs', lookout: 'outpost-lookout',
  lamp: 'outpost-lamp-stand', campfire: 'outpost-campfire', bookshelf: 'outpost-bookshelf', crate: 'outpost-store-crate', rack: 'outpost-supply-rack',
  deskGroup: 'outpost-study-group', suppliesGroup: 'outpost-supplies-group', scatterTrees: 'outpost-trees', scatterShrubs: 'outpost-shrubs', scatterRocks: 'outpost-rocks',
  publicLabel: 'outpost-lookout-label', publicDescription: 'outpost-lookout-description', secretNote: 'outpost-gm-ledger',
  privacyMask: 'outpost-privacy-mask', privacyCrate: 'outpost-private-crate', privacyNote: 'outpost-private-crate-note',
  theme: OUTPOST_CATALOG.theme,
  materials: { wood: 'b2-m-01', woodWorn: 'b2-m-02', paver: 'b2-m-03', wallStone: 'b2-m-04', grass: 'b3-m-01', rock: 'b3-m-02', cliffRock: 'b3-m-03', sand: 'b3-m-04', shallow: 'b3-m-05', deep: 'b3-m-06', dirt: OUTPOST_CATALOG.dirt },
  layers: { terrain: 'outpost-layer-terrain', routes: 'outpost-layer-routes', building: 'outpost-layer-building', furnishings: 'outpost-layer-furnishings', vegetation: 'outpost-layer-vegetation', annotations: 'outpost-layer-annotations' },
} as const
