/** Explicit creation/regeneration versions. Unknown saved versions remain editable concrete results. */
export const LANDSCAPE_SCATTER_VERSION = 'scatter-landscape-v1'
export const LANDSCAPE_GROUND_SCATTER_VERSION = 'scatter-landscape-v2'
export const LANDSCAPE_WOODLAND_SCATTER_VERSION = 'scatter-landscape-woodland-v1'
export const LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION = 'scatter-landscape-woodland-v2'
export const LANDSCAPE_SCATTER_ALGORITHM_VERSIONS = [LANDSCAPE_SCATTER_VERSION, LANDSCAPE_GROUND_SCATTER_VERSION,
  LANDSCAPE_WOODLAND_SCATTER_VERSION, LANDSCAPE_FITTED_WOODLAND_SCATTER_VERSION] as const
export const SCATTER_ALGORITHM_VERSIONS = ['scatter-cell-v1', 'scatter-cell-v2', ...LANDSCAPE_SCATTER_ALGORITHM_VERSIONS] as const
export type ScatterAlgorithmVersion = typeof SCATTER_ALGORITHM_VERSIONS[number]
export const isSupportedScatterAlgorithm = (version: string): version is ScatterAlgorithmVersion => SCATTER_ALGORITHM_VERSIONS.some(value => value === version)
