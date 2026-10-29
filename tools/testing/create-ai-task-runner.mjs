// Build with npm run ai:build first. Importing/constructing this factory never creates a task.
// For a NEW frozen task, pass a private dataDir in config, then call engine.create explicitly.
// Keep any fetch observer observational: do not sleep/retry inside fetch.
export { createControlledTaskRunner } from '../../dist-ai/services/ai/task-runner.js'
