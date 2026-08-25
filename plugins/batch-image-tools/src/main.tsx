import React from 'react'
import ReactDOM from 'react-dom/client'
import { setupDevMock } from './dev-mock'
import './main.css'
import App from './App'

setupDevMock()

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
