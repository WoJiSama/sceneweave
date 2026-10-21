/** Close only the dedicated server owned by a runner, after sampling has stopped. */
export async function closeMeasuredBrowser(server, browser) {
  if (!server) {
    if (browser?.isConnected()) await browser.close()
    return null
  }
  const child = server.process(), started = performance.now()
  const exited = () => child.exitCode !== null || child.signalCode !== null
  const within = async (promise, duration) => {
    let timer
    try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), duration) })]) }
    finally { clearTimeout(timer) }
  }
  // Close the owning server directly. Closing its remote Browser first can
  // leave the connection waiting for a close notification after Chrome exits.
  const closing = server.close()
  let complete = await within(closing, 5000), killed = false, releasedExitedProcessPipes = false
  if (!complete) {
    if (!exited()) {
      killed = true
      await within(server.kill(), 5000)
    }
    if (exited()) {
      // Orphaned crash-reporting descendants can retain inherited pipe ends.
      // These are runner-owned handles, and the browser root has already exited.
      for (const stream of child.stdio) stream?.destroy?.()
      releasedExitedProcessPipes = true
    }
    complete = await within(closing, 5000)
  }
  if (!complete || !exited()) throw new Error('Dedicated browser teardown did not complete; no next measurement will start')
  return { durationMs: performance.now() - started, rootExited: true, killed, releasedExitedProcessPipes,
    boundary: 'After all measured operations and resource sampling; excluded from product timing.' }
}
