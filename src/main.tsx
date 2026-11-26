import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { WorkspaceCrashBoundary, WorkspaceCrashRecovery } from './editor/main-shell/WorkspaceCrashBoundary'
import './styles.css'
import './ui-motion.css'

function reopenHome() {
  window.history.replaceState(null, '', '#home')
  window.location.reload()
}

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <WorkspaceCrashBoundary fallback={<WorkspaceCrashRecovery onHome={reopenHome}/>}><App /></WorkspaceCrashBoundary>
</React.StrictMode>)
