// Сборка одного сценария в CommonJS для Electron: ENTRY — файл сценария, OUT — куда положить
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')

export default {
  input: process.env.ENTRY,
  platform: 'node',
  external: ['electron', 'koffi', 'node-hid'],
  resolve: {
    alias: {
      '@shared': path.join(root, 'src/shared'),
      '@main': path.join(root, 'src/main')
    }
  },
  transform: {
    define: {
      'import.meta.env.MAIN_VITE_YANDEX_CLIENT_ID': '""',
      'import.meta.env.MAIN_VITE_YANDEX_CLIENT_SECRET': '""',
      'import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID': '""',
      'import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET': '""'
    }
  },
  output: { file: process.env.OUT, format: 'cjs', codeSplitting: false }
}
