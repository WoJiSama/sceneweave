import type { MaterialRef } from '../model/scene.js'

export type RoadBankMaterial = 'snow' | 'stone' | 'scree' | 'grass' | 'earth'

export function roadBankMaterial(material: Pick<MaterialRef, 'tags' | 'name' | 'id'>): RoadBankMaterial {
  const words = [material.id, material.name, ...material.tags].join(' ').toLowerCase()
  if (/\b(snow|firn|ice)\b|积雪|冰雪|粒雪|硬雪|压雪|雪面/.test(words)) return 'snow'
  if (/\b(sand|scree|gravel)\b|砾|沙地|碎石/.test(words)) return 'scree'
  if (/\b(stone|rock|slate|granite|basalt)\b|岩|石/.test(words)) return 'stone'
  if (/\b(grass|meadow|turf|moss)\b|草|苔/.test(words)) return 'grass'
  return 'earth'
}
