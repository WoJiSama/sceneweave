export type StonePoint = readonly [x: number, y: number]

interface StoneShape {
  name: string
  setting: 'scree' | 'strand'
  sizeMm: readonly [width: number, height: number]
  /** Clockwise silhouette in the unit square, centred on the contact patch. */
  outline: readonly StonePoint[]
  crown: StonePoint
  tone: number
}

export const NATURAL_STONE_SHAPES = {
  slab: { name: '风化扁岩', setting: 'scree', sizeMm: [1230, 780], crown: [43, 42], tone: 0,
    outline: [[6,53],[13,38],[16,24],[33,17],[38,11],[58,16],[72,13],[84,25],[93,34],[91,53],[95,64],[81,78],[66,76],[51,88],[32,82],[20,76],[9,70]] },
  chip: { name: '崖下剥落石', setting: 'scree', sizeMm: [845, 685], crown: [44, 38], tone: -3,
    outline: [[8,50],[17,34],[18,20],[31,14],[45,16],[62,10],[77,19],[81,29],[90,32],[93,54],[86,61],[85,74],[69,87],[55,83],[42,89],[22,79],[14,66]] },
  weathered: { name: '苔痕岩块', setting: 'scree', sizeMm: [1080, 835], crown: [46, 45], tone: 6,
    outline: [[8,49],[15,29],[29,26],[33,16],[50,11],[57,17],[70,18],[86,28],[89,45],[93,56],[86,69],[70,79],[54,86],[43,84],[30,90],[17,78],[14,64]] },
  cobble: { name: '潮磨卵石', setting: 'strand', sizeMm: [580, 440], crown: [43, 40], tone: 3,
    outline: [[8,53],[12,35],[25,24],[41,17],[57,14],[70,18],[81,25],[88,37],[92,52],[89,64],[77,78],[62,84],[43,85],[28,81],[14,72]] },
  shingle: { name: '伏地滩石', setting: 'strand', sizeMm: [870, 520], crown: [47, 43], tone: -2,
    outline: [[7,55],[13,41],[25,30],[32,20],[54,16],[65,19],[81,27],[93,38],[94,52],[89,66],[76,75],[60,84],[46,81],[30,84],[18,75],[10,67]] },
} as const satisfies Record<string, StoneShape>

export type NaturalStoneKey = keyof typeof NATURAL_STONE_SHAPES
export const naturalStoneDefinitionId = (key: NaturalStoneKey) => `natural-stone-v1-${key}`
export const naturalStoneAssetId = (key: string) => `natural-stone-v1-art-${key}`
export const SCREE_STONES = ['slab', 'chip', 'weathered'] as const satisfies readonly NaturalStoneKey[]
export const STRAND_STONES = ['cobble', 'shingle'] as const satisfies readonly NaturalStoneKey[]
