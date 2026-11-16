export * from './contracts.js'
export {
  captureCarvedRockHost, createCarvedStrip, inspectCarvedStrip, inspectCarvedStripHost,
  createCarvedStripSampler, sampleCarvedStrip, sampleCarvedCut, carvedStripFootprint,
  carvedStripCenterline, carvedStripCutFootprints, carvedStripPatches, followCarvedStrip,
  type CarvedConnectionLike,
} from './geometry.js'
export { carvedRockFaces, materializeCarvedRockPlan } from './materialize.js'
export { createCarvedRockPaintPlan, type CarvedRockPaintOptions, type CarvedRockPaintPlan,
  type CarvedRockPaintFacet, type CarvedRockPaintStroke } from './paint-plan.js'
