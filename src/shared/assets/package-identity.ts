/** A publisher or package identifier occupies one segment of a project namespace. */
export function isPackageId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)
}

export function isPackageNamespace(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 129) return false
  const parts = value.split('/')
  return parts.length === 2 && parts.every(isPackageId)
}

export function isPositiveVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}
