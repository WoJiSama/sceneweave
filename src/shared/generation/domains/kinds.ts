export const domainGenerationKinds = Object.freeze(['interior', 'forest', 'volcano', 'mixed'] as const)
export type DomainGenerationKind = typeof domainGenerationKinds[number]
