import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './context/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { Toaster } from 'sonner'

if (!import.meta.env.VITE_GEMINI_API_KEY) {
  console.warn("⚠ VITE_GEMINI_API_KEY is missing! AI features will not work.");
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
