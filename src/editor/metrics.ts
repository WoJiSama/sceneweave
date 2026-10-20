const paintDurations: number[] = []
const commitDurations: number[] = []
const MAX_SAMPLES = 1200
const record = (list: number[], value: number) => { list.push(value); if (list.length > MAX_SAMPLES) list.shift() }
export const recordPaint = (ms: number) => record(paintDurations, ms)
export const recordCommit = (ms: number) => record(commitDurations, ms)
export const resetMetrics = () => { paintDurations.length = 0; commitDurations.length = 0 }
export const getMetrics = () => ({ paintDurations: [...paintDurations], commitDurations: [...commitDurations] })
