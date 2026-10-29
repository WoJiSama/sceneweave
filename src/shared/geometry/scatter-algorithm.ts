/** Explicit creation/regeneration versions. Unknown saved versions remain editable concrete results. */
export const SCATTER_ALGORITHM_VERSIONS = ['scatter-cell-v1', 'scatter-cell-v2'] as const
export type ScatterAlgorithmVersion = typeof SCATTER_ALGORITHM_VERSIONS[number]
export const isSupportedScatterAlgorithm = (version: string): version is ScatterAlgorithmVersion => SCATTER_ALGORITHM_VERSIONS.some(value => value === version)
