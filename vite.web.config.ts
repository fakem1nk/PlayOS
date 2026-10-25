// Превью интерфейса в обычном браузере с демо-библиотекой (без Electron): npm run web
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import lightTheme from './scripts/light-theme.mjs'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react()],
  css: { postcss: { plugins: [lightTheme()] } },
  server: { port: 5199, strictPort: true }
})
