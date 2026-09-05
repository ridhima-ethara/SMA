import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { useStore } from './store'

// Dev/demo hook: lets scripted browsers inspect the store (harmless in production bundles).
;(window as unknown as { __ethara: typeof useStore }).__ethara = useStore

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
