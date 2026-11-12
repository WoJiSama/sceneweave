import path from 'node:path'
import { buildDiagnosticStages } from './diagnostic-stages.mjs'
import { workflowDiagnosticTargets } from './workflow-diagnostic-targets.mjs'

const output = process.argv[2]
if (!output || !path.isAbsolute(output)) throw new Error('Expected a new absolute diagnostic output directory')
const metadata = await buildDiagnosticStages(output, workflowDiagnosticTargets, { flush4k: process.argv.includes('--flush-4k') })
console.log(`Workflow diagnostic: ${metadata.transformed.length} boundaries. Instrumented timing is not a normal-production benchmark.`)
