// Tool-only arithmetic over the frozen package and observed DOM rectangles.
// No product geometry, event handlers or mutable page state is replaced.
export function worldDeltaToLocal(delta, quarterTurns) {
  if (![0, 1, 2, 3].includes(quarterTurns)) throw new TypeError('Expected quarter turns in [0, 3]')
  const result = [{ x: delta.x, y: delta.y }, { x: delta.y, y: -delta.x },
    { x: -delta.x, y: -delta.y }, { x: -delta.y, y: delta.x }][quarterTurns]
  return { x: result.x === 0 ? 0 : result.x, y: result.y === 0 ? 0 : result.y }
}

export function propDragPlan({ target, bounds, canvas, viewport, distanceMm, snapMm }) {
  if (!Number.isSafeInteger(distanceMm) || distanceMm === 0 || !Number.isSafeInteger(snapMm) || snapMm < 1
    || ![bounds.width, bounds.height, canvas.width, canvas.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new TypeError('Drag needs positive dimensions, a nonzero integer distance and positive integer snap')
  }
  const start = { x: canvas.x + (target.x - bounds.x) / bounds.width * canvas.width,
    y: canvas.y + (target.y - bounds.y) / bounds.height * canvas.height }
  const end = { x: start.x + distanceMm / bounds.width * canvas.width, y: start.y }
  const inside = point => point.x > viewport.x && point.x < viewport.x + viewport.width
    && point.y > viewport.y && point.y < viewport.y + viewport.height
    && point.x > canvas.x && point.x < canvas.x + canvas.width && point.y > canvas.y && point.y < canvas.y + canvas.height
  if (!inside(start) || !inside(end)) throw new Error('Fixed drag target/endpoint is clipped')
  if (Math.abs(end.x - start.x) < 8) throw new Error('Fixed drag is too short in screen pixels')
  const world = point => ({ x: Math.round(bounds.x + (point.x - canvas.x) / canvas.width * bounds.width),
    y: Math.round(bounds.y + (point.y - canvas.y) / canvas.height * bounds.height) })
  const a = world(start), b = world(end)
  const offsetMm = { x: Math.round((b.x - a.x) / snapMm) * snapMm, y: Math.round((b.y - a.y) / snapMm) * snapMm }
  if (offsetMm.x !== distanceMm || offsetMm.y !== 0) throw new Error('Frozen drag distance is not exactly representable with this snap')
  return { start, end, offsetMm, screenDistancePx: Math.abs(end.x - start.x) }
}

export function currentMeasurementPolicy({ smoke, profile, exclusiveWindow }) {
  const exclusive = typeof exclusiveWindow === 'string' && exclusiveWindow.trim().length > 0
  return {
    measurementClass: smoke ? 'diagnostic-current-v1-production-ui-smoke'
      : profile ? 'diagnostic-current-v1-production-ui-profile'
        : exclusive ? 'formal-current-v1-production-ui-observation' : 'diagnostic-current-v1-production-ui-observation',
    exclusiveWindow: exclusive ? exclusiveWindow.trim() : null,
    profile: Boolean(profile),
  }
}

function explicitArgument(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (typeof value !== 'string' || !value.trim() || value.startsWith('--')
    || args.indexOf(name, index + 1) >= 0) {
    throw new TypeError(`${name} needs one explicit confirmation value, not another flag`)
  }
  return value.trim()
}

export const exclusiveWindowArgument = args => explicitArgument(args, '--exclusive-window')
export const stopFileArgument = args => explicitArgument(args, '--stop-file')
