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
  const source = json(input), occurrences = new Map<string, number>(), keys = new WeakMap<Schema, string>()
  let hasScope = false
  const count = (schema: Schema): Schema => {
    if (Object.keys(schema).some(key => scoped.has(key))) hasScope = true
    const key = JSON.stringify(schema, (_key, value: unknown) =>
      object(value) ? Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]])) : value)
    keys.set(schema, key)
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
    const key = keys.get(schema)!, count = occurrences.get(key) ?? 0
    const nextName = `c${names.size.toString(36)}`
    const referenceLength = JSON.stringify({ $ref: `#/$defs/${nextName}` }).length
    const definitionKeyLength = JSON.stringify(nextName).length + 2
    // Require a saving at the actual reference length. Root fields remain visible.
    if (!root && (names.has(key) || count > 1 && (count - 1) * key.length > count * referenceLength + definitionKeyLength)) {
      let name = names.get(key)
      if (!name) {
        name = nextName; names.set(key, name)
        definitions[name] = children(schema, child => transform(child))
      }
      return { $ref: `#/$defs/${name}` }
    }
    return children(schema, child => transform(child))
  }
  let compact = transform(source, true)
  // Children counted through identical parents may appear only once after the
  // parents have been shared. Inline those children to avoid extra indirection.
  const uses = new Map<string, number>(), referencedName = (schema: Schema) =>
    typeof schema.$ref === 'string' ? schema.$ref.slice('#/$defs/'.length) : undefined
  const countUses = (schema: Schema): Schema => {
    const name = referencedName(schema)
    if (name) uses.set(name, (uses.get(name) ?? 0) + 1)
    else children(schema, countUses)
    return schema
  }
  countUses(compact)
  for (const definition of Object.values(definitions)) if (object(definition)) countUses(definition)
  const inline = (schema: Schema): Schema => {
    const name = referencedName(schema)
    if (name) return uses.get(name) === 1 ? inline(definitions[name] as Schema) : schema
    return children(schema, inline)
  }
  compact = inline(compact)
  const retained = Object.fromEntries(Object.entries(definitions).filter(([name]) => uses.get(name) !== 1)
    .map(([name, value]) => [name, inline(value as Schema)]))
  if (Object.keys(retained).length) compact.$defs = retained
  // Repeated parents may hide repeated children; retain the original if the
  // complete serialized representation would not actually be smaller.
  return JSON.stringify(compact).length < JSON.stringify(source).length ? compact : source
}

/** Provider-only, lossless JSON Schema presentation using tool-local $defs.
 * Names, root fields, constraints and the executor's strict schemas are kept. */
export function compactProviderTools(tools: readonly ProviderToolDefinition[]): ProviderToolDefinition[] {
  return tools.map(tool => ({ ...tool, parameters: compactSchema(tool.parameters) }))
}
