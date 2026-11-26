/** Explicit creation/regeneration versions. Unknown saved versions remain editable concrete results. */
export const LANDSCAPE_SCATTER_VERSION = 'scatter-landscape-v1'
export const LANDSCAPE_GROUND_SCATTER_VERSION = 'scatter-landscape-v2'
export const SCATTER_ALGORITHM_VERSIONS = ['scatter-cell-v1', 'scatter-cell-v2', LANDSCAPE_SCATTER_VERSION, LANDSCAPE_GROUND_SCATTER_VERSION] as const
export type ScatterAlgorithmVersion = typeof SCATTER_ALGORITHM_VERSIONS[number]
export const isSupportedScatterAlgorithm = (version: string): version is ScatterAlgorithmVersion => SCATTER_ALGORITHM_VERSIONS.some(value => value === version)
