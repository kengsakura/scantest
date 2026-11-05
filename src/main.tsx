import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/sarabun/400.css'
import '@fontsource/sarabun/600.css'
import '@fontsource/sarabun/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
