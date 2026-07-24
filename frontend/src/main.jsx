import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ToastHost from './components/ToastHost.jsx'
import ConfirmHost from './components/ConfirmHost.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <ToastHost />
    <ConfirmHost />
  </StrictMode>,
)
