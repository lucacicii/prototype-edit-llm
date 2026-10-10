import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider, ConfigProvider } from '@lobehub/ui'
import { motion } from 'motion/react'
import './assets/main.css'
import App from './App'

if (window.electron?.process?.platform === 'darwin') {
  document.documentElement.classList.add('is-macos')
}

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <ConfigProvider motion={motion}>
        <ThemeProvider themeMode="dark">
          <App />
        </ThemeProvider>
      </ConfigProvider>
    </React.StrictMode>
  )
}
