import type { ProviderToolDefinition } from './provider-types.js'

type Schema = Record<string, unknown>
const maps = new Set(['properties', 'patternProperties', 'dependentSchemas'])
const lists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const singles = new Set(['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else', 'additionalItems', 'unevaluatedItems', 'contentSchema'])
const scoped = new Set(['$id', '$ref', '$anchor', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor', '$defs', 'definitions'])
const object = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value)
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Only schema-bearing keywords are traversed. A const/default/example may
 * contain arbitrary JSON, including strings that look like references. */
function children(schema: Schema, transform: (schema: Schema) => Schema): Schema {
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => {
    if (maps.has(key) && object(value)) return [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, object(child) ? transform(child) : child]))]
    if ((lists.has(key) || key === 'items') && Array.isArray(value)) return [key, value.map(child => object(child) ? transform(child) : child)]
    if ((singles.has(key) || key === 'items') && object(value)) return [key, transform(value)]
    return [key, value]
  }))
}

function compactSchema(input: Schema): Schema {
  const source = json(input), occurrences = new Map<string, number>()
  let hasScope = false
  const count = (schema: Schema): Schema => {
    if (Object.keys(schema).some(key => scoped.has(key))) hasScope = true
    const key = JSON.stringify(schema)
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
    children(schema, count)
    return schema
  }
  count(source)
  // Existing IDs/anchors and recursive references own their resolution scope.
  // Leave those schemas untouched rather than rebasing them under a new $defs.
  if (hasScope) return source
  const definitions: Schema = {}, names = new Map<string, string>()
  const transform = (schema: Schema, root = false): Schema => {
    const key = JSON.stringify(schema), count = occurrences.get(key) ?? 0
    // Keep small leaves readable and avoid a definition whose reference costs
    // more than its repetition. Root object fields remain visible to readers.
    if (!root && key.length >= 40 && count > 1 && (count - 1) * key.length > count * 25 + 32) {
      let name = names.get(key)
      if (!name) {
        name = `c${names.size}`; names.set(key, name)
        definitions[name] = children(schema, child => transform(child))
      }
      return { $ref: `#/$defs/${name}` }
    }
    return children(schema, child => transform(child))
  }
  const compact = transform(source, true)
  if (Object.keys(definitions).length) compact.$defs = definitions
  // Repeated parents may hide repeated children; retain the original if the
  // complete serialized representation would not actually be smaller.
  return JSON.stringify(compact).length < JSON.stringify(source).length ? compact : source
}

/** Provider-only, lossless JSON Schema presentation using tool-local $defs.
 * Names, root fields, constraints and the executor's strict schemas are kept. */
export function compactProviderTools(tools: readonly ProviderToolDefinition[]): ProviderToolDefinition[] {
  return tools.map(tool => ({ ...tool, parameters: compactSchema(tool.parameters) }))
}
