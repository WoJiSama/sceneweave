/** Preserve empty punctuation fields so an omitted coordinate cannot become zero. */
export function integerCoordinateRow(row: string, count: number, separators = /[,，]/): number[] | null {
  const fields = row.trim().split(separators)
  if (fields.some(field => !field.trim())) return null
  const values = fields.flatMap(field => field.trim().split(/\s+/).map(Number))
  return values.length === count && values.every(Number.isSafeInteger) ? values : null
}
