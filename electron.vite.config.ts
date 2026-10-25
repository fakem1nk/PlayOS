import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import lightTheme from './scripts/light-theme.mjs'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    // Светлая тема собирается из тёмных стилей (scripts/light-theme.mjs)
    css: { postcss: { plugins: [lightTheme()] } }
  }
})
