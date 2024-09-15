import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { TurboEdgeProviderV0 } from '@turbo-ing/edge-v0'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TurboEdgeProviderV0>
      <App />
    </TurboEdgeProviderV0>
  </StrictMode>,
)
